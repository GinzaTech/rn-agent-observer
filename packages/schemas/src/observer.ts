import { z } from 'zod';
import { AppStateSchema } from './app-state.js';
import { LogEntrySchema } from './log.js';
import { NetworkSummarySchema } from './network.js';
import { PerformanceSnapshotSchema } from './performance.js';
import { ScreenSnapshotSchema } from './screen.js';

export const ReactRenderStatSchema = z.object({
  componentName: z.string().min(1),
  renderCount: z.number().int().positive(),
  renderDurationMs: z.number().nonnegative().nullable(),
  commitCount: z.number().int().nonnegative().nullable(),
  changedProps: z.array(z.string()),
  timestamp: z.iso.datetime(),
  source: z.string().min(1),
});

export const ObservationSchema = z.object({
  timestamp: z.iso.datetime(),
  route: z.string().nullable(),
  screen: ScreenSnapshotSchema.optional(),
  appState: AppStateSchema.optional(),
  uiTree: z
    .object({
      elementCount: z.number().int().nonnegative(),
      source: z.string(),
    })
    .optional(),
  performance: PerformanceSnapshotSchema.optional(),
  network: NetworkSummarySchema.optional(),
  logs: z
    .object({
      count: z.number().int().nonnegative(),
      errors: z.array(LogEntrySchema),
    })
    .optional(),
});

export const ScreenComparisonSchema = z.object({
  before: z.string(),
  after: z.string(),
  dimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  similarity: z.number().min(0).max(1),
  changedPixels: z.number().int().nonnegative(),
  changedRegions: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
  ),
  diffArtifact: z.string().optional(),
  uiStructure: z
    .object({
      beforeElementCount: z.number().int().nonnegative(),
      afterElementCount: z.number().int().nonnegative(),
      added: z.array(z.string()),
      removed: z.array(z.string()),
      changed: z.array(z.string()),
    })
    .optional(),
});

export type ReactRenderStat = z.infer<typeof ReactRenderStatSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type ScreenComparison = z.infer<typeof ScreenComparisonSchema>;
