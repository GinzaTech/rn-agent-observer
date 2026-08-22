import { z } from 'zod';

export const TraceSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  startedAt: z.iso.datetime(),
  stoppedAt: z.iso.datetime().optional(),
  artifactId: z.string().optional(),
});

export type Trace = z.infer<typeof TraceSchema>;
