import { z } from 'zod';

export const BoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const ScreenSnapshotSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  orientation: z.enum(['portrait', 'landscape', 'unknown']),
  timestamp: z.iso.datetime(),
  artifactId: z.string().optional(),
});

export type ScreenSnapshot = z.infer<typeof ScreenSnapshotSchema>;
