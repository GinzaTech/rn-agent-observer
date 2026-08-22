import { z } from 'zod';
import { BoundsSchema } from './screen.js';

export const SourceLocationSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const SourceUiElementSchema = z.object({
  id: z.string().min(1),
  componentName: z.string().min(1),
  role: z.enum(['button', 'text-field', 'switch', 'link', 'other']),
  testId: z.string().nullable(),
  generatedTestId: z.string().nullable(),
  label: z.string().nullable(),
  hasPressHandler: z.boolean(),
  disabledStatic: z.boolean().nullable(),
  conditionallyRendered: z.boolean(),
  source: SourceLocationSchema,
});

export const UiInteractionEventSchema = z.object({
  interactionId: z.string().min(1),
  elementId: z.string().min(1),
  testId: z.string().nullable(),
  label: z.string().nullable(),
  phase: z.enum(['start', 'success', 'error']),
  timestamp: z.iso.datetime(),
  durationMs: z.number().nonnegative().nullable(),
  error: z.string().nullable(),
});

export const RuntimeUiNodeSchema = z.object({
  sourceElement: SourceUiElementSchema.nullable(),
  ref: z.string().nullable(),
  testId: z.string().nullable(),
  label: z.string(),
  role: z.string(),
  rendered: z.enum(['yes', 'no', 'unknown']),
  visibility: z.enum([
    'visible',
    'offscreen',
    'hidden',
    'unmounted',
    'flattened-or-unobserved',
    'unknown',
  ]),
  enabled: z.boolean().nullable(),
  canPress: z.enum(['yes', 'no', 'unknown']),
  canPressReason: z.string().min(1),
  bounds: BoundsSchema.nullable(),
  instrumented: z.boolean(),
});

export const RuntimeUiIssueSchema = z.object({
  code: z.enum([
    'source-action-without-testid',
    'source-action-not-observed',
    'native-action-without-source',
    'disabled-action',
    'interaction-error',
  ]),
  severity: z.enum(['info', 'warning', 'error']),
  description: z.string().min(1),
  source: SourceLocationSchema.nullable(),
  refs: z.array(z.string()),
  interactionIds: z.array(z.string()),
  suggestion: z.string().min(1),
});

export const RuntimeUiModelSchema = z.object({
  timestamp: z.iso.datetime(),
  source: z.literal(
    'typescript-ast+rn-instrumentation+android-uiautomator+logcat',
  ),
  route: z.string().nullable(),
  nodes: z.array(RuntimeUiNodeSchema),
  interactions: z.array(UiInteractionEventSchema),
  counts: z.object({
    sourceActions: z.number().int().nonnegative(),
    nativeActions: z.number().int().nonnegative(),
    visible: z.number().int().nonnegative(),
    pressable: z.number().int().nonnegative(),
    unknownVisibility: z.number().int().nonnegative(),
    interactions: z.number().int().nonnegative(),
    interactionErrors: z.number().int().nonnegative(),
  }),
  issues: z.array(RuntimeUiIssueSchema),
  artifacts: z.object({
    uiTreeId: z.string(),
    uiTreePath: z.string(),
    modelId: z.string().optional(),
    modelPath: z.string().optional(),
  }),
  limitations: z.array(z.string()),
});

export type SourceLocation = z.infer<typeof SourceLocationSchema>;
export type SourceUiElement = z.infer<typeof SourceUiElementSchema>;
export type UiInteractionEvent = z.infer<typeof UiInteractionEventSchema>;
export type RuntimeUiNode = z.infer<typeof RuntimeUiNodeSchema>;
export type RuntimeUiIssue = z.infer<typeof RuntimeUiIssueSchema>;
export type RuntimeUiModel = z.infer<typeof RuntimeUiModelSchema>;
