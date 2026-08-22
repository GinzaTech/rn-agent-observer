import { z } from 'zod';
import { ArtifactSchema } from './artifact.js';

export const SessionSchema = z.object({
  id: z.string().min(1),
  projectRoot: z.string().min(1),
  startedAt: z.iso.datetime(),
  stoppedAt: z.iso.datetime().optional(),
  status: z.enum(['active', 'complete', 'failed']),
  artifactIds: z.array(z.string()).default([]),
  artifacts: z.array(ArtifactSchema).default([]),
  timeline: z
    .array(
      z.object({
        id: z.number().int().positive(),
        type: z.string().min(1),
        timestamp: z.iso.datetime(),
        data: z.unknown(),
      }),
    )
    .default([]),
});

export type Session = z.infer<typeof SessionSchema>;
