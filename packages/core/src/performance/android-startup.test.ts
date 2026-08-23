import { describe, expect, it, vi } from 'vitest';
import {
  measureAndroidColdStart,
  parseAmStartWait,
  prepareAndroidColdStart,
  type AndroidShellExecutor,
} from './android-startup.js';

describe('Android cold startup evidence', () => {
  it('parses am start -W fields without inventing missing values', () => {
    expect(
      parseAmStartWait(`Status: ok
LaunchState: COLD
Activity: dev.example/.MainActivity
ThisTime: 410
TotalTime: 512
WaitTime: 530
Complete`),
    ).toEqual({
      status: 'ok',
      launchState: 'COLD',
      activity: 'dev.example/.MainActivity',
      thisTimeMs: 410,
      totalTimeMs: 512,
      waitTimeMs: 530,
    });
  });

  it('publishes metrics only when Android explicitly proves a cold launch', async () => {
    const executor: AndroidShellExecutor = {
      shell: vi.fn().mockResolvedValueOnce('dev.example/.MainActivity')
        .mockResolvedValueOnce(`Status: ok
LaunchState: COLD
Activity: dev.example/.MainActivity
ThisTime: 410
TotalTime: 512
WaitTime: 530`),
    };
    const measured = await measureAndroidColdStart(
      executor,
      'dev.example',
      { prepared: true },
      { now: () => new Date('2026-08-22T00:00:00.000Z') },
    );

    expect(measured.snapshot.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'cold_start_total_time_ms',
          value: 512,
          available: true,
        }),
      ]),
    );
    expect(measured.limitations[0]).toContain('does not prove');
  });

  it('marks warm launches unavailable instead of reporting them as cold', async () => {
    const executor: AndroidShellExecutor = {
      shell: vi.fn().mockResolvedValueOnce('dev.example/.MainActivity')
        .mockResolvedValueOnce(`Status: ok
LaunchState: WARM
TotalTime: 50`),
    };
    const measured = await measureAndroidColdStart(executor, 'dev.example', {
      prepared: true,
    });

    expect(measured.snapshot.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'cold_start_total_time_ms',
          value: null,
          available: false,
          reason: 'Android reported LaunchState=WARM, not COLD',
        }),
      ]),
    );
  });

  it('verifies that force-stop removed the process before measurement', async () => {
    const shell = vi
      .fn<AndroidShellExecutor['shell']>()
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    await expect(
      prepareAndroidColdStart({ shell }, 'dev.example'),
    ).resolves.toEqual({ prepared: true });
    expect(shell).toHaveBeenNthCalledWith(1, [
      'am',
      'force-stop',
      'dev.example',
    ]);
  });
});
