import { describe, expect, it } from 'vitest';
import { EvidenceGraphSchema } from './evidence-graph.js';

describe('evidence graph contract', () => {
  it('requires unique nodes and valid edge endpoints', () => {
    const valid = {
      schemaVersion: '1.0',
      sessionId: 'session-1',
      generatedAt: '2026-08-22T00:00:00.000Z',
      nodes: [
        { id: 'session:1', type: 'session', label: 'Session' },
        { id: 'event:1', type: 'event', label: 'tap' },
      ],
      edges: [
        {
          id: 'edge:1',
          from: 'session:1',
          to: 'event:1',
          relation: 'contains',
          confidence: 1,
        },
      ],
    };

    expect(EvidenceGraphSchema.safeParse(valid).success).toBe(true);
    expect(
      EvidenceGraphSchema.safeParse({
        ...valid,
        edges: [{ ...valid.edges[0], to: 'missing' }],
      }).success,
    ).toBe(false);
  });
});
