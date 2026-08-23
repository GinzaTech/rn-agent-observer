import { describe, expect, it } from 'vitest';
import type { AssuranceFinding, Session } from '@rn-agent-observer/schemas';
import { buildEvidenceGraph } from './graph.js';

const session: Session = {
  schemaVersion: '1.0',
  id: 'session-1',
  projectRoot: 'C:\\app',
  startedAt: '2026-08-22T00:00:00.000Z',
  status: 'complete',
  artifactIds: ['shot-1'],
  artifacts: [
    {
      id: 'shot-1',
      kind: 'screenshot',
      path: 'C:\\app\\.artifacts\\shot.png',
      createdAt: '2026-08-22T00:00:00.100Z',
    },
  ],
  timeline: [
    {
      id: 1,
      type: 'app_interaction',
      timestamp: '2026-08-22T00:00:00.050Z',
      data: {
        interactionId: 'secret-correlation-value',
        route: '/users/123?token=do-not-copy',
      },
    },
    {
      id: 2,
      type: 'screenshot',
      timestamp: '2026-08-22T00:00:00.100Z',
      data: { screen: { artifactId: 'shot-1' } },
    },
  ],
};

const finding: AssuranceFinding = {
  schemaVersion: '1.0',
  id: 'finding-1',
  ruleId: 'visual.changed',
  title: 'Visual changed',
  description: 'Pixels changed.',
  outcome: 'FAIL',
  severity: 'medium',
  confidence: 1,
  category: 'visual',
  controls: [],
  evidence: [{ id: 'shot-1', kind: 'screenshot', relation: 'supports' }],
  source: { file: 'src/Home.tsx', line: 12 },
  limitations: [],
};

describe('evidence graph builder', () => {
  it('links sessions, events, artifacts, findings, routes, and source', () => {
    const graph = buildEvidenceGraph({
      session,
      findings: [finding],
      generatedAt: '2026-08-22T00:00:01.000Z',
    });

    expect(graph.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining([
        'session',
        'event',
        'artifact',
        'finding',
        'route',
        'correlation',
        'source',
      ]),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: 'event:2',
        to: 'artifact:shot-1',
        relation: 'derived-from',
      }),
    );
    expect(JSON.stringify(graph)).not.toContain('secret-correlation-value');
    expect(JSON.stringify(graph)).not.toContain('do-not-copy');
    expect(
      graph.nodes.find((node) => node.type === 'route')?.properties,
    ).toMatchObject({ routePattern: '/users/:id' });
  });
});
