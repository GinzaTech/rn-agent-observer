import { describe, expect, it, vi } from 'vitest';
import type {
  PerformanceSnapshot,
  TargetFingerprint,
} from '@rn-agent-observer/schemas';
import type { ObserverCore } from '../index.js';
import {
  analyzeMemoryGrowth,
  runObserverMemoryGrowth,
} from './memory-growth.js';

const target: TargetFingerprint = {
  platform: 'android',
  deviceId: 'emulator-5554',
  appId: 'dev.example',
};

const snapshot = (value: number | null): PerformanceSnapshot => ({
  timestamp: '2026-08-22T00:00:00.000Z',
  metrics: [
    {
      name: 'memory_mb',
      value,
      unit: 'MB',
      source: 'adb-dumpsys-meminfo',
      timestamp: '2026-08-22T00:00:00.000Z',
      available: value !== null,
      ...(value === null ? { reason: 'Process was not running' } : {}),
    },
  ],
});

const analyze = (values: Array<number | null>, maxGrowthMb = 10) =>
  analyzeMemoryGrowth(values.map(snapshot), {
    id: 'memory-1',
    scenarioId: 'checkout-cycle',
    startedAt: '2026-08-22T00:00:00.000Z',
    finishedAt: '2026-08-22T00:00:10.000Z',
    target,
    maxGrowthMb,
  });

describe('memory growth experiments', () => {
  it('fails sustained process-memory growth beyond the explicit budget', () => {
    const result = analyze([100, 101, 105, 110, 120, 125], 10);

    expect(result.outcome).toBe('FAIL');
    expect(result.growthMb).toBe(22);
    expect(result.slopeMbPerCycle).toBeGreaterThan(0);
    expect(result.findings[0]?.outcome).toBe('FAIL');
  });

  it('does not pass when repeated memory evidence is unavailable', () => {
    const result = analyze([100, null, null, 101, null]);

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.availableSamples).toBe(2);
    expect(result.limitations.at(-1)).toContain('2/5');
  });

  it('replays the exact cycle before every process-memory sample', async () => {
    const runReplay = vi.fn().mockResolvedValue({ outcome: 'complete' });
    const performanceSnapshot = vi.fn().mockResolvedValue(snapshot(100));
    const core = {
      projectRoot: 'C:\\fixture',
      appId: 'dev.example',
      assertActionAuthorized: vi.fn(),
      config: { budgets: { memoryGrowthMaxMb: 5 } },
      deviceInfo: vi.fn().mockResolvedValue({
        id: 'emulator-5554',
        platform: 'android',
        state: 'device',
      }),
      runReplay,
      performanceSnapshot,
    } as unknown as ObserverCore;

    const result = await runObserverMemoryGrowth(core, {
      scenarioId: 'checkout-cycle',
      replayPath: 'checkout.json',
      cycles: 5,
      settleMs: 0,
      createExperimentId: () => 'memory-replayed',
    });

    expect(result.outcome).toBe('PASS');
    expect(core.assertActionAuthorized).toHaveBeenCalledWith(
      'performance-memory-growth',
    );
    expect(runReplay).toHaveBeenCalledTimes(5);
    expect(performanceSnapshot).toHaveBeenCalledTimes(5);
  });

  it('keeps the result and finding honest when cancellation truncates cycles', async () => {
    const controller = new AbortController();
    const core = {
      projectRoot: 'C:\\fixture',
      appId: 'dev.example',
      assertActionAuthorized: vi.fn(),
      config: { budgets: { memoryGrowthMaxMb: 5 } },
      deviceInfo: vi.fn().mockResolvedValue({
        id: 'emulator-5554',
        platform: 'android',
        state: 'device',
      }),
      runReplay: vi.fn().mockResolvedValue({ outcome: 'complete' }),
      performanceSnapshot: vi.fn().mockResolvedValue(snapshot(100)),
    } as unknown as ObserverCore;

    const result = await runObserverMemoryGrowth(core, {
      scenarioId: 'cancelled-cycle',
      replayPath: 'checkout.json',
      cycles: 5,
      settleMs: 1,
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
    });

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.findings[0]?.outcome).toBe('NOT_VERIFIED');
    expect(result.requestedSamples).toBe(5);
    expect(result.availableSamples).toBe(0);
    expect(result.limitations.at(-1)).toContain('cancelled');
  });
});
