import { z } from 'zod';

export const LogEntrySchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  message: z.string(),
  source: z.string().min(1),
  timestamp: z.iso.datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;
