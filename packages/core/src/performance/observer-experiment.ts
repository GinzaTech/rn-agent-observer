import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  PerformanceBudgetSchema,
  type PerformanceBaseline,
  type PerformanceBudget,
  type PerformanceExperimentResult,
  type TargetFingerprint,
} from '@rn-agent-observer/schemas';
import { parseDocument } from 'yaml';
import type { ObserverCore } from '../index.js';
import {
  measureAndroidColdStart,
  prepareAndroidColdStart,
  type AndroidColdStartPreparation,
} from './android-startup.js';
import {
  runPerformanceExperiment,
  type PerformanceExperimentProgress,
} from './experiment.js';

export const DEFAULT_PERFORMANCE_BUDGETS: readonly PerformanceBudget[] = [
  PerformanceBudgetSchema.parse({
    id: 'ui-fps-median',
    metric: 'ui_fps',
    unit: 'fps',
    statistic: 'median',
    operator: 'gte',
    threshold: 55,
    maxCoefficientOfVariation: 0.2,
    maxRegressionPercent: 10,
  }),
  PerformanceBudgetSchema.parse({
    id: 'worst-frame-p95',
    metric: 'worst_frame_ms',
    unit: 'ms',
    statistic: 'p95',
    operator: 'lte',
    threshold: 100,
    maxRegressionPercent: 20,
  }),
  PerformanceBudgetSchema.parse({
    id: 'js-blocking-p95',
    metric: 'js_blocking_ms',
    unit: 'ms',
    statistic: 'p95',
    operator: 'lte',
    threshold: 50,
    maxRegressionPercent: 20,
  }),
];

export interface ObserverPerformanceExperimentOptions {
  scenarioId: string;
  mode: 'interaction' | 'startup' | 'idle';
  replayPath?: string;
  samples?: number;
  warmupSamples?: number;
  intervalMs?: number;
  budgets?: readonly PerformanceBudget[];
  baseline?: PerformanceBaseline;
  sleep?: (durationMs: number) => Promise<void>;
  now?: () => Date;
  createExperimentId?: () => string;
  signal?: AbortSignal;
  onProgress?: (
    progress: PerformanceExperimentProgress,
  ) => void | Promise<void>;
}

const packageVersions = (
  projectRoot: string,
): { reactNativeVersion?: string; expoVersion?: string } => {
  try {
    const packageFile = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...packageFile.devDependencies,
      ...packageFile.dependencies,
    };
    return {
      ...(dependencies['react-native']
        ? { reactNativeVersion: dependencies['react-native'] }
        : {}),
      ...(dependencies.expo ? { expoVersion: dependencies.expo } : {}),
    };
  } catch {
    return {};
  }
};

export const observerTargetFingerprint = async (
  core: ObserverCore,
): Promise<TargetFingerprint> => {
  const device = await core.deviceInfo();
  return {
    platform: 'android',
    deviceId: device.id,
    appId: core.appId,
    ...(device.osVersion
      ? { operatingSystem: `Android ${device.osVersion}` }
      : {}),
    ...(device.model ? { deviceClass: device.model } : {}),
    ...packageVersions(core.projectRoot),
  };
};

export const loadPerformanceBudgets = async (
  budgetPath: string,
): Promise<PerformanceBudget[]> => {
  const path = resolve(budgetPath);
  const source = await readFile(path, 'utf8');
  if (Buffer.byteLength(source, 'utf8') > 1_048_576) {
    throw new RangeError(
      'Performance budget file exceeds the 1 MiB safety limit',
    );
  }
  let value: unknown;
  if (['.yaml', '.yml'].includes(extname(path).toLowerCase())) {
    const document = parseDocument(source, {
      prettyErrors: false,
      uniqueKeys: true,
    });
    if (document.errors.length > 0) {
      throw new TypeError(
        `Performance budget YAML is invalid: ${document.errors.map((error) => error.message).join('; ')}`,
        { cause: document.errors[0] },
      );
    }
    value = document.toJS({ maxAliasCount: 25 }) as unknown;
  } else {
    try {
      value = JSON.parse(source) as unknown;
    } catch (error) {
      throw new TypeError(
        `Performance budget JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  if (!Array.isArray(value)) {
    throw new TypeError('Performance budget file must contain an array');
  }
  return value.map((budget) => PerformanceBudgetSchema.parse(budget));
};

export const runObserverPerformanceExperiment = async (
  core: ObserverCore,
  options: ObserverPerformanceExperimentOptions,
): Promise<PerformanceExperimentResult> => {
  if (options.mode === 'interaction' && !options.replayPath) {
    throw new TypeError(
      'Interaction performance experiments require replayPath',
    );
  }
  if (options.mode === 'interaction') {
    core.assertActionAuthorized('performance-interaction');
  } else if (options.mode === 'startup') {
    core.assertActionAuthorized('performance-startup');
  }
  const replayPath = options.replayPath;
  let startupPreparation: AndroidColdStartPreparation = {
    prepared: false,
    reason: 'Cold-start preparation has not run',
  };
  const configuredStartupBudget =
    options.mode === 'startup' ? core.config.budgets.coldStartMaxMs : undefined;
  const startupBudgets =
    configuredStartupBudget === undefined
      ? []
      : [
          PerformanceBudgetSchema.parse({
            id: 'cold-start-total-p95',
            metric: 'cold_start_total_time_ms',
            unit: 'ms',
            statistic: 'p95',
            operator: 'lte',
            threshold: configuredStartupBudget,
            severity: 'high',
            minimumAvailableSamples: 3,
            maxCoefficientOfVariation: 0.25,
          }),
        ];
  return runPerformanceExperiment({
    scenarioId: options.scenarioId,
    scenarioMode: options.mode,
    target: await observerTargetFingerprint(core),
    ...(options.samples !== undefined ? { samples: options.samples } : {}),
    ...(options.warmupSamples !== undefined
      ? { warmupSamples: options.warmupSamples }
      : {}),
    ...(options.intervalMs !== undefined
      ? { intervalMs: options.intervalMs }
      : {}),
    budgets:
      options.budgets ??
      (options.mode === 'startup'
        ? startupBudgets
        : DEFAULT_PERFORMANCE_BUDGETS),
    ...(options.baseline ? { baseline: options.baseline } : {}),
    collect: async () =>
      options.mode === 'startup'
        ? (
            await measureAndroidColdStart(
              core.adb,
              core.appId,
              startupPreparation,
            )
          ).snapshot
        : core.performanceSnapshot(),
    ...(options.mode === 'interaction' && replayPath
      ? { prepareSample: async () => void (await core.runReplay(replayPath)) }
      : options.mode === 'startup'
        ? {
            prepareSample: async () => {
              startupPreparation = await prepareAndroidColdStart(
                core.adb,
                core.appId,
              );
            },
          }
        : {}),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.createExperimentId
      ? { createExperimentId: options.createExperimentId }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
};
