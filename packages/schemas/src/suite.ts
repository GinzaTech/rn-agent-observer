import { z } from 'zod';
import {
  AssuranceFindingSchema,
  AssuranceOutcomeSchema,
  EvidenceReferenceSchema,
  TargetFingerprintSchema,
} from './assurance.js';

export const SuiteRiskSchema = z.enum([
  'read',
  'app-state',
  'device-state',
  'persistent-permission',
  'network-interception',
]);

export const SuiteReporterSchema = z.enum([
  'json',
  'html',
  'junit',
  'sarif',
  'github',
]);

export const SuiteAssertionSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: z.enum([
      'equals',
      'contains',
      'exists',
      'metric-budget',
      'visual-diff',
      'finding',
    ]),
    path: z.string().min(1).optional(),
    expected: z.json().optional(),
    threshold: z.number().finite().optional(),
    unit: z.string().min(1).optional(),
    evidenceKinds: z.array(z.string().min(1)).default([]),
    onUnavailable: z.enum(['NOT_VERIFIED', 'FAIL']).default('NOT_VERIFIED'),
  })
  .superRefine((assertion, context) => {
    if (
      ['equals', 'contains', 'finding'].includes(assertion.type) &&
      assertion.expected === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: `${assertion.type} requires expected`,
        path: ['expected'],
      });
    }
    if (
      ['metric-budget', 'visual-diff'].includes(assertion.type) &&
      assertion.threshold === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: `${assertion.type} requires threshold`,
        path: ['threshold'],
      });
    }
  });

export const SuiteStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  action: z.object({
    command: z.string().min(1),
    input: z.record(z.string(), z.json()).default({}),
  }),
  risk: SuiteRiskSchema.default('read'),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  timeoutMs: z.number().int().positive().max(300_000).default(30_000),
  retry: z
    .object({
      maxAttempts: z.number().int().min(1).max(10).default(1),
      backoffMs: z.number().int().min(0).max(30_000).default(0),
    })
    .default({ maxAttempts: 1, backoffMs: 0 }),
  assertions: z.array(SuiteAssertionSchema).default([]),
});

export const SuiteDefinitionSchema = z
  .object({
    apiVersion: z.literal('rn-observer/v1alpha1'),
    kind: z.literal('Suite'),
    metadata: z.object({
      id: z
        .string()
        .min(1)
        .regex(/^[a-z0-9][a-z0-9._-]*$/u),
      name: z.string().min(1),
      description: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)).default([]),
    }),
    requirements: z
      .object({
        platforms: z
          .array(z.enum(['android', 'ios', 'web', 'windows']))
          .min(1)
          .default(['android']),
        capabilities: z.array(z.string().min(1)).default([]),
        enhancedInstrumentation: z.boolean().default(false),
      })
      .default({
        platforms: ['android'],
        capabilities: [],
        enhancedInstrumentation: false,
      }),
    steps: z.array(SuiteStepSchema).min(1),
    cleanup: z.array(SuiteStepSchema).default([]),
    reporters: z.array(SuiteReporterSchema).min(1).default(['json']),
  })
  .superRefine((suite, context) => {
    const ids = new Set<string>();
    for (const [index, step] of [...suite.steps, ...suite.cleanup].entries()) {
      if (ids.has(step.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate step id: ${step.id}`,
          path:
            index < suite.steps.length ? ['steps', index, 'id'] : ['cleanup'],
        });
      }
      ids.add(step.id);
    }
  });

export const SuiteAssertionResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  outcome: AssuranceOutcomeSchema,
  reason: z.string().min(1).optional(),
  evidence: z.array(EvidenceReferenceSchema).default([]),
});

export const SuiteStepResultSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  outcome: AssuranceOutcomeSchema,
  attempts: z.number().int().nonnegative(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  reason: z.string().min(1).optional(),
  evidence: z.array(EvidenceReferenceSchema).default([]),
  assertions: z.array(SuiteAssertionResultSchema).default([]),
});

export const SuiteRunResultSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: z.string().min(1),
  suiteId: z.string().min(1),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  outcome: AssuranceOutcomeSchema,
  target: TargetFingerprintSchema,
  capabilities: z.array(z.string().min(1)),
  steps: z.array(SuiteStepResultSchema),
  cleanup: z.array(SuiteStepResultSchema),
  findings: z.array(AssuranceFindingSchema).default([]),
  limitations: z.array(z.string().min(1)).default([]),
});

export type SuiteRisk = z.infer<typeof SuiteRiskSchema>;
export type SuiteReporter = z.infer<typeof SuiteReporterSchema>;
export type SuiteAssertion = z.infer<typeof SuiteAssertionSchema>;
export type SuiteStep = z.infer<typeof SuiteStepSchema>;
export type SuiteDefinition = z.infer<typeof SuiteDefinitionSchema>;
export type SuiteAssertionResult = z.infer<typeof SuiteAssertionResultSchema>;
export type SuiteStepResult = z.infer<typeof SuiteStepResultSchema>;
export type SuiteRunResult = z.infer<typeof SuiteRunResultSchema>;
