import {
  StartupTimingSchema,
  type StartupTiming,
} from '@rn-agent-observer/schemas';
import type { PerformanceMarkEvent } from '../network/network.js';

const unavailable = (
  capturedAt: string,
  reason: string,
  options: {
    startupId?: string;
    startupType?: PerformanceMarkEvent['startupType'];
    foreground?: boolean;
    startMark?: string;
    interactiveMark?: string;
    source?: string;
  } = {},
): StartupTiming =>
  StartupTimingSchema.parse({
    schemaVersion: '1.0',
    capturedAt,
    outcome: 'NOT_VERIFIED',
    startupId: options.startupId ?? null,
    startupType: options.startupType ?? null,
    foreground: options.foreground ?? null,
    startMark: options.startMark ?? null,
    interactiveMark: options.interactiveMark ?? null,
    metric: {
      name: 'react_native_tti_ms',
      value: null,
      unit: 'ms',
      source: options.source ?? 'rn-instrumentation-performance-mark',
      timestamp: options.interactiveMark ?? capturedAt,
      available: false,
      reason,
    },
    limitations: [reason],
  });

export function summarizeStartupTiming(
  marks: readonly PerformanceMarkEvent[],
  capturedAt = new Date().toISOString(),
): StartupTiming {
  const interactive = [...marks]
    .filter((mark) => mark.name === 'screenInteractive')
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .at(-1);
  if (!interactive) {
    return unavailable(
      capturedAt,
      'No screenInteractive performance mark was observed',
    );
  }
  const start = [...marks]
    .filter(
      (mark) =>
        mark.name === 'nativeLaunchStart' &&
        mark.startupId === interactive.startupId,
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .at(-1);
  const context = {
    startupId: interactive.startupId,
    startupType: interactive.startupType,
    foreground: interactive.foreground,
    ...(start ? { startMark: start.timestamp } : {}),
    interactiveMark: interactive.timestamp,
    source: interactive.source,
  };
  if (!start) {
    return unavailable(
      capturedAt,
      'No matching nativeLaunchStart mark was observed for this startupId',
      context,
    );
  }
  if (start.startupType !== 'cold' || interactive.startupType !== 'cold') {
    return unavailable(
      capturedAt,
      'Only a confirmed cold startup is eligible for TTI measurement',
      context,
    );
  }
  if (!start.foreground || !interactive.foreground) {
    return unavailable(
      capturedAt,
      'Background startup marks are not eligible for TTI measurement',
      context,
    );
  }
  const durationMs =
    start.monotonicMs !== undefined && interactive.monotonicMs !== undefined
      ? interactive.monotonicMs - start.monotonicMs
      : Date.parse(interactive.timestamp) - Date.parse(start.timestamp);
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 300_000) {
    return unavailable(
      capturedAt,
      'Startup mark duration was negative, non-finite, or exceeded five minutes',
      context,
    );
  }
  return StartupTimingSchema.parse({
    schemaVersion: '1.0',
    capturedAt,
    outcome: 'PASS',
    startupId: interactive.startupId,
    startupType: 'cold',
    foreground: true,
    startMark: start.timestamp,
    interactiveMark: interactive.timestamp,
    metric: {
      name: 'react_native_tti_ms',
      value: durationMs,
      unit: 'ms',
      source:
        start.monotonicMs !== undefined && interactive.monotonicMs !== undefined
          ? `${interactive.source}:monotonic`
          : `${interactive.source}:wall-clock`,
      timestamp: interactive.timestamp,
      available: true,
      confidence: 0.95,
    },
    limitations: [
      'TTI is valid only for the app-defined screenInteractive boundary and exact startupId',
    ],
  });
}
