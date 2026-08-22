import { describe, expect, it } from 'vitest';
import type { PerformanceSnapshot } from '@rn-agent-observer/schemas';
import { frameMetricSignature, markFrameMetricsStale } from './freshness.js';

function snapshot(frameTime: number): PerformanceSnapshot {
  const timestamp = '2026-08-22T00:00:00.000Z';
  return {
    timestamp,
    metrics: [
      {
        name: 'frame_time_ms',
        value: frameTime,
        unit: 'ms',
        source: 'test',
        timestamp,
        available: true,
      },
      {
        name: 'frame_sample_count',
        value: 120,
        unit: 'frames',
        source: 'test',
        timestamp,
        available: true,
      },
      {
        name: 'memory_mb',
        value: 500,
        unit: 'MB',
        source: 'test',
        timestamp,
        available: true,
      },
    ],
  };
}

describe('performance freshness', () => {
  it('builds a stable signature from frame metrics only', () => {
    expect(frameMetricSignature(snapshot(16))).toBe(
      frameMetricSignature({
        ...snapshot(16),
        metrics: snapshot(16).metrics.map((metric) =>
          metric.name === 'memory_mb' ? { ...metric, value: 700 } : metric,
        ),
      }),
    );
    expect(frameMetricSignature(snapshot(16))).not.toBe(
      frameMetricSignature(snapshot(20)),
    );
  });

  it('marks only frame-derived metrics unavailable', () => {
    const stale = markFrameMetricsStale(
      snapshot(16),
      '2026-08-22T00:00:00.000Z',
    );
    expect(
      stale.metrics.find((metric) => metric.name === 'frame_time_ms'),
    ).toMatchObject({ available: false, value: null });
    expect(
      stale.metrics.find((metric) => metric.name === 'memory_mb'),
    ).toMatchObject({ available: true, value: 500 });
  });
});
