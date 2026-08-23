import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import {
  EvidenceGraphSchema,
  type AssuranceFinding,
  type EvidenceGraph,
  type EvidenceGraphEdge,
  type EvidenceGraphNode,
  type EvidenceReference,
  type Session,
} from '@rn-agent-observer/schemas';

export interface BuildEvidenceGraphOptions {
  session: Session;
  findings?: readonly AssuranceFinding[];
  generatedAt?: string;
}

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex').slice(0, 20);

const graphEdge = (
  from: string,
  relation: EvidenceGraphEdge['relation'],
  to: string,
  confidence: number,
): EvidenceGraphEdge => ({
  id: `edge:${digest(`${from}\u0000${relation}\u0000${to}`)}`,
  from,
  to,
  relation,
  confidence,
});

const safeRoutePattern = (route: string): string => {
  const withoutQuery = route.split(/[?#]/u, 1)[0] ?? '/';
  const segments = withoutQuery.split('/').map((segment) => {
    if (!segment) return segment;
    if (/^\d+$/u.test(segment)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(segment)) return ':id';
    if (/^[0-9a-f]{20,}$/iu.test(segment)) return ':id';
    if (segment.includes('@')) return ':redacted';
    return segment.slice(0, 80);
  });
  return segments.join('/').slice(0, 240) || '/';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const walk = (
  value: unknown,
  visitor: (key: string, value: unknown) => void,
  depth = 0,
): void => {
  if (depth > 5) return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 500)) walk(item, visitor, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child);
    walk(child, visitor, depth + 1);
  }
};

const artifactIdsFrom = (
  value: unknown,
  knownIds: ReadonlySet<string>,
): string[] => {
  const output = new Set<string>();
  walk(value, (key, candidate) => {
    if (
      typeof candidate === 'string' &&
      knownIds.has(candidate) &&
      (key === 'id' || key.toLowerCase().endsWith('id'))
    ) {
      output.add(candidate);
    }
  });
  return [...output];
};

const correlationsFrom = (
  value: unknown,
): Array<{ kind: string; value: string }> => {
  const correlations = new Map<string, { kind: string; value: string }>();
  const keys = new Set([
    'correlationId',
    'interactionId',
    'requestId',
    'traceId',
    'recordingId',
    'snapshotId',
  ]);
  walk(value, (key, candidate) => {
    if (keys.has(key) && typeof candidate === 'string' && candidate) {
      correlations.set(`${key}:${candidate}`, { kind: key, value: candidate });
    }
  });
  return [...correlations.values()];
};

const routesFrom = (value: unknown): string[] => {
  const routes = new Set<string>();
  walk(value, (key, candidate) => {
    if (key === 'route' && typeof candidate === 'string' && candidate) {
      routes.add(safeRoutePattern(candidate));
    }
  });
  return [...routes];
};

const eventProperties = (
  type: string,
  data: unknown,
): Record<string, string | number | boolean | null> => {
  const properties: Record<string, string | number | boolean | null> = {
    eventType: type,
  };
  if (!isRecord(data)) return properties;
  const exactKeys = new Set([
    'status',
    'state',
    'mode',
    'source',
    'available',
    'passed',
    'performed',
    'appInForeground',
    'processRunning',
    'durationMs',
  ]);
  for (const [key, value] of Object.entries(data)) {
    if (key === 'route' && typeof value === 'string') {
      properties.routePattern = safeRoutePattern(value);
      continue;
    }
    if (
      (exactKeys.has(key) || key.endsWith('Count')) &&
      (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null)
    ) {
      properties[key] = typeof value === 'string' ? value.slice(0, 160) : value;
    }
  }
  return properties;
};

const ensureEvidenceNode = (
  reference: EvidenceReference,
  nodes: Map<string, EvidenceGraphNode>,
  artifactNodeIds: ReadonlyMap<string, string>,
): string => {
  const artifactNode = artifactNodeIds.get(reference.id);
  if (artifactNode) return artifactNode;
  const id = `evidence:${digest(reference.id)}`;
  if (!nodes.has(id)) {
    nodes.set(id, {
      id,
      type: 'evidence',
      label: reference.kind,
      properties: {
        evidenceId: reference.id,
        kind: reference.kind,
        ...(reference.sha256 ? { sha256: reference.sha256 } : {}),
      },
    });
  }
  return id;
};

export const buildEvidenceGraph = (
  options: BuildEvidenceGraphOptions,
): EvidenceGraph => {
  const session = options.session;
  const nodes = new Map<string, EvidenceGraphNode>();
  const edges = new Map<string, EvidenceGraphEdge>();
  const sessionNodeId = `session:${session.id}`;
  nodes.set(sessionNodeId, {
    id: sessionNodeId,
    type: 'session',
    label: 'Observer session',
    timestamp: session.startedAt,
    properties: {
      sessionId: session.id,
      status: session.status,
      eventCount: session.timeline.length,
      artifactCount: session.artifacts.length,
    },
  });

  const artifactNodeIds = new Map<string, string>();
  for (const artifact of session.artifacts) {
    const id = `artifact:${artifact.id}`;
    artifactNodeIds.set(artifact.id, id);
    nodes.set(id, {
      id,
      type: 'artifact',
      label: artifact.kind,
      timestamp: artifact.createdAt,
      properties: {
        artifactId: artifact.id,
        kind: artifact.kind,
        ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
      },
    });
    const edge = graphEdge(sessionNodeId, 'contains', id, 1);
    edges.set(edge.id, edge);
  }
  const knownArtifactIds = new Set(artifactNodeIds.keys());

  for (const event of session.timeline) {
    const eventNodeId = `event:${event.id}`;
    nodes.set(eventNodeId, {
      id: eventNodeId,
      type: 'event',
      label: event.type,
      timestamp: event.timestamp,
      properties: eventProperties(event.type, event.data),
    });
    const contained = graphEdge(sessionNodeId, 'contains', eventNodeId, 1);
    edges.set(contained.id, contained);

    for (const artifactId of artifactIdsFrom(event.data, knownArtifactIds)) {
      const artifactNodeId = artifactNodeIds.get(artifactId);
      if (!artifactNodeId) continue;
      const edge = graphEdge(eventNodeId, 'derived-from', artifactNodeId, 1);
      edges.set(edge.id, edge);
    }
    for (const correlation of correlationsFrom(event.data)) {
      const id = `correlation:${correlation.kind}:${digest(correlation.value)}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          type: 'correlation',
          label: correlation.kind,
          properties: { kind: correlation.kind },
        });
      }
      const edge = graphEdge(eventNodeId, 'correlates-with', id, 1);
      edges.set(edge.id, edge);
    }
    for (const route of routesFrom(event.data)) {
      const id = `route:${digest(route)}`;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          type: 'route',
          label: 'Observed route',
          properties: { routePattern: route },
        });
      }
      const edge = graphEdge(eventNodeId, 'occurred-on', id, 0.95);
      edges.set(edge.id, edge);
    }
  }

  for (const finding of options.findings ?? []) {
    const findingNodeId = `finding:${finding.id}`;
    nodes.set(findingNodeId, {
      id: findingNodeId,
      type: 'finding',
      label: finding.title,
      properties: {
        ruleId: finding.ruleId,
        outcome: finding.outcome,
        severity: finding.severity,
        category: finding.category,
        confidence: finding.confidence,
      },
    });
    const contained = graphEdge(sessionNodeId, 'contains', findingNodeId, 1);
    edges.set(contained.id, contained);
    for (const reference of finding.evidence) {
      const evidenceNodeId = ensureEvidenceNode(
        reference,
        nodes,
        artifactNodeIds,
      );
      const relation =
        reference.relation === 'caused-by' ? 'caused-by' : reference.relation;
      const edge = graphEdge(evidenceNodeId, relation, findingNodeId, 1);
      edges.set(edge.id, edge);
    }
    if (finding.source) {
      const sourceKey = `${finding.source.file}:${finding.source.line ?? ''}:${finding.source.column ?? ''}`;
      const sourceNodeId = `source:${digest(sourceKey)}`;
      if (!nodes.has(sourceNodeId)) {
        nodes.set(sourceNodeId, {
          id: sourceNodeId,
          type: 'source',
          label: basename(finding.source.file),
          properties: {
            file: finding.source.file,
            ...(finding.source.line ? { line: finding.source.line } : {}),
            ...(finding.source.column ? { column: finding.source.column } : {}),
          },
        });
      }
      const edge = graphEdge(findingNodeId, 'located-at', sourceNodeId, 1);
      edges.set(edge.id, edge);
    }
  }

  return EvidenceGraphSchema.parse({
    schemaVersion: '1.0',
    sessionId: session.id,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    limitations: [
      'Graph edges are deterministic evidence references or explicitly labeled heuristic route correlations',
      'Correlation identifiers are hashed and sensitive event payload fields are not copied into graph properties',
    ],
  });
};
