import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ObserverCore } from '../index.js';
import {
  loadPerformanceBudgets,
  runObserverPerformanceExperiment,
} from './observer-experiment.js';

describe('ObserverCore performance experiment adapter', () => {
  it('replays the exact interaction before every warmup and measured sample', async () => {
    const runReplay = vi.fn().mockResolvedValue({ outcome: 'complete' });
    const performanceSnapshot = vi.fn().mockResolvedValue({
      timestamp: '2026-08-22T00:00:00.000Z',
      metrics: [
        {
          name: 'ui_fps',
          value: 60,
          unit: 'fps',
          source: 'adb-gfxinfo',
          timestamp: '2026-08-22T00:00:00.000Z',
          available: true,
        },
      ],
    });
    const core = {
      projectRoot: 'C:\\fixture',
      appId: 'dev.example',
      assertActionAuthorized: vi.fn(),
      deviceInfo: vi.fn().mockResolvedValue({
        id: 'emulator-5554',
        platform: 'android',
        state: 'device',
        osVersion: '16',
        model: 'Pixel',
      }),
      runReplay,
      performanceSnapshot,
    } as unknown as ObserverCore;

    const result = await runObserverPerformanceExperiment(core, {
      scenarioId: 'checkout-scroll',
      mode: 'interaction',
      replayPath: 'checkout.json',
      samples: 3,
      warmupSamples: 1,
      intervalMs: 0,
      budgets: [
        {
          id: 'ui-fps',
          metric: 'ui_fps',
          unit: 'fps',
          statistic: 'median',
          operator: 'gte',
          threshold: 55,
          severity: 'high',
          minimumAvailableSamples: 3,
        },
      ],
      createExperimentId: () => 'experiment-1',
    });

    expect(result.outcome).toBe('PASS');
    expect(core.assertActionAuthorized).toHaveBeenCalledWith(
      'performance-interaction',
    );
    expect(runReplay).toHaveBeenCalledTimes(4);
    expect(performanceSnapshot).toHaveBeenCalledTimes(4);
  });

  it('loads JSON or YAML budget arrays with schema validation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rn-observer-budgets-'));
    try {
      const path = join(directory, 'budgets.yaml');
      await writeFile(
        path,
        `- id: ui-fps
  metric: ui_fps
  unit: fps
  statistic: median
  operator: gte
  threshold: 55
`,
      );

      await expect(loadPerformanceBudgets(path)).resolves.toEqual([
        expect.objectContaining({ id: 'ui-fps', minimumAvailableSamples: 3 }),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('repeats a proven Android cold start and applies the configured budget', async () => {
    const shell = vi.fn(async (args: readonly string[]) => {
      if (args[0] === 'pidof') return '';
      if (args[0] === 'cmd') return 'dev.example/.MainActivity';
      if (args[0] === 'am' && args[1] === 'start') {
        return `Status: ok
LaunchState: COLD
Activity: dev.example/.MainActivity
ThisTime: 410
TotalTime: 512
WaitTime: 530`;
      }
      return '';
    });
    const core = {
      projectRoot: 'C:\\fixture',
      appId: 'dev.example',
      assertActionAuthorized: vi.fn(),
      config: { budgets: { coldStartMaxMs: 600 } },
      adb: { shell },
      deviceInfo: vi.fn().mockResolvedValue({
        id: 'emulator-5554',
        platform: 'android',
        state: 'device',
        osVersion: '16',
        model: 'Pixel',
      }),
    } as unknown as ObserverCore;

    const result = await runObserverPerformanceExperiment(core, {
      scenarioId: 'cold-start',
      mode: 'startup',
      samples: 3,
      warmupSamples: 0,
      intervalMs: 0,
      createExperimentId: () => 'startup-1',
    });

    expect(result.outcome).toBe('PASS');
    expect(core.assertActionAuthorized).toHaveBeenCalledWith(
      'performance-startup',
    );
    expect(result.metrics).toContainEqual(
      expect.objectContaining({
        metric: 'cold_start_total_time_ms',
        median: 512,
        availableSamples: 3,
      }),
    );
    expect(result.limitations[0]).toContain('cold foreground starts');
    expect(shell).toHaveBeenCalledTimes(12);
  });
});
