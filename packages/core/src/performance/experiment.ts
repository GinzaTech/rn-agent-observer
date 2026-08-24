import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  PerformanceBaselineSchema,
  PerformanceBudgetSchema,
  PerformanceExperimentResultSchema,
  PerformanceSnapshotSchema,
  type AssuranceFinding,
  type AssuranceOutcome,
  type EvidenceReference,
  type PerformanceBaseline,
  type PerformanceBudget,
  type PerformanceExperimentResult,
  type PerformanceMetricSummary,
  type PerformanceSnapshot,
  type PerformanceStatistic,
  type TargetFingerprint,
} from '@rn-agent-observer/schemas';

export const MIN_PERFORMANCE_SAMPLES = 3;
export const MAX_PERFORMANCE_SAMPLES = 50;
export const MAX_PERFORMANCE_BASELINE_BYTES = 1_048_576;

export interface AnalyzePerformanceSamplesOptions {
  id: string;
  scenarioId: string;
  scenarioMode: 'interaction' | 'startup' | 'idle';
  startedAt: string;
  finishedAt: string;
  target: TargetFingerprint;
  requestedSamples: number;
  warmupSamples: number;
  budgets: readonly PerformanceBudget[];
  baseline?: PerformanceBaseline;
}

export interface PerformanceExperimentProgress {
  phase: 'warmup' | 'measurement';
  sampleIndex: number;
  completed: number;
  total: number;
}

export interface RunPerformanceExperimentOptions {
  scenarioId: string;
  scenarioMode: 'interaction' | 'startup' | 'idle';
  target: TargetFingerprint;
  samples?: number;
  warmupSamples?: number;
  intervalMs?: number;
  budgets: readonly PerformanceBudget[];
  baseline?: PerformanceBaseline;
  collect(): Promise<PerformanceSnapshot>;
  prepareSample?: (
    index: number,
    phase: 'warmup' | 'measurement',
  ) => Promise<void>;
  now?: () => Date;
  createExperimentId?: () => string;
  sleep?: (durationMs: number) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (
    progress: PerformanceExperimentProgress,
  ) => void | Promise<void>;
}

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const waitForInterval = async (
  durationMs: number,
  wait: (durationMs: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (!signal) {
    await wait(durationMs);
    return true;
  }
  if (signal.aborted) return false;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      wait(durationMs).then(() => true),
      new Promise<false>((resolve) => {
        abortListener = () => resolve(false);
        signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
};

const percentile = (
  values: readonly number[],
  percentileValue: number,
): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? Number.NaN;
};

const summaryFor = (
  samples: readonly PerformanceSnapshot[],
  metricName: string,
  unit: string,
): PerformanceMetricSummary => {
  const observed = samples.flatMap((snapshot) =>
    snapshot.metrics
      .filter((metric) => metric.name === metricName && metric.unit === unit)
      .slice(0, 1),
  );
  const available = observed.filter(
    (metric): metric is typeof metric & { value: number } =>
      metric.available && metric.value !== null,
  );
  const values = available.map((metric) => metric.value);
  const mean =
    values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
  const standardDeviation =
    mean === null
      ? null
      : Math.sqrt(
          values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            values.length,
        );
  const coefficientOfVariation =
    mean === null || mean === 0 || standardDeviation === null
      ? null
      : Math.abs(standardDeviation / mean);
  const timestamps = observed.map((metric) => metric.timestamp).sort();
  const reasons = new Set(
    observed
      .filter((metric) => !metric.available || metric.value === null)
      .map((metric) => metric.reason ?? 'Metric was unavailable'),
  );
  if (observed.length < samples.length) {
    reasons.add('Metric was not emitted for one or more samples');
  }
  return {
    metric: metricName,
    unit,
    totalSamples: samples.length,
    availableSamples: values.length,
    unavailableSamples: samples.length - values.length,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
    mean,
    median: values.length > 0 ? percentile(values, 0.5) : null,
    p95: values.length > 0 ? percentile(values, 0.95) : null,
    standardDeviation,
    coefficientOfVariation,
    sources: [...new Set(observed.map((metric) => metric.source))].sort(),
    ...(values.length > 0 ? { sampleValues: values } : {}),
    ...(timestamps[0] ? { firstTimestamp: timestamps[0] } : {}),
    ...(timestamps.at(-1) ? { lastTimestamp: timestamps.at(-1) } : {}),
    unavailableReasons: [...reasons].sort(),
  };
};

const statisticValue = (
  summary: PerformanceMetricSummary,
  statistic: PerformanceStatistic,
): number | null => summary[statistic];

/**
 * Deterministic bootstrap (fixed seed LCG, 1000 resamples) over the paired
 * per-sample differences between the current run and the baseline. Returns a
 * 95% confidence interval for the mean difference; when zero lies inside the
 * interval a mean-only regression verdict is too weak to trust.
 */
export function bootstrapMeanDifference(
  current: readonly number[],
  baseline: readonly number[],
  options: { resamples?: number; seed?: number } = {},
): {
  meanDifference: number;
  confidenceLow: number;
  confidenceHigh: number;
} | null {
  const paired = Math.min(current.length, baseline.length);
  if (paired < 2) return null;
  const resamples = options.resamples ?? 1_000;
  let state = (options.seed ?? 0x2545f491) >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const differences: number[] = [];
  for (let index = 0; index < paired; index += 1) {
    const left = current[index];
    const right = baseline[index];
    if (left === undefined || right === undefined) continue;
    differences.push(left - right);
  }
  if (differences.length < 2) return null;
  const meanDifference =
    differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const means: number[] = [];
  for (let resample = 0; resample < resamples; resample += 1) {
    let sum = 0;
    for (let pick = 0; pick < differences.length; pick += 1) {
      sum += differences[Math.floor(random() * differences.length)] ?? 0;
    }
    means.push(sum / differences.length);
  }
  means.sort((left, right) => left - right);
  const lowIndex = Math.floor(means.length * 0.025);
  const highIndex = Math.ceil(means.length * 0.975) - 1;
  return {
    meanDifference,
    confidenceLow: means[lowIndex] ?? meanDifference,
    confidenceHigh: means[highIndex] ?? meanDifference,
  };
}

const resultOutcome = (
  findings: readonly AssuranceFinding[],
): AssuranceOutcome => {
  if (findings.some((finding) => finding.outcome === 'FAIL')) return 'FAIL';
  if (findings.some((finding) => finding.outcome === 'NOT_VERIFIED')) {
    return 'NOT_VERIFIED';
  }
  if (findings.some((finding) => finding.outcome === 'PASS')) return 'PASS';
  return 'NA';
};

const aggregateEvidence = (
  samples: readonly PerformanceSnapshot[],
): EvidenceReference => {
  const sha256 = createHash('sha256')
    .update(JSON.stringify(samples))
    .digest('hex');
  return {
    id: `performance-samples-${sha256.slice(0, 16)}`,
    kind: 'performance-samples',
    relation: 'supports',
    sha256,
  };
};

const targetMismatch = (
  current: TargetFingerprint,
  baseline: TargetFingerprint,
): string[] => {
  const comparable: Array<keyof TargetFingerprint> = [
    'platform',
    'deviceId',
    'appId',
    'operatingSystem',
    'architecture',
    'reactNativeVersion',
    'expoVersion',
    'hermesVersion',
    'deviceClass',
  ];
  return comparable
    .filter((key) => current[key] !== baseline[key])
    .map(
      (key) =>
        `${key}: current=${String(current[key] ?? 'unknown')}, baseline=${String(baseline[key] ?? 'unknown')}`,
    );
};

const budgetFinding = (input: {
  budget: PerformanceBudget;
  outcome: AssuranceOutcome;
  title: string;
  description: string;
  evidence: EvidenceReference;
  limitation?: string;
  suffix?: string;
}): AssuranceFinding => ({
  schemaVersion: '1.0',
  id: `performance.${input.budget.id}${input.suffix ? `.${input.suffix}` : ''}`,
  ruleId: `performance.${input.budget.id}${input.suffix ? `.${input.suffix}` : ''}`,
  title: input.title,
  description: input.description,
  outcome: input.outcome,
  severity: input.outcome === 'PASS' ? 'info' : input.budget.severity,
  confidence: 1,
  category: 'performance',
  controls: [],
  evidence: [input.evidence],
  remediation:
    input.outcome === 'FAIL'
      ? 'Profile the exact scenario, optimize the evidenced bottleneck, and repeat the same experiment.'
      : undefined,
  limitations: input.limitation ? [input.limitation] : [],
});

export const analyzePerformanceSamples = (
  values: readonly PerformanceSnapshot[],
  options: AnalyzePerformanceSamplesOptions,
): PerformanceExperimentResult => {
  const samples = values.map((snapshot) =>
    PerformanceSnapshotSchema.parse(snapshot),
  );
  const budgets = options.budgets.map((budget) =>
    PerformanceBudgetSchema.parse(budget),
  );
  const metricKeys = new Map<string, { metric: string; unit: string }>();
  for (const budget of budgets) {
    metricKeys.set(`${budget.metric}\u0000${budget.unit}`, {
      metric: budget.metric,
      unit: budget.unit,
    });
  }
  for (const snapshot of samples) {
    for (const metric of snapshot.metrics) {
      metricKeys.set(`${metric.name}\u0000${metric.unit}`, {
        metric: metric.name,
        unit: metric.unit,
      });
    }
  }
  const metrics = [...metricKeys.values()]
    .map(({ metric, unit }) => summaryFor(samples, metric, unit))
    .sort((left, right) => left.metric.localeCompare(right.metric));
  const evidence = aggregateEvidence(samples);
  const findings: AssuranceFinding[] = [];

  for (const budget of budgets) {
    const summary = metrics.find(
      (metric) =>
        metric.metric === budget.metric && metric.unit === budget.unit,
    );
    if (!summary || summary.availableSamples < budget.minimumAvailableSamples) {
      const available = summary?.availableSamples ?? 0;
      const limitation = `Only ${available}/${budget.minimumAvailableSamples} required samples were available`;
      findings.push(
        budgetFinding({
          budget,
          outcome: 'NOT_VERIFIED',
          title: `${budget.metric} budget was not verified`,
          description: `The ${budget.statistic} ${budget.metric} budget needs repeated available samples.`,
          evidence,
          limitation,
        }),
      );
      continue;
    }
    const observed = statisticValue(summary, budget.statistic);
    if (observed === null) {
      findings.push(
        budgetFinding({
          budget,
          outcome: 'NOT_VERIFIED',
          title: `${budget.metric} budget was not verified`,
          description: `The ${budget.statistic} statistic could not be calculated.`,
          evidence,
          limitation: 'The requested statistic was unavailable',
        }),
      );
      continue;
    }
    const passed =
      budget.operator === 'lte'
        ? observed <= budget.threshold
        : observed >= budget.threshold;
    findings.push(
      budgetFinding({
        budget,
        outcome: passed ? 'PASS' : 'FAIL',
        title: `${budget.metric} ${passed ? 'met' : 'exceeded'} its budget`,
        description: `${budget.statistic}=${observed.toFixed(3)} ${budget.unit}; policy ${budget.operator} ${budget.threshold} ${budget.unit}.`,
        evidence,
      }),
    );

    if (budget.maxCoefficientOfVariation !== undefined) {
      const variation = summary.coefficientOfVariation;
      findings.push(
        budgetFinding({
          budget,
          suffix: 'variance',
          outcome:
            variation === null
              ? 'NOT_VERIFIED'
              : variation <= budget.maxCoefficientOfVariation
                ? 'PASS'
                : 'FAIL',
          title: `${budget.metric} sample stability`,
          description:
            variation === null
              ? 'Coefficient of variation could not be calculated.'
              : `Coefficient of variation=${variation.toFixed(4)}; policy lte ${budget.maxCoefficientOfVariation}.`,
          evidence,
          ...(variation === null
            ? {
                limitation: 'Mean was zero or repeated values were unavailable',
              }
            : {}),
        }),
      );
    }

    if (budget.maxRegressionPercent !== undefined) {
      const baseline = options.baseline;
      const mismatch = baseline
        ? targetMismatch(options.target, baseline.target)
        : [];
      const baselineSummary = baseline?.metrics.find(
        (metric) =>
          metric.metric === budget.metric && metric.unit === budget.unit,
      );
      const baselineValue = baselineSummary
        ? statisticValue(baselineSummary, budget.statistic)
        : null;
      if (
        !baseline ||
        baseline.scenarioId !== options.scenarioId ||
        mismatch.length > 0 ||
        baselineValue === null ||
        baselineValue === 0
      ) {
        const limitation = !baseline
          ? 'No baseline was supplied'
          : baseline.scenarioId !== options.scenarioId
            ? 'Baseline scenario does not match'
            : mismatch.length > 0
              ? `Target fingerprint mismatch: ${mismatch.join('; ')}`
              : 'Baseline statistic was unavailable or zero';
        findings.push(
          budgetFinding({
            budget,
            suffix: 'regression',
            outcome: 'NOT_VERIFIED',
            title: `${budget.metric} regression was not verified`,
            description: 'A compatible non-zero baseline is required.',
            evidence,
            limitation,
          }),
        );
      } else {
        const signedRegression =
          budget.operator === 'lte'
            ? ((observed - baselineValue) / Math.abs(baselineValue)) * 100
            : ((baselineValue - observed) / Math.abs(baselineValue)) * 100;
        // Paired bootstrap CI over per-sample values: when the CI of the
        // mean difference straddles zero, a mean-only verdict is reported as
        // NOT_VERIFIED instead of PASS/FAIL.
        const pairedInterval = bootstrapMeanDifference(
          summary.sampleValues ?? [],
          baselineSummary?.sampleValues ?? [],
        );
        const intervalStraddlesZero =
          pairedInterval !== null &&
          pairedInterval.confidenceLow <= 0 &&
          pairedInterval.confidenceHigh >= 0;
        const outcome = intervalStraddlesZero
          ? 'NOT_VERIFIED'
          : signedRegression <= budget.maxRegressionPercent
            ? 'PASS'
            : 'FAIL';
        findings.push(
          budgetFinding({
            budget,
            suffix: 'regression',
            outcome,
            title:
              outcome === 'NOT_VERIFIED'
                ? `${budget.metric} regression is within noise`
                : `${budget.metric} ${outcome === 'PASS' ? 'met' : 'exceeded'} regression policy`,
            description:
              outcome === 'NOT_VERIFIED' && pairedInterval
                ? `Mean difference=${pairedInterval.meanDifference.toFixed(2)} with 95% CI [${pairedInterval.confidenceLow.toFixed(2)}, ${pairedInterval.confidenceHigh.toFixed(2)}] containing zero; collect more samples before trusting the direction.`
                : `Regression=${signedRegression.toFixed(2)}%; policy lte ${budget.maxRegressionPercent}%.` +
                  (pairedInterval
                    ? ` Paired 95% CI of mean difference [${pairedInterval.confidenceLow.toFixed(2)}, ${pairedInterval.confidenceHigh.toFixed(2)}].`
                    : ''),
            evidence,
            ...(outcome === 'NOT_VERIFIED'
              ? {
                  limitation:
                    'Paired bootstrap confidence interval contains zero',
                }
              : {}),
          }),
        );
      }
    }
  }

  const limitations = [
    ...(options.scenarioMode === 'idle'
      ? ['Idle sampling does not substitute for profiling a target interaction']
      : []),
    ...(options.scenarioMode === 'startup'
      ? [
          'Startup results are valid only when the collector proves cold foreground starts and excludes warm, hot, or prewarmed launches',
        ]
      : []),
  ];
  return PerformanceExperimentResultSchema.parse({
    schemaVersion: '1.0',
    id: options.id,
    scenarioId: options.scenarioId,
    scenarioMode: options.scenarioMode,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    target: options.target,
    requestedSamples: options.requestedSamples,
    warmupSamples: options.warmupSamples,
    outcome: resultOutcome(findings),
    metrics,
    budgets,
    findings,
    limitations,
  });
};

export const runPerformanceExperiment = async (
  options: RunPerformanceExperimentOptions,
): Promise<PerformanceExperimentResult> => {
  const samples = options.samples ?? 5;
  const warmupSamples = options.warmupSamples ?? 1;
  const intervalMs = options.intervalMs ?? 250;
  if (
    !Number.isInteger(samples) ||
    samples < MIN_PERFORMANCE_SAMPLES ||
    samples > MAX_PERFORMANCE_SAMPLES
  ) {
    throw new RangeError(
      `samples must be an integer from ${MIN_PERFORMANCE_SAMPLES} to ${MAX_PERFORMANCE_SAMPLES}`,
    );
  }
  if (
    !Number.isInteger(warmupSamples) ||
    warmupSamples < 0 ||
    warmupSamples > 10
  ) {
    throw new RangeError('warmupSamples must be an integer from 0 to 10');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60_000) {
    throw new RangeError('intervalMs must be an integer from 0 to 60000');
  }
  if (
    (options.scenarioMode === 'interaction' ||
      options.scenarioMode === 'startup') &&
    !options.prepareSample
  ) {
    throw new TypeError(
      `${options.scenarioMode} experiments require prepareSample so every sample repeats the audited scenario`,
    );
  }

  const now = options.now ?? (() => new Date());
  const started = now();
  const collected: PerformanceSnapshot[] = [];
  const total = warmupSamples + samples;
  let cancelled = options.signal?.aborted ?? false;
  for (let index = 0; index < total; index += 1) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    const phase = index < warmupSamples ? 'warmup' : 'measurement';
    const sampleIndex = phase === 'warmup' ? index : index - warmupSamples;
    await options.onProgress?.({
      phase,
      sampleIndex,
      completed: index,
      total,
    });
    let snapshot: PerformanceSnapshot;
    try {
      await options.prepareSample?.(sampleIndex, phase);
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      snapshot = PerformanceSnapshotSchema.parse(await options.collect());
    } catch (error) {
      if (options.signal?.aborted) {
        cancelled = true;
        break;
      }
      throw error;
    }
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    if (phase === 'measurement') collected.push(snapshot);
    await options.onProgress?.({
      phase,
      sampleIndex,
      completed: index + 1,
      total,
    });
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    if (intervalMs > 0 && index < total - 1) {
      const completed = await waitForInterval(
        intervalMs,
        options.sleep ?? sleep,
        options.signal,
      );
      if (!completed) {
        cancelled = true;
        break;
      }
    }
  }
  if (options.signal?.aborted) cancelled = true;
  const finished = now();
  const result = analyzePerformanceSamples(collected, {
    id:
      options.createExperimentId?.() ??
      `performance-${started.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
    scenarioId: options.scenarioId,
    scenarioMode: options.scenarioMode,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    target: options.target,
    requestedSamples: samples,
    warmupSamples,
    budgets: options.budgets,
    ...(options.baseline ? { baseline: options.baseline } : {}),
  });
  if (!cancelled) return result;
  return PerformanceExperimentResultSchema.parse({
    ...result,
    outcome: 'NOT_VERIFIED',
    limitations: [
      ...new Set([
        ...result.limitations,
        `Experiment was cancelled after ${collected.length}/${samples} measurement samples`,
      ]),
    ],
  });
};

export const createPerformanceBaseline = (
  result: PerformanceExperimentResult,
  options: { id?: string; capturedAt?: string } = {},
): PerformanceBaseline =>
  PerformanceBaselineSchema.parse({
    schemaVersion: '1.0',
    id: options.id ?? `baseline-${result.id}`,
    scenarioId: result.scenarioId,
    capturedAt: options.capturedAt ?? result.finishedAt,
    target: result.target,
    sampleCount: result.requestedSamples,
    metrics: result.metrics,
  });

export const loadPerformanceBaseline = async (
  baselinePath: string,
): Promise<PerformanceBaseline> => {
  const path = resolve(baselinePath);
  const source = await readFile(path, 'utf8');
  if (Buffer.byteLength(source, 'utf8') > MAX_PERFORMANCE_BASELINE_BYTES) {
    throw new RangeError('Performance baseline exceeds the 1 MiB safety limit');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new TypeError(
      `Performance baseline JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return PerformanceBaselineSchema.parse(parsed);
};

export const writePerformanceBaseline = async (
  baselinePath: string,
  value: PerformanceBaseline,
  options: {
    /** Use exclusive creation for callers that must never overwrite a file. */
    noOverwrite?: boolean;
    /** Set false when a trusted caller already created and checked parents. */
    createParentDirectory?: boolean;
  } = {},
): Promise<{ path: string; sha256: string; bytes: number }> => {
  const baseline = PerformanceBaselineSchema.parse(value);
  const path = resolve(baselinePath);
  const content = `${JSON.stringify(baseline, null, 2)}\n`;
  if (options.createParentDirectory ?? true) {
    await mkdir(dirname(path), { recursive: true });
  }
  await writeFile(path, content, {
    encoding: 'utf8',
    flag: options.noOverwrite ? 'wx' : 'w',
  });
  return {
    path,
    sha256: createHash('sha256').update(content).digest('hex'),
    bytes: Buffer.byteLength(content),
  };
};
