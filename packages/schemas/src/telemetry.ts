import { z } from 'zod';
import { NetworkRequestSchema } from './network.js';
import { ReactRenderStatSchema } from './observer.js';

/**
 * Version written by the React Native instrumentation package.
 *
 * The marker remains optional while parsing so logs produced by releases
 * before the versioned contract continue to work. A present marker must match
 * exactly; this prevents a newer, incompatible payload from being treated as
 * evidence that follows the current contract.
 */
export const TELEMETRY_VERSION = 1 as const;
export const TelemetryVersionSchema = z.literal(TELEMETRY_VERSION);
const legacyCompatibleVersion = TelemetryVersionSchema.optional();

export const NetworkTelemetryPayloadSchema = NetworkRequestSchema.extend({
  telemetryVersion: legacyCompatibleVersion,
});

export const RenderTelemetryPayloadSchema = ReactRenderStatSchema.extend({
  telemetryVersion: legacyCompatibleVersion,
});

export const RouteTelemetryPayloadSchema = z.object({
  telemetryVersion: legacyCompatibleVersion,
  route: z.string().min(1).max(512),
  timestamp: z.iso.datetime().optional(),
});

export const JsTaskTelemetryPayloadSchema = z.object({
  telemetryVersion: legacyCompatibleVersion,
  durationMs: z.number().nonnegative(),
  label: z.string().min(1).max(160),
  timestamp: z.iso.datetime(),
  source: z.string().min(1),
});

export const AppDataPrivacySchema = z.object({
  policy: z.enum(['default-safe-allowlist', 'explicit-safe-allowlist']),
  redacted: z.boolean(),
  truncated: z.boolean(),
});

export const AppDataTelemetryPayloadSchema = z.object({
  telemetryVersion: legacyCompatibleVersion,
  namespace: z.string().min(1).max(80),
  data: z.json(),
  timestamp: z.iso.datetime().optional(),
  privacy: AppDataPrivacySchema.optional(),
});

export const UiElementTelemetryPayloadSchema = z.object({
  telemetryVersion: legacyCompatibleVersion,
  elementId: z.string().min(1),
  testId: z.string().min(1).optional(),
  componentName: z.string().min(1),
  role: z.string().min(1).optional(),
  label: z.string().max(160).optional(),
  parentId: z.string().min(1).optional(),
  mounted: z.boolean(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
  timestamp: z.iso.datetime().optional(),
});

export const UiInteractionTelemetryPayloadSchema = z.object({
  telemetryVersion: legacyCompatibleVersion,
  interactionId: z.string().min(1),
  elementId: z.string().min(1),
  testId: z.string().nullable().optional(),
  label: z.string().max(160).nullable().optional(),
  phase: z.enum(['start', 'success', 'error']),
  timestamp: z.iso.datetime().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  error: z.string().max(160).nullable().optional(),
});

export type NetworkTelemetryPayload = z.infer<
  typeof NetworkTelemetryPayloadSchema
>;
export type RenderTelemetryPayload = z.infer<
  typeof RenderTelemetryPayloadSchema
>;
export type RouteTelemetryPayload = z.infer<typeof RouteTelemetryPayloadSchema>;
export type JsTaskTelemetryPayload = z.infer<
  typeof JsTaskTelemetryPayloadSchema
>;
export type AppDataPrivacy = z.infer<typeof AppDataPrivacySchema>;
export type AppDataTelemetryPayload = z.infer<
  typeof AppDataTelemetryPayloadSchema
>;
export type UiElementTelemetryPayload = z.infer<
  typeof UiElementTelemetryPayloadSchema
>;
export type UiInteractionTelemetryPayload = z.infer<
  typeof UiInteractionTelemetryPayloadSchema
>;
