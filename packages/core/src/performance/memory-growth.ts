import { createHash } from 'node:crypto';
import {
  AssuranceFindingSchema,
  PerformanceSnapshotSchema,
  type AssuranceFinding,
  type AssuranceOutcome,
  type EvidenceReference,
  type PerformanceSnapshot,
  type TargetFingerprint,
} from '@rn-agent-observer/schemas';
import type { ObserverCore } from '../index.js';
import { observerTargetFingerprint } from './observer-experiment.js';

export const MIN_MEMORY_GROWTH_SAMPLES = 5;
export const MAX_MEMORY_GROWTH_SAMPLES = 50;

export interface MemoryGrowthSample {
  index: number;
  timestamp: string;
  valueMb: number | null;
  available: boolean;
  reason?: string;
}

export interface MemoryGrowthResult {
  schemaVersion: '1.0';
  id: string;
  scenarioId: string;
  startedAt: string;
  finishedAt: string;
  target: TargetFingerprint;
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  requestedSamples: number;
  availableSamples: number;
  initialMedianMb: number | null;
  finalMedianMb: number | null;
  growthMb: number | null;
  slopeMbPerCycle: number | null;
  maxGrowthMb: number;
  samples: MemoryGrowthSample[];
  findings: AssuranceFinding[];
  evidence: EvidenceReference[];
  limitations: string[];
}

export interface AnalyzeMemoryGrowthOptions {
  id: string;
  scenarioId: string;
  startedAt: string;
  finishedAt: string;
  target: TargetFingerprint;
  maxGrowthMb: number;
  minimumAvailableSamples?: number;
  requestedSamples?: number;
}

export interface RunObserverMemoryGrowthOptions {
  scenarioId: string;
  replayPath: string;
  cycles?: number;
  settleMs?: number;
  maxGrowthMb?: number;
  signal?: AbortSignal;
  onProgress?: (progress: {
    completed: number;
    total: number;
  }) => void | Promise<void>;
  sleep?: (durationMs: number) => Promise<void>;
  now?: () => Date;
  createExperimentId?: () => string;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const current = sorted[middle] ?? Number.NaN;
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? current) + current) / 2
    : current;
};

const slopeFor = (values: readonly number[]): number | null => {
  if (values.length < 2) return null;
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (const [index, value] of values.entries()) {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  }
  return denominator === 0 ? null : numerator / denominator;
};

const memorySample = (
  snapshot: PerformanceSnapshot,
  index: number,
): MemoryGrowthSample => {
  const metric = snapshot.metrics.find(
    (candidate) => candidate.name === 'memory_mb' && candidate.unit === 'MB',
  );
  if (!metric || !metric.available || metric.value === null) {
    return {
      index,
      timestamp: metric?.timestamp ?? snapshot.timestamp,
      valueMb: null,
      available: false,
      reason: metric?.reason ?? 'memory_mb was not emitted for this cycle',
    };
  }
  return {
    index,
    timestamp: metric.timestamp,
    valueMb: metric.value,
    available: true,
  };
};

export const analyzeMemoryGrowth = (
  rawSnapshots: readonly PerformanceSnapshot[],
  options: AnalyzeMemoryGrowthOptions,
): MemoryGrowthResult => {
  if (!Number.isFinite(options.maxGrowthMb) || options.maxGrowthMb < 0) {
    throw new RangeError('maxGrowthMb must be a non-negative finite number');
  }
  const minimumAvailableSamples =
    options.minimumAvailableSamples ?? MIN_MEMORY_GROWTH_SAMPLES;
  if (
    !Number.isInteger(minimumAvailableSamples) ||
    minimumAvailableSamples < MIN_MEMORY_GROWTH_SAMPLES ||
    minimumAvailableSamples > MAX_MEMORY_GROWTH_SAMPLES
  ) {
    throw new RangeError(
      `minimumAvailableSamples must be from ${MIN_MEMORY_GROWTH_SAMPLES} to ${MAX_MEMORY_GROWTH_SAMPLES}`,
    );
  }
  const snapshots = rawSnapshots.map((snapshot) =>
    PerformanceSnapshotSchema.parse(snapshot),
  );
  const samples = snapshots.map(memorySample);
  const available = samples.flatMap((sample) =>
    sample.available && sample.valueMb !== null ? [sample.valueMb] : [],
  );
  const evidence: EvidenceReference = {
    id: `memory-growth-${createHash('sha256')
      .update(JSON.stringify(samples))
      .digest('hex')
      .slice(0, 16)}`,
    kind: 'memory-growth-samples',
    relation: 'supports',
    sha256: createHash('sha256').update(JSON.stringify(samples)).digest('hex'),
  };
  const enough = available.length >= minimumAvailableSamples;
  const windowSize = enough ? Math.max(2, Math.floor(available.length / 3)) : 0;
  const initialMedianMb = enough
    ? median(available.slice(0, windowSize))
    : null;
  const finalMedianMb = enough ? median(available.slice(-windowSize)) : null;
  const growthMb =
    initialMedianMb === null || finalMedianMb === null
      ? null
      : finalMedianMb - initialMedianMb;
  const slopeMbPerCycle = enough ? slopeFor(available) : null;
  const outcome: 'PASS' | 'FAIL' | 'NOT_VERIFIED' =
    growthMb === null
      ? 'NOT_VERIFIED'
      : growthMb <= options.maxGrowthMb
        ? 'PASS'
        : 'FAIL';
  const limitation =
    outcome === 'NOT_VERIFIED'
      ? `Only ${available.length}/${minimumAvailableSamples} required memory samples were available`
      : undefined;
  const finding = AssuranceFindingSchema.parse({
    schemaVersion: '1.0',
    id: `performance.memory-growth.${options.scenarioId}`,
    ruleId: 'performance.memory-growth',
    title:
      outcome === 'FAIL'
        ? 'Process memory growth exceeded its budget'
        : outcome === 'PASS'
          ? 'Process memory growth met its budget'
          : 'Process memory growth was not verified',
    description:
      growthMb === null
        ? 'Repeated process-memory growth could not be calculated.'
        : `Final-window minus initial-window median=${growthMb.toFixed(3)} MB; policy lte ${options.maxGrowthMb} MB.`,
    outcome,
    severity: outcome === 'FAIL' ? 'high' : 'info',
    confidence: outcome === 'NOT_VERIFIED' ? 1 : 0.9,
    category: 'performance',
    controls: [],
    evidence: [evidence],
    remediation:
      outcome === 'FAIL'
        ? 'Profile JavaScript and native heaps across the same replay cycles, identify retained owners, fix them, then repeat this experiment.'
        : undefined,
    limitations: limitation ? [limitation] : [],
  });
  return {
    schemaVersion: '1.0',
    id: options.id,
    scenarioId: options.scenarioId,
    startedAt: options.startedAt,
    finishedAt: options.finishedAt,
    target: options.target,
    outcome,
    requestedSamples: options.requestedSamples ?? snapshots.length,
    availableSamples: available.length,
    initialMedianMb,
    finalMedianMb,
    growthMb,
    slopeMbPerCycle,
    maxGrowthMb: options.maxGrowthMb,
    samples,
    findings: [finding],
    evidence: [evidence],
    limitations: [
      'memory_mb is process PSS from adb dumpsys meminfo; it is not JavaScript heap size',
      'Sustained growth is a regression signal, not proof of a leak; confirm retained objects with JavaScript and native heap profiles',
      ...(limitation ? [limitation] : []),
    ],
  };
};

const defaultSleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
};

const settle = async (
  sleep: (durationMs: number) => Promise<void>,
  durationMs: number,
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (!signal) {
    await sleep(durationMs);
    return;
  }
  if (signal.aborted) return;
  await new Promise<void>((resolve, reject) => {
    const aborted = (): void => {
      signal.removeEventListener('abort', aborted);
      resolve();
    };
    signal.addEventListener('abort', aborted, { once: true });
    sleep(durationMs).then(
      () => {
        signal.removeEventListener('abort', aborted);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', aborted);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
};

export const runObserverMemoryGrowth = async (
  core: ObserverCore,
  options: RunObserverMemoryGrowthOptions,
): Promise<MemoryGrowthResult> => {
  const cycles = options.cycles ?? 10;
  if (
    !Number.isInteger(cycles) ||
    cycles < MIN_MEMORY_GROWTH_SAMPLES ||
    cycles > MAX_MEMORY_GROWTH_SAMPLES
  ) {
    throw new RangeError(
      `cycles must be from ${MIN_MEMORY_GROWTH_SAMPLES} to ${MAX_MEMORY_GROWTH_SAMPLES}`,
    );
  }
  if (!options.replayPath.trim()) {
    throw new TypeError('replayPath is required');
  }
  core.assertActionAuthorized('performance-memory-growth');
  const settleMs = options.settleMs ?? 500;
  if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 60_000) {
    throw new RangeError('settleMs must be an integer from 0 to 60000');
  }
  const maxGrowthMb =
    options.maxGrowthMb ?? core.config.budgets.memoryGrowthMaxMb;
  if (maxGrowthMb === undefined) {
    throw new TypeError(
      'A memory-growth budget is required via maxGrowthMb or config.budgets.memoryGrowthMaxMb',
    );
  }
  const now = options.now ?? (() => new Date());
  const started = now();
  const snapshots: PerformanceSnapshot[] = [];
  let cancelled = options.signal?.aborted ?? false;
  for (let index = 0; index < cycles; index += 1) {
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    await options.onProgress?.({ completed: index, total: cycles });
    await core.runReplay(options.replayPath);
    if (settleMs > 0) {
      await settle(options.sleep ?? defaultSleep, settleMs, options.signal);
    }
    if (options.signal?.aborted) {
      cancelled = true;
      break;
    }
    snapshots.push(await core.performanceSnapshot());
    await options.onProgress?.({ completed: index + 1, total: cycles });
  }
  const finished = now();
  const result = analyzeMemoryGrowth(snapshots, {
    id:
      options.createExperimentId?.() ??
      `memory-${started.getTime()}-${Math.random().toString(36).slice(2, 10)}`,
    scenarioId: options.scenarioId,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    target: await observerTargetFingerprint(core),
    maxGrowthMb,
    requestedSamples: cycles,
  });
  if (!cancelled) return result;
  const cancellation = `Experiment was cancelled after ${snapshots.length}/${cycles} cycles`;
  return {
    ...result,
    outcome: 'NOT_VERIFIED',
    findings: result.findings.map((finding) => ({
      ...finding,
      outcome: 'NOT_VERIFIED',
      severity: 'info',
      title: 'Process memory growth experiment was cancelled',
      description:
        'The configured replay sequence did not collect a complete sample set, so the memory-growth budget was not verified.',
      limitations: [...finding.limitations, cancellation],
    })),
    limitations: [...result.limitations, cancellation],
  };
};
