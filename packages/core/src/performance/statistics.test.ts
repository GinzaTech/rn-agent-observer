import { describe, expect, it } from 'vitest';
import { diagnoseEvidence } from '../diagnosis/rules.js';
import { summarizeNetwork } from '../network/network.js';
import type { PerformanceSnapshot } from '@rn-agent-observer/schemas';
import { bootstrapMeanDifference } from './experiment.js';

function snapshot(metrics: Array<[string, number]>): PerformanceSnapshot {
  return {
    timestamp: '2026-08-23T00:00:00.000Z',
    metrics: metrics.map(([name, value]) => ({
      name,
      value,
      unit: name.includes('fps') ? 'fps' : name.includes('hz') ? 'Hz' : 'ms',
      source: 'test',
      timestamp: '2026-08-23T00:00:00.000Z',
      available: true,
    })),
  };
}

describe('device-aware fps thresholds', () => {
  it('scales the low-fps threshold with the measured refresh rate', () => {
    const highRefresh = diagnoseEvidence({
      performance: snapshot([
        ['display_refresh_hz', 120],
        ['ui_fps', 50],
      ]),
    });
    // 50fps on 120Hz = below the derived 90fps budget -> flagged.
    expect(
      highRefresh.findings.some((finding) =>
        finding.title.includes('frame rate'),
      ),
    ).toBe(true);
    const standardRefresh = diagnoseEvidence({
      performance: snapshot([
        ['display_refresh_hz', 60],
        ['ui_fps', 50],
      ]),
    });
    // 50fps on 60Hz is above the derived 45fps budget -> not flagged.
    expect(
      standardRefresh.findings.some((finding) =>
        finding.title.includes('frame rate'),
      ),
    ).toBe(false);
  });

  it('respects an explicit uiFpsLow override over the derived value', () => {
    const result = diagnoseEvidence(
      {
        performance: snapshot([
          ['display_refresh_hz', 120],
          ['ui_fps', 50],
        ]),
      },
      { uiFpsLow: 40 },
    );
    expect(
      result.findings.some((finding) => finding.title.includes('frame rate')),
    ).toBe(false);
  });
});

describe('network percentile disclosure', () => {
  it('flags tail percentiles computed from few samples', () => {
    const summary = summarizeNetwork([
      {
        id: '1',
        method: 'GET',
        url: '/a',
        status: 200,
        durationMs: 100,
        timestamp: '2026-08-23T00:00:00.000Z',
        source: 'test',
      },
      {
        id: '2',
        method: 'GET',
        url: '/b',
        status: 200,
        durationMs: 2000,
        timestamp: '2026-08-23T00:00:01.000Z',
        source: 'test',
      },
    ]);
    expect(summary.latencySampleCount).toBe(2);
    expect(summary.percentileLowConfidence).toBe(true);
  });
});

describe('paired bootstrap mean difference', () => {
  it('detects a clear improvement with a CI excluding zero', () => {
    const interval = bootstrapMeanDifference(
      [10, 11, 10, 12, 11],
      [20, 21, 20, 22, 21],
    );
    expect(interval).not.toBeNull();
    expect(interval?.meanDifference).toBeLessThan(0);
    expect(interval?.confidenceHigh).toBeLessThan(0);
  });

  it('returns a CI straddling zero for pure noise', () => {
    const interval = bootstrapMeanDifference(
      [10, 12, 10, 12, 10],
      [10, 12, 10, 12, 10],
    );
    expect(interval?.confidenceLow ?? 1).toBeLessThanOrEqual(0);
    expect(interval?.confidenceHigh ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('needs at least two paired samples', () => {
    expect(bootstrapMeanDifference([1], [2])).toBeNull();
  });
});
