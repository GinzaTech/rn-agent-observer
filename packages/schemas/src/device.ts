import { z } from 'zod';

export const DeviceSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(['android', 'web']),
  state: z.string().min(1),
  model: z.string().optional(),
  osVersion: z.string().optional(),
  resolution: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  densityDpi: z.number().int().positive().optional(),
  orientation: z.enum(['portrait', 'landscape', 'unknown']).optional(),
});

export type Device = z.infer<typeof DeviceSchema>;
