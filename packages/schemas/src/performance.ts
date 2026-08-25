import { z } from 'zod';

export const MetricSchema = z.object({
  name: z.string().min(1),
  value: z.number().nullable(),
  unit: z.string().min(1),
  source: z.string().min(1),
  timestamp: z.iso.datetime(),
  available: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

export const PerformanceSnapshotSchema = z.object({
  timestamp: z.iso.datetime(),
  metrics: z.array(MetricSchema),
});

export const StartupTimingSchema = z.object({
  schemaVersion: z.literal('1.0'),
  capturedAt: z.iso.datetime(),
  outcome: z.enum(['PASS', 'NOT_VERIFIED']),
  startupId: z.string().min(1).max(80).nullable(),
  startupType: z.enum(['cold', 'warm', 'hot', 'unknown']).nullable(),
  foreground: z.boolean().nullable(),
  startMark: z.iso.datetime().nullable(),
  interactiveMark: z.iso.datetime().nullable(),
  metric: MetricSchema,
  limitations: z.array(z.string().min(1)).default([]),
});

export type Metric = z.infer<typeof MetricSchema>;
export type PerformanceSnapshot = z.infer<typeof PerformanceSnapshotSchema>;
export type StartupTiming = z.infer<typeof StartupTimingSchema>;
