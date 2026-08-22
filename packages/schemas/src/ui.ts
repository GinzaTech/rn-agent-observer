import { z } from 'zod';
import { BoundsSchema } from './screen.js';

export interface UIElement {
  id?: string | undefined;
  type: string;
  text?: string | undefined;
  resourceId?: string | undefined;
  contentDescription?: string | undefined;
  className?: string | undefined;
  bounds?: z.infer<typeof BoundsSchema> | undefined;
  clickable?: boolean | undefined;
  visible?: boolean | undefined;
  enabled?: boolean | undefined;
  selected?: boolean | undefined;
  focusable?: boolean | undefined;
  children: UIElement[];
}

export const UIElementSchema: z.ZodType<UIElement> = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  text: z.string().optional(),
  resourceId: z.string().optional(),
  contentDescription: z.string().optional(),
  className: z.string().optional(),
  bounds: BoundsSchema.optional(),
  clickable: z.boolean().optional(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
  selected: z.boolean().optional(),
  focusable: z.boolean().optional(),
  children: z.array(z.lazy(() => UIElementSchema)).default([]),
});

export const UITreeSchema = z.object({
  roots: z.array(UIElementSchema),
  timestamp: z.iso.datetime(),
  source: z.string().min(1),
  artifactId: z.string().optional(),
  artifactPath: z.string().optional(),
});

export type UITree = z.infer<typeof UITreeSchema>;
