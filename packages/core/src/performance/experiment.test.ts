import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  PerformanceBudget,
  PerformanceSnapshot,
  TargetFingerprint,
} from '@rn-agent-observer/schemas';
import {
  analyzePerformanceSamples,
  createPerformanceBaseline,
  loadPerformanceBaseline,
  runPerformanceExperiment,
  writePerformanceBaseline,
} from './experiment.js';

const target: TargetFingerprint = {
  platform: 'android',
  deviceId: 'emulator-5554',
  appId: 'dev.rnagentobserver.demo',
  operatingSystem: 'Android 16',
  reactNativeVersion: '0.81.0',
};

const snapshot = (
  value: number | null,
  options: { available?: boolean; timestamp?: string } = {},
): PerformanceSnapshot => ({
  timestamp: options.timestamp ?? '2026-08-22T00:00:00.000Z',
  metrics: [
    {
      name: 'frame_time_ms',
      value,
      unit: 'ms',
      source: 'adb-gfxinfo',
      timestamp: options.timestamp ?? '2026-08-22T00:00:00.000Z',
      available: options.available ?? value !== null,
      ...(value === null ? { reason: 'No fresh frame window' } : {}),
    },
  ],
});

const budget = (
  overrides: Partial<PerformanceBudget> = {},
): PerformanceBudget => ({
  id: 'frame-p95',
  metric: 'frame_time_ms',
  unit: 'ms',
  statistic: 'p95',
  operator: 'lte',
  threshold: 16.7,
  severity: 'high',
  minimumAvailableSamples: 3,
  ...overrides,
});

const analyze = (
  samples: PerformanceSnapshot[],
  budgets: PerformanceBudget[] = [budget()],
) =>
  analyzePerformanceSamples(samples, {
    id: 'experiment-1',
    scenarioId: 'checkout-scroll',
    scenarioMode: 'interaction',
    startedAt: '2026-08-22T00:00:00.000Z',
    finishedAt: '2026-08-22T00:00:01.000Z',
    target,
    requestedSamples: samples.length,
    warmupSamples: 1,
    budgets,
  });

describe('performance experiments', () => {
  it('computes repeated-sample statistics and evaluates a budget', () => {
    const result = analyze(
      [10, 11, 12, 13, 14].map((value) => snapshot(value)),
    );

    expect(result.outcome).toBe('PASS');
    expect(result.metrics[0]).toMatchObject({
      availableSamples: 5,
      mean: 12,
      median: 12,
      p95: 14,
      min: 10,
      max: 14,
    });
    expect(result.findings[0]).toMatchObject({ outcome: 'PASS' });
  });

  it('fails a breached budget and unstable repeated samples', () => {
    const result = analyze(
      [10, 30, 50].map((value) => snapshot(value)),
      [budget({ threshold: 20, maxCoefficientOfVariation: 0.1 })],
    );

    expect(result.outcome).toBe('FAIL');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'performance.frame-p95',
          outcome: 'FAIL',
        }),
        expect.objectContaining({
          ruleId: 'performance.frame-p95.variance',
          outcome: 'FAIL',
        }),
      ]),
    );
  });

  it('returns NOT_VERIFIED when availability is insufficient', () => {
    const result = analyze([
      snapshot(10),
      snapshot(null),
      snapshot(null),
      snapshot(null),
    ]);

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.findings[0]?.limitations[0]).toContain('1/3');
  });

  it('compares only compatible fingerprinted baselines', () => {
    const baselineResult = analyze(
      [10, 10, 10].map((value) => snapshot(value)),
    );
    const baseline = createPerformanceBaseline(baselineResult);
    const currentOptions = {
      id: 'experiment-current',
      scenarioId: 'checkout-scroll',
      scenarioMode: 'interaction' as const,
      startedAt: '2026-08-22T00:00:00.000Z',
      finishedAt: '2026-08-22T00:00:01.000Z',
      target,
      requestedSamples: 3,
      warmupSamples: 1,
      budgets: [budget({ threshold: 20, maxRegressionPercent: 10 })],
      baseline,
    };
    const regressed = analyzePerformanceSamples(
      [12, 12, 12].map((value) => snapshot(value)),
      currentOptions,
    );
    const mismatch = analyzePerformanceSamples(
      [12, 12, 12].map((value) => snapshot(value)),
      {
        ...currentOptions,
        target: { ...target, deviceId: 'different-device' },
      },
    );

    expect(regressed.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'performance.frame-p95.regression',
        outcome: 'FAIL',
      }),
    );
    expect(mismatch.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'performance.frame-p95.regression',
        outcome: 'NOT_VERIFIED',
      }),
    );
  });

  it('repeats the exact scenario and discards warmup samples', async () => {
    const prepareSample = vi.fn().mockResolvedValue(undefined);
    const collect = vi
      .fn()
      .mockResolvedValueOnce(snapshot(999))
      .mockResolvedValue(snapshot(10));
    const dates = [
      new Date('2026-08-22T00:00:00.000Z'),
      new Date('2026-08-22T00:00:01.000Z'),
    ];
    const result = await runPerformanceExperiment({
      scenarioId: 'checkout-scroll',
      scenarioMode: 'interaction',
      target,
      samples: 3,
      warmupSamples: 1,
      intervalMs: 0,
      budgets: [budget()],
      prepareSample,
      collect,
      now: () => dates.shift() ?? new Date('2026-08-22T00:00:01.000Z'),
      createExperimentId: () => 'experiment-repeated',
    });

    expect(prepareSample).toHaveBeenCalledTimes(4);
    expect(collect).toHaveBeenCalledTimes(4);
    expect(result.metrics[0]?.max).toBe(10);
  });

  it('refuses interaction experiments that cannot repeat the interaction', async () => {
    await expect(
      runPerformanceExperiment({
        scenarioId: 'checkout-scroll',
        scenarioMode: 'interaction',
        target,
        samples: 3,
        budgets: [budget()],
        collect: async () => snapshot(10),
      }),
    ).rejects.toThrow('require prepareSample');
  });

  it('returns a partial NOT_VERIFIED result when cancelled and reports progress', async () => {
    const controller = new AbortController();
    const collect = vi.fn().mockResolvedValue(snapshot(10));
    const progress: number[] = [];
    const result = await runPerformanceExperiment({
      scenarioId: 'idle-window',
      scenarioMode: 'idle',
      target,
      samples: 5,
      warmupSamples: 0,
      intervalMs: 0,
      budgets: [budget()],
      collect,
      signal: controller.signal,
      onProgress: ({ completed }) => {
        progress.push(completed);
        if (completed === 1) controller.abort();
      },
      createExperimentId: () => 'experiment-cancelled',
    });

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.limitations).toContain(
      'Experiment was cancelled after 1/5 measurement samples',
    );
    expect(collect).toHaveBeenCalledOnce();
    expect(progress).toEqual([0, 1]);
  });

  it('round-trips a versioned performance baseline with integrity metadata', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rn-observer-baseline-'));
    try {
      const result = analyze([10, 10, 10].map((value) => snapshot(value)));
      const baseline = createPerformanceBaseline(result);
      const path = join(directory, 'baseline.json');
      const written = await writePerformanceBaseline(path, baseline);

      expect(written.sha256).toHaveLength(64);
      expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(
        '1.0',
      );
      await expect(loadPerformanceBaseline(path)).resolves.toEqual(baseline);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('can exclusively create a baseline without overwriting an existing file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rn-observer-baseline-'));
    try {
      const result = analyze([10, 10, 10].map((value) => snapshot(value)));
      const baseline = createPerformanceBaseline(result);
      const path = join(directory, 'baseline.json');
      await writeFile(path, 'preserve-this-content', 'utf8');

      await expect(
        writePerformanceBaseline(path, baseline, { noOverwrite: true }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      await expect(readFile(path, 'utf8')).resolves.toBe(
        'preserve-this-content',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
