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
    'ui-understanding',
    'runtime-ui-model',
    'devtools-export',
    'profile',
    'evidence-graph',
    'suite-report',
    'security-report',
    'coverage-report',
    'share-bundle',
  ]),
  path: z.string().min(1),
  mimeType: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
