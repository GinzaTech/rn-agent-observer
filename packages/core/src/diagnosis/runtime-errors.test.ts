import { describe, expect, it } from 'vitest';
import { diagnoseEvidence } from './rules.js';
import {
  isNonActionablePlatformLog,
  partitionRuntimeErrorLogs,
} from './runtime-errors.js';

const timestamp = '2026-08-24T00:00:00.000Z';

describe('runtime error classification', () => {
  it('classifies non-fatal ReactHost focus soft exceptions as platform noise', () => {
    expect(
      isNonActionablePlatformLog({
        level: 'error',
        source: 'unknown',
        timestamp,
        message:
          'ReactHost: ReactNoCrashSoftException: onWindowFocusChange before context ready',
      }),
    ).toBe(true);
  });

  it('classifies the Android ashmem pinning deprecation as platform noise', () => {
    const warning = {
      level: 'error' as const,
      source: 'ashmem',
      timestamp,
      message:
        'Pinning is deprecated since Android Q. Please use trim or other methods.',
    };
    expect(isNonActionablePlatformLog(warning)).toBe(true);
    expect(partitionRuntimeErrorLogs([warning])).toEqual({
      actionable: [],
      platformWarnings: [warning],
      continuations: [],
    });
  });

  it('classifies the Chromium variations seed warning as platform noise', () => {
    expect(
      isNonActionablePlatformLog({
        level: 'error',
        source: 'chromium',
        timestamp,
        message:
          '[0825/084431.198279:ERROR:variations_seed_loader.cc(39)] Seed missing signature.',
      }),
    ).toBe(true);
  });

  it('never downgrades fatal or independent window errors', () => {
    expect(
      isNonActionablePlatformLog({
        level: 'fatal',
        source: 'ReactHost',
        timestamp,
        message: 'Unhandled SoftException followed by process termination',
      }),
    ).toBe(false);
    expect(
      isNonActionablePlatformLog({
        level: 'error',
        source: 'WindowManager',
        timestamp,
        message: 'BadTokenException while adding application window',
      }),
    ).toBe(false);
  });

  it('keeps diagnosis focused on actionable errors', () => {
    const softException = {
      level: 'error' as const,
      source: 'ReactHost',
      timestamp,
      message: 'Unhandled SoftException: onWindowFocusChange before context',
    };
    expect(diagnoseEvidence({ logs: [softException] }).findings).toHaveLength(
      0,
    );
    expect(
      diagnoseEvidence({
        logs: [
          softException,
          {
            level: 'error',
            source: 'ReactNativeJS',
            timestamp,
            message: 'TypeError: undefined is not a function',
          },
        ],
      }).findings.map((finding) => finding.title),
    ).toContain('Runtime errors captured');
  });

  it('keeps a ReactHost soft-exception stack together without hiding a new root error', () => {
    const entries = [
      {
        level: 'error' as const,
        source: 'unknown',
        timestamp,
        message:
          'ReactHost: Unhandled SoftException: ReactNoCrashSoftException: onWindowFocusChange before context',
      },
      {
        level: 'error' as const,
        source: 'unknown',
        timestamp,
        message:
          'ReactHost: \tat com.facebook.react.runtime.ReactHostImpl.focus(Host.kt:1)',
      },
      {
        level: 'error' as const,
        source: 'unknown',
        timestamp,
        message:
          'ReactHost: \tat android.app.Activity.onWindowFocusChanged(Activity.java:1)',
      },
      {
        level: 'error' as const,
        source: 'unknown',
        timestamp,
        message: 'ReactHost: BadTokenException while adding application window',
      },
    ];

    const partition = partitionRuntimeErrorLogs(entries);
    expect(partition.platformWarnings).toHaveLength(3);
    expect(partition.continuations).toHaveLength(0);
    expect(partition.actionable).toEqual([entries[3]]);
  });
});
