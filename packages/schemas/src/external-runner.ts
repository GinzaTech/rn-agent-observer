import { z } from 'zod';

export const ExternalRunnerNameSchema = z.enum([
  'maestro',
  'detox',
  'appium',
  'generic',
]);

export const ExternalRunnerCaseOutcomeSchema = z.enum([
  'PASS',
  'FAIL',
  'ERROR',
  'SKIPPED',
]);

export const ExternalRunnerCaseIdentitySchemeSchema = z.enum([
  'sha256',
  'hmac-sha256',
]);

const ExternalRunnerCaseHashSchema = z
  .string()
  .regex(/^(?:sha256|hmac-sha256):[a-f0-9]{64}$/u);

export const ExternalRunnerResultSchema = z.object({
  schemaVersion: z.literal('1.0'),
  format: z.literal('junit'),
  runner: ExternalRunnerNameSchema,
  importedAt: z.iso.datetime(),
  source: z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    bytes: z.number().int().nonnegative(),
  }),
  caseIdentityScheme: ExternalRunnerCaseIdentitySchemeSchema,
  outcome: z.enum(['PASS', 'FAIL', 'NOT_VERIFIED']),
  counts: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  durationMs: z.number().int().nonnegative().optional(),
  cases: z
    .array(
      z.object({
        idHash: ExternalRunnerCaseHashSchema,
        outcome: ExternalRunnerCaseOutcomeSchema,
        durationMs: z.number().int().nonnegative().optional(),
      }),
    )
    .max(20_000),
  truncated: z.boolean(),
  limitations: z.array(z.string().min(1)).default([]),
});

const ExternalRunnerResultSummarySchema = z.object({
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  outcome: z.enum(['PASS', 'FAIL', 'NOT_VERIFIED']),
  counts: ExternalRunnerResultSchema.shape.counts,
  durationMs: z.number().int().nonnegative().optional(),
  truncated: z.boolean(),
  caseIdentityScheme: ExternalRunnerCaseIdentitySchemeSchema,
});

const ExternalRunnerCaseHashListSchema = z
  .array(ExternalRunnerCaseHashSchema)
  .max(20_000);

export const ExternalRunnerComparisonSchema = z.object({
  schemaVersion: z.literal('1.0'),
  comparedAt: z.iso.datetime(),
  runners: z.object({
    baseline: ExternalRunnerNameSchema,
    current: ExternalRunnerNameSchema,
  }),
  caseIdentitySchemes: z.object({
    baseline: ExternalRunnerCaseIdentitySchemeSchema,
    current: ExternalRunnerCaseIdentitySchemeSchema,
  }),
  outcome: z.enum(['PASS', 'FAIL', 'NOT_VERIFIED']),
  baseline: ExternalRunnerResultSummarySchema,
  current: ExternalRunnerResultSummarySchema,
  delta: z.object({
    total: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    errors: z.number().int(),
    skipped: z.number().int(),
    durationMs: z.number().int().optional(),
  }),
  changes: z.object({
    newFailures: ExternalRunnerCaseHashListSchema,
    recovered: ExternalRunnerCaseHashListSchema,
    persistentFailures: ExternalRunnerCaseHashListSchema,
    addedCases: z.number().int().nonnegative(),
    removedCases: z.number().int().nonnegative(),
    outcomeChanges: z.number().int().nonnegative(),
  }),
  limitations: z.array(z.string().min(1)).default([]),
});

export type ExternalRunnerName = z.infer<typeof ExternalRunnerNameSchema>;
export type ExternalRunnerCaseOutcome = z.infer<
  typeof ExternalRunnerCaseOutcomeSchema
>;
export type ExternalRunnerCaseIdentityScheme = z.infer<
  typeof ExternalRunnerCaseIdentitySchemeSchema
>;
export type ExternalRunnerResult = z.infer<typeof ExternalRunnerResultSchema>;
export type ExternalRunnerComparison = z.infer<
  typeof ExternalRunnerComparisonSchema
>;
