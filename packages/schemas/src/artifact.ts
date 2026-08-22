import { z } from 'zod';

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'screenshot',
    'recording',
    'trace',
    'log',
    'network',
    'summary',
    'ui-tree',
    'devtools-export',
    'profile',
  ]),
  path: z.string().min(1),
  mimeType: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
