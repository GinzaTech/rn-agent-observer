import { describe, expect, it } from 'vitest';
import type { PerformanceMarkEvent } from '../network/network.js';
import { summarizeStartupTiming } from './startup-mark.js';

const mark = (
  name: PerformanceMarkEvent['name'],
  timestamp: string,
  options: Partial<PerformanceMarkEvent> = {},
): PerformanceMarkEvent => ({
  name,
  startupId: 'cold-1',
  timestamp,
  startupType: 'cold',
  foreground: true,
  source: 'fixture',
  ...options,
});

describe('React Native startup timing marks', () => {
  it('measures a matching foreground cold-start pair', () => {
    expect(
      summarizeStartupTiming([
        mark('nativeLaunchStart', '2026-08-25T00:00:00.000Z', {
          monotonicMs: 100,
        }),
        mark('screenInteractive', '2026-08-25T00:00:01.500Z', {
          monotonicMs: 1600,
        }),
      ]),
    ).toMatchObject({
      outcome: 'PASS',
      startupType: 'cold',
      metric: { available: true, value: 1500, unit: 'ms' },
    });
  });

  it('keeps missing, warm, background, and mismatched evidence unavailable', () => {
    expect(summarizeStartupTiming([])).toMatchObject({
      outcome: 'NOT_VERIFIED',
      metric: { available: false },
    });
    expect(
      summarizeStartupTiming([
        mark('nativeLaunchStart', '2026-08-25T00:00:00.000Z'),
        mark('screenInteractive', '2026-08-25T00:00:01.000Z', {
          startupType: 'warm',
        }),
      ]),
    ).toMatchObject({ outcome: 'NOT_VERIFIED' });
    expect(
      summarizeStartupTiming([
        mark('nativeLaunchStart', '2026-08-25T00:00:00.000Z'),
        mark('screenInteractive', '2026-08-25T00:00:01.000Z', {
          foreground: false,
        }),
      ]),
    ).toMatchObject({ outcome: 'NOT_VERIFIED' });
    expect(
      summarizeStartupTiming([
        mark('nativeLaunchStart', '2026-08-25T00:00:00.000Z'),
        mark('screenInteractive', '2026-08-25T00:00:01.000Z', {
          startupId: 'other',
        }),
      ]),
    ).toMatchObject({ outcome: 'NOT_VERIFIED' });
  });
});
