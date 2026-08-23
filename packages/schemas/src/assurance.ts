import { z } from 'zod';

export const AssuranceOutcomeSchema = z.enum([
  'PASS',
  'FAIL',
  'NA',
  'NOT_VERIFIED',
]);

export const EvidenceAvailabilitySchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('AVAILABLE'),
  }),
  z.object({
    status: z.literal('DEGRADED'),
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal('UNAVAILABLE'),
    reason: z.string().min(1),
  }),
]);

export const EvidenceClassificationSchema = z.enum([
  'public',
  'internal',
  'sensitive',
  'restricted',
]);

export const EvidenceReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  relation: z.enum([
    'supports',
    'contradicts',
    'derived-from',
    'before',
    'after',
    'caused-by',
    'correlates-with',
  ]),
  uri: z.string().min(1).optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});

export const TargetFingerprintSchema = z.object({
  platform: z.enum(['android', 'ios', 'web', 'windows']),
  deviceId: z.string().min(1),
  appId: z.string().min(1),
  appVersion: z.string().min(1).optional(),
  buildId: z.string().min(1).optional(),
  sourceRevision: z.string().min(1).optional(),
  operatingSystem: z.string().min(1).optional(),
  architecture: z.string().min(1).optional(),
  reactNativeVersion: z.string().min(1).optional(),
  expoVersion: z.string().min(1).optional(),
  hermesVersion: z.string().min(1).optional(),
  deviceClass: z.string().min(1).optional(),
});

export const EvidenceEnvelopeSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: z.string().min(1),
  runId: z.string().min(1),
  kind: z.string().min(1),
  capturedAt: z.iso.datetime(),
  provider: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  target: TargetFingerprintSchema,
  availability: EvidenceAvailabilitySchema,
  classification: EvidenceClassificationSchema.default('sensitive'),
  correlationId: z.string().min(1).optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
  references: z.array(EvidenceReferenceSchema).default([]),
  payload: z.unknown(),
});

export const AssuranceFindingSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    id: z.string().min(1),
    ruleId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    outcome: AssuranceOutcomeSchema,
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
    confidence: z.number().min(0).max(1),
    category: z.enum([
      'functional',
      'visual',
      'performance',
      'network',
      'accessibility',
      'security',
      'resilience',
      'privacy',
    ]),
    controls: z.array(z.string().min(1)).default([]),
    evidence: z.array(EvidenceReferenceSchema).default([]),
    source: z
      .object({
        file: z.string().min(1),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
      })
      .optional(),
    remediation: z.string().min(1).optional(),
    limitations: z.array(z.string().min(1)).default([]),
  })
  .superRefine((finding, context) => {
    if (finding.outcome === 'PASS' && finding.evidence.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'PASS requires at least one evidence reference',
        path: ['evidence'],
      });
    }
    if (
      finding.outcome === 'NOT_VERIFIED' &&
      finding.limitations.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'NOT_VERIFIED requires an explicit limitation',
        path: ['limitations'],
      });
    }
  });

export type AssuranceOutcome = z.infer<typeof AssuranceOutcomeSchema>;
export type EvidenceAvailability = z.infer<typeof EvidenceAvailabilitySchema>;
export type EvidenceClassification = z.infer<
  typeof EvidenceClassificationSchema
>;
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
export type TargetFingerprint = z.infer<typeof TargetFingerprintSchema>;
export type EvidenceEnvelope = z.infer<typeof EvidenceEnvelopeSchema>;
export type AssuranceFinding = z.infer<typeof AssuranceFindingSchema>;
