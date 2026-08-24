import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  LogEntry,
  NetworkRequest,
  ReactRenderStat,
  UiInteractionEvent,
} from '@rn-agent-observer/schemas';
import {
  appDataFromLogs,
  jsTasksFromLogs,
  networkRequestsFromLogs,
  renderStatsFromLogs,
  routeEventsFromLogs,
  uiElementsFromLogs,
  uiInteractionsFromLogs,
  type AppDataEvent,
  type JsTaskEvent,
  type RouteEvent,
  type UiElementTelemetry,
} from './network.js';

export interface RuntimeTelemetryCache {
  schemaVersion: '1.0';
  processId: number | null;
  capturedAt: string;
  networkRequests: NetworkRequest[];
  renderStats: ReactRenderStat[];
  routes: RouteEvent[];
  jsTasks: JsTaskEvent[];
  appData: AppDataEvent[];
  uiElements: UiElementTelemetry[];
  interactions: UiInteractionEvent[];
}

export interface RuntimeTelemetryMergeResult {
  cache: RuntimeTelemetryCache;
  changed: boolean;
  observed: {
    networkRequests: number;
    renderStats: number;
    routes: number;
    jsTasks: number;
    appData: number;
    uiElements: number;
    interactions: number;
  };
  processChanged: boolean;
}

const CACHE_LIMITS = {
  networkRequests: 5_000,
  renderStats: 10_000,
  routes: 1_000,
  jsTasks: 2_000,
  appData: 1_000,
  uiElements: 5_000,
  interactions: 10_000,
} as const;

function emptyRuntimeTelemetryCache(): RuntimeTelemetryCache {
  return {
    schemaVersion: '1.0',
    processId: null,
    capturedAt: new Date(0).toISOString(),
    networkRequests: [],
    renderStats: [],
    routes: [],
    jsTasks: [],
    appData: [],
    uiElements: [],
    interactions: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasStrings(
  value: unknown,
  properties: readonly string[],
): value is Record<string, unknown> {
  return (
    isObject(value) &&
    properties.every((property) => typeof value[property] === 'string')
  );
}

function isRuntimeTelemetryCache(
  value: unknown,
): value is RuntimeTelemetryCache {
  if (!isObject(value) || value.schemaVersion !== '1.0') return false;
  if (
    value.processId !== null &&
    (!Number.isInteger(value.processId) || Number(value.processId) <= 0)
  ) {
    return false;
  }
  if (typeof value.capturedAt !== 'string') return false;
  const arrays = [
    value.networkRequests,
    value.renderStats,
    value.routes,
    value.jsTasks,
    value.appData,
    value.uiElements,
    value.interactions,
  ];
  if (!arrays.every(Array.isArray)) return false;
  return (
    (value.networkRequests as unknown[]).every((entry) =>
      hasStrings(entry, ['id', 'method', 'url', 'timestamp', 'source']),
    ) &&
    (value.renderStats as unknown[]).every((entry) =>
      hasStrings(entry, ['componentName', 'timestamp', 'source']),
    ) &&
    (value.routes as unknown[]).every((entry) =>
      hasStrings(entry, ['route', 'timestamp', 'source']),
    ) &&
    (value.jsTasks as unknown[]).every(
      (entry) =>
        hasStrings(entry, ['label', 'timestamp', 'source']) &&
        typeof entry.durationMs === 'number',
    ) &&
    (value.appData as unknown[]).every((entry) =>
      hasStrings(entry, ['namespace', 'timestamp']),
    ) &&
    (value.uiElements as unknown[]).every((entry) =>
      hasStrings(entry, ['elementId', 'componentName', 'timestamp']),
    ) &&
    (value.interactions as unknown[]).every((entry) =>
      hasStrings(entry, ['interactionId', 'elementId', 'phase', 'timestamp']),
    )
  );
}

export function readRuntimeTelemetryCache(path: string): RuntimeTelemetryCache {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return isRuntimeTelemetryCache(parsed)
      ? parsed
      : emptyRuntimeTelemetryCache();
  } catch {
    return emptyRuntimeTelemetryCache();
  }
}

export function writeRuntimeTelemetryCache(
  path: string,
  cache: RuntimeTelemetryCache,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
}

function timestampOf(value: { timestamp: string }): string {
  return value.timestamp;
}

function mergeLatestByKey<T extends { timestamp: string }>(
  previous: readonly T[],
  incoming: readonly T[],
  key: (value: T) => string,
  limit: number,
): T[] {
  const values = new Map<string, T>();
  for (const value of [...previous, ...incoming]) values.set(key(value), value);
  return [...values.values()]
    .sort((left, right) => timestampOf(left).localeCompare(timestampOf(right)))
    .slice(-limit);
}

function stableCacheValue(cache: RuntimeTelemetryCache): string {
  return JSON.stringify({
    ...cache,
    capturedAt: '',
  });
}

export function mergeRuntimeTelemetry(
  previous: RuntimeTelemetryCache,
  logs: LogEntry[],
  processId: number | null,
): RuntimeTelemetryMergeResult {
  const incoming = {
    networkRequests: networkRequestsFromLogs(logs),
    renderStats: renderStatsFromLogs(logs),
    routes: routeEventsFromLogs(logs),
    jsTasks: jsTasksFromLogs(logs),
    appData: appDataFromLogs(logs),
    uiElements: uiElementsFromLogs(logs),
    interactions: uiInteractionsFromLogs(logs),
  };
  const processChanged =
    previous.processId !== null &&
    processId !== null &&
    previous.processId !== processId;
  // PID pinning is part of the telemetry trust boundary. Once the target app
  // restarts, none of the prior process-owned runtime values may be presented
  // as current evidence for the new process.
  const currentProcess = processChanged
    ? emptyRuntimeTelemetryCache()
    : previous;
  const cache: RuntimeTelemetryCache = {
    schemaVersion: '1.0',
    processId: processId ?? previous.processId,
    capturedAt: new Date().toISOString(),
    networkRequests: mergeLatestByKey(
      currentProcess.networkRequests,
      incoming.networkRequests,
      (entry) => entry.id,
      CACHE_LIMITS.networkRequests,
    ),
    renderStats: mergeLatestByKey(
      currentProcess.renderStats,
      incoming.renderStats,
      (entry) =>
        `${entry.componentName}:${entry.renderCount}:${entry.timestamp}:${entry.source}`,
      CACHE_LIMITS.renderStats,
    ),
    routes: mergeLatestByKey(
      currentProcess.routes,
      incoming.routes,
      (entry) => `${entry.route}:${entry.timestamp}:${entry.source}`,
      CACHE_LIMITS.routes,
    ),
    jsTasks: mergeLatestByKey(
      currentProcess.jsTasks,
      incoming.jsTasks,
      (entry) =>
        `${entry.label}:${entry.durationMs}:${entry.timestamp}:${entry.source}`,
      CACHE_LIMITS.jsTasks,
    ),
    appData: mergeLatestByKey(
      currentProcess.appData,
      incoming.appData,
      (entry) => entry.namespace,
      CACHE_LIMITS.appData,
    ),
    uiElements: mergeLatestByKey(
      currentProcess.uiElements,
      incoming.uiElements,
      (entry) => entry.elementId,
      CACHE_LIMITS.uiElements,
    ),
    interactions: mergeLatestByKey(
      currentProcess.interactions,
      incoming.interactions,
      (entry) => `${entry.interactionId}:${entry.phase}`,
      CACHE_LIMITS.interactions,
    ),
  };
  const changed = stableCacheValue(previous) !== stableCacheValue(cache);
  return {
    cache: changed ? cache : previous,
    changed,
    observed: {
      networkRequests: incoming.networkRequests.length,
      renderStats: incoming.renderStats.length,
      routes: incoming.routes.length,
      jsTasks: incoming.jsTasks.length,
      appData: incoming.appData.length,
      uiElements: incoming.uiElements.length,
      interactions: incoming.interactions.length,
    },
    processChanged,
  };
}
