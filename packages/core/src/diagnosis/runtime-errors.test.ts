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
        source: 'ReactHost',
        timestamp,
        message:
          'ReactNoCrashSoftException: onWindowFocusChange before context ready',
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
        source: 'ReactHost',
        timestamp,
        message:
          'Unhandled SoftException: ReactNoCrashSoftException: onWindowFocusChange before context',
      },
      {
        level: 'error' as const,
        source: 'ReactHost',
        timestamp,
        message:
          '  at com.facebook.react.runtime.ReactHostImpl.focus(Host.kt:1)',
      },
      {
        level: 'error' as const,
        source: 'ReactHost',
        timestamp,
        message:
          '  at android.app.Activity.onWindowFocusChanged(Activity.java:1)',
      },
      {
        level: 'error' as const,
        source: 'ReactHost',
        timestamp,
        message: 'BadTokenException while adding application window',
      },
    ];

    const partition = partitionRuntimeErrorLogs(entries);
    expect(partition.platformWarnings).toHaveLength(3);
    expect(partition.continuations).toHaveLength(0);
    expect(partition.actionable).toEqual([entries[3]]);
  });
});
