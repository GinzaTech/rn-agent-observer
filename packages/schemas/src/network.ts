import { z } from 'zod';

export const NetworkRequestSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  url: z.string().min(1),
  status: z.number().int().optional(),
  durationMs: z.number().nonnegative().optional(),
  requestBytes: z.number().int().nonnegative().optional(),
  responseBytes: z.number().int().nonnegative().optional(),
  requestBodyPreview: z.string().optional(),
  responseBodyPreview: z.string().optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  timestamp: z.iso.datetime(),
  source: z.string().min(1),
  error: z.string().optional(),
});

export const NetworkSummarySchema = z.object({
  requestCount: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  averageLatencyMs: z.number().nonnegative().nullable(),
  p50Ms: z.number().nonnegative().nullable(),
  p95Ms: z.number().nonnegative().nullable(),
  p99Ms: z.number().nonnegative().nullable(),
  /** Latency samples the percentiles were computed from. */
  latencySampleCount: z.number().int().nonnegative().default(0),
  /** True when the sample count was too small for the requested percentile. */
  percentileLowConfidence: z.boolean().default(false),
  totalBytes: z.number().int().nonnegative(),
  slowestEndpoints: z.array(
    z.object({
      url: z.string(),
      method: z.string(),
      durationMs: z.number().nonnegative(),
    }),
  ),
});

export type NetworkRequest = z.infer<typeof NetworkRequestSchema>;
export type NetworkSummary = z.infer<typeof NetworkSummarySchema>;
