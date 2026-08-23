import { describe, expect, it } from 'vitest';
import {
  PerformanceBaselineSchema,
  PerformanceBudgetSchema,
} from './performance-assurance.js';

describe('performance assurance contracts', () => {
  it('applies repeated-sample budget defaults', () => {
    const budget = PerformanceBudgetSchema.parse({
      id: 'frame-p95',
      metric: 'frame_time_ms',
      unit: 'ms',
      operator: 'lte',
      threshold: 16.7,
    });

    expect(budget.statistic).toBe('p95');
    expect(budget.minimumAvailableSamples).toBe(3);
  });

  it('requires a fingerprinted target in performance baselines', () => {
    expect(
      PerformanceBaselineSchema.safeParse({
        schemaVersion: '1.0',
        id: 'baseline-1',
        scenarioId: 'checkout',
        capturedAt: '2026-08-22T00:00:00.000Z',
        sampleCount: 5,
        metrics: [],
      }).success,
    ).toBe(false);
  });
});
