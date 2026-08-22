import { z } from 'zod';

export const AppStateSchema = z.object({
  appId: z.string().min(1),
  processRunning: z.boolean(),
  pid: z.number().int().positive().nullable(),
  foregroundActivity: z.string().nullable(),
  appInForeground: z.boolean(),
  source: z.literal('adb-pidof+dumpsys-activity'),
  timestamp: z.iso.datetime(),
});

export type AppState = z.infer<typeof AppStateSchema>;

export const NetworkInterfaceSampleSchema = z.object({
  interfaceName: z.string().min(1),
  rxBytes: z.number().int().nonnegative(),
  txBytes: z.number().int().nonnegative(),
});

export const DeviceNetworkSampleSchema = z.object({
  timestamp: z.iso.datetime(),
  interfaces: z.array(NetworkInterfaceSampleSchema),
  source: z.literal('adb-proc-net-dev'),
});

export const DeviceNetworkDeltaSchema = z.object({
  windowMs: z.number().int().positive(),
  start: DeviceNetworkSampleSchema,
  end: DeviceNetworkSampleSchema,
  deltas: z.array(NetworkInterfaceSampleSchema),
  source: z.literal('adb-proc-net-dev-delta'),
});

export type NetworkInterfaceSample = z.infer<
  typeof NetworkInterfaceSampleSchema
>;
export type DeviceNetworkSample = z.infer<typeof DeviceNetworkSampleSchema>;
export type DeviceNetworkDelta = z.infer<typeof DeviceNetworkDeltaSchema>;
