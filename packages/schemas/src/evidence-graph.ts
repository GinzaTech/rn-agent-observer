import { z } from 'zod';

export const EvidenceGraphNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'session',
    'event',
    'artifact',
    'evidence',
    'finding',
    'source',
    'route',
    'correlation',
  ]),
  label: z.string().min(1),
  timestamp: z.iso.datetime().optional(),
  properties: z.record(z.string(), z.json()).default({}),
});

export const EvidenceGraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum([
    'contains',
    'supports',
    'contradicts',
    'derived-from',
    'before',
    'after',
    'caused-by',
    'correlates-with',
    'located-at',
    'occurred-on',
  ]),
  confidence: z.number().min(0).max(1),
});

export const EvidenceGraphSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    sessionId: z.string().min(1),
    generatedAt: z.iso.datetime(),
    nodes: z.array(EvidenceGraphNodeSchema),
    edges: z.array(EvidenceGraphEdgeSchema),
    limitations: z.array(z.string().min(1)).default([]),
  })
  .superRefine((graph, context) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of graph.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate node id: ${node.id}`,
          path: ['nodes', index, 'id'],
        });
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const [index, edge] of graph.edges.entries()) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate edge id: ${edge.id}`,
          path: ['edges', index, 'id'],
        });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: 'custom',
          message: 'Edge endpoints must reference graph nodes',
          path: ['edges', index],
        });
      }
    }
  });

export type EvidenceGraphNode = z.infer<typeof EvidenceGraphNodeSchema>;
export type EvidenceGraphEdge = z.infer<typeof EvidenceGraphEdgeSchema>;
export type EvidenceGraph = z.infer<typeof EvidenceGraphSchema>;
