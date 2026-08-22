import { z } from 'zod';

export const ObserverStatusSchema = z.object({
  name: z.literal('rn-agent-observer'),
  version: z.string(),
  phase: z.enum(['foundation', 'android-v1']),
  projectRoot: z.string().min(1),
  implementedCommands: z.array(z.string()),
  plannedCommands: z.array(z.string()),
});

export type ObserverStatus = z.infer<typeof ObserverStatusSchema>;
