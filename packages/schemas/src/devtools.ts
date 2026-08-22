import { z } from 'zod';

export const DevToolsConsoleEntrySchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
  text: z.string(),
  source: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export const DevToolsExceptionSchema = z.object({
  text: z.string(),
  timestamp: z.iso.datetime(),
});

export const DevToolsHeapSchema = z.object({
  usedMb: z.number().nonnegative().nullable(),
  totalMb: z.number().nonnegative().nullable(),
  available: z.boolean(),
  source: z.literal('cdp-Runtime.getHeapUsage'),
  reason: z.string().optional(),
});

export const DevToolsTargetSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().optional(),
  deviceName: z.string().optional(),
});

export const DevToolsExportSchema = z.object({
  timestamp: z.iso.datetime(),
  metroUrl: z.string().min(1),
  appId: z.string().min(1),
  target: DevToolsTargetSchema,
  durationMs: z.number().int().positive(),
  consoleEntries: z.array(DevToolsConsoleEntrySchema),
  exceptions: z.array(DevToolsExceptionSchema),
  heap: DevToolsHeapSchema,
  artifactId: z.string().optional(),
});

export type DevToolsConsoleEntry = z.infer<typeof DevToolsConsoleEntrySchema>;
export type DevToolsException = z.infer<typeof DevToolsExceptionSchema>;
export type DevToolsHeap = z.infer<typeof DevToolsHeapSchema>;
export type DevToolsTarget = z.infer<typeof DevToolsTargetSchema>;
export type DevToolsExport = z.infer<typeof DevToolsExportSchema>;
