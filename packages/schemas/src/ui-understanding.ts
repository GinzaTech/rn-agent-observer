import { z } from 'zod';
import { BoundsSchema } from './screen.js';

export const ScreenStateSchema = z.enum([
  'not-running',
  'background',
  'blank',
  'loading',
  'error',
  'empty',
  'content',
]);

export const UiIssueCodeSchema = z.enum([
  'runtime-error-text',
  'runtime-log-error',
  'blank-screen',
  'loading-state',
  'loading-stuck',
  'empty-state',
  'unlabeled-control',
  'small-touch-target',
  'duplicate-test-id',
  'zero-size-control',
  'offscreen-control',
  'text-language-unknown',
]);

export const UiIssueSchema = z.object({
  code: UiIssueCodeSchema,
  severity: z.enum(['info', 'warning', 'error']),
  title: z.string().min(1),
  description: z.string().min(1),
  suggestion: z.string().min(1),
  evidence: z.object({
    refs: z.array(z.string()),
    labels: z.array(z.string()),
    artifactIds: z.array(z.string()),
  }),
});

export const ScreenUnderstandingSchema = z.object({
  timestamp: z.iso.datetime(),
  source: z.string().min(1),
  state: ScreenStateSchema,
  stateSince: z.iso.datetime(),
  fingerprint: z.string().min(1),
  route: z.string().nullable(),
  headline: z.string().nullable(),
  textLanguage: z
    .enum(['en', 'vi', 'ja', 'ko', 'zh', 'es', 'unknown'])
    .default('unknown'),
  summary: z.string().min(1),
  visibleText: z.array(z.string()),
  actions: z.array(
    z.object({
      ref: z.string(),
      kind: z.string(),
      label: z.string(),
      testId: z.string().nullable(),
      bounds: BoundsSchema.nullable(),
    }),
  ),
  counts: z.object({
    visibleElements: z.number().int().nonnegative(),
    textElements: z.number().int().nonnegative(),
    interactiveElements: z.number().int().nonnegative(),
    unlabeledControls: z.number().int().nonnegative(),
    smallTouchTargets: z.number().int().nonnegative(),
    runtimeErrors: z.number().int().nonnegative(),
  }),
  visual: z.object({
    sampledPixels: z.number().int().nonnegative(),
    dominantColorRatio: z.number().min(0).max(1),
    luminanceStdDev: z.number().nonnegative(),
  }),
  issues: z.array(UiIssueSchema),
  artifacts: z.object({
    screenshotId: z.string(),
    screenshotPath: z.string(),
    uiTreeId: z.string(),
    uiTreePath: z.string(),
    understandingId: z.string().optional(),
    understandingPath: z.string().optional(),
  }),
  limitations: z.array(z.string()),
});

export type ScreenState = z.infer<typeof ScreenStateSchema>;
export type UiIssue = z.infer<typeof UiIssueSchema>;
export type ScreenUnderstanding = z.infer<typeof ScreenUnderstandingSchema>;
