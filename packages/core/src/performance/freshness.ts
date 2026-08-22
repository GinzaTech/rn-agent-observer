import type { PerformanceSnapshot } from '@rn-agent-observer/schemas';

const FRAME_METRIC_NAMES = new Set([
  'ui_fps',
  'frame_time_ms',
  'worst_frame_ms',
  'dropped_frames',
  'frame_sample_count',
]);

export function frameMetricSignature(
  snapshot: PerformanceSnapshot,
): string | null {
  const values = snapshot.metrics
    .filter((metric) => FRAME_METRIC_NAMES.has(metric.name))
    .map((metric) => [metric.name, metric.available, metric.value]);
  const sampleCount = snapshot.metrics.find(
    (metric) => metric.name === 'frame_sample_count',
  );
  if (!sampleCount?.available || sampleCount.value === null) return null;
  return JSON.stringify(values);
}

export function markFrameMetricsStale(
  snapshot: PerformanceSnapshot,
  previousTimestamp: string,
): PerformanceSnapshot {
  return {
    ...snapshot,
    metrics: snapshot.metrics.map((metric) =>
      FRAME_METRIC_NAMES.has(metric.name)
        ? {
            ...metric,
            value: null,
            available: false,
            reason: `No new gfx frame samples since ${previousTimestamp}`,
          }
        : metric,
    ),
  };
}
