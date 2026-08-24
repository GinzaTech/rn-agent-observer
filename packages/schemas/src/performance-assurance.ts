import { z } from 'zod';
import {
  AssuranceFindingSchema,
  AssuranceOutcomeSchema,
  TargetFingerprintSchema,
} from './assurance.js';

export const PerformanceStatisticSchema = z.enum([
  'median',
  'p95',
  'mean',
  'min',
  'max',
]);

export const PerformanceBudgetSchema = z.object({
  id: z.string().min(1),
  metric: z.string().min(1),
  unit: z.string().min(1),
  statistic: PerformanceStatisticSchema.default('p95'),
  operator: z.enum(['lte', 'gte']),
  threshold: z.number().finite(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('high'),
  minimumAvailableSamples: z.number().int().min(1).max(50).default(3),
  maxCoefficientOfVariation: z.number().nonnegative().optional(),
  maxRegressionPercent: z.number().nonnegative().optional(),
});

export const PerformanceMetricSummarySchema = z.object({
  metric: z.string().min(1),
  unit: z.string().min(1),
  totalSamples: z.number().int().nonnegative(),
  availableSamples: z.number().int().nonnegative(),
  unavailableSamples: z.number().int().nonnegative(),
  min: z.number().finite().nullable(),
  max: z.number().finite().nullable(),
  mean: z.number().finite().nullable(),
  median: z.number().finite().nullable(),
  p95: z.number().finite().nullable(),
  standardDeviation: z.number().nonnegative().nullable(),
  coefficientOfVariation: z.number().nonnegative().nullable(),
  sources: z.array(z.string().min(1)),
  /** Raw per-sample values enabling paired before/after statistics. */
  sampleValues: z.array(z.number().finite()).max(50).optional(),
  firstTimestamp: z.iso.datetime().optional(),
  lastTimestamp: z.iso.datetime().optional(),
  unavailableReasons: z.array(z.string().min(1)).default([]),
});

export const PerformanceBaselineSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  capturedAt: z.iso.datetime(),
  target: TargetFingerprintSchema,
  sampleCount: z.number().int().positive(),
  metrics: z.array(PerformanceMetricSummarySchema),
});

export const PerformanceExperimentResultSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: z.string().min(1),
  scenarioId: z.string().min(1),
  scenarioMode: z.enum(['interaction', 'startup', 'idle']),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  target: TargetFingerprintSchema,
  requestedSamples: z.number().int().positive(),
  warmupSamples: z.number().int().nonnegative(),
  outcome: AssuranceOutcomeSchema,
  metrics: z.array(PerformanceMetricSummarySchema),
  budgets: z.array(PerformanceBudgetSchema),
  findings: z.array(AssuranceFindingSchema),
  limitations: z.array(z.string().min(1)).default([]),
});

export type PerformanceStatistic = z.infer<typeof PerformanceStatisticSchema>;
export type PerformanceBudget = z.infer<typeof PerformanceBudgetSchema>;
export type PerformanceMetricSummary = z.infer<
  typeof PerformanceMetricSummarySchema
>;
export type PerformanceBaseline = z.infer<typeof PerformanceBaselineSchema>;
export type PerformanceExperimentResult = z.infer<
  typeof PerformanceExperimentResultSchema
>;
