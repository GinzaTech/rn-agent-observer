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

export type Metric = z.infer<typeof MetricSchema>;
export type PerformanceSnapshot = z.infer<typeof PerformanceSnapshotSchema>;
