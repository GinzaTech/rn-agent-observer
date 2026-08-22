import type {
  LogEntry,
  NetworkRequest,
  NetworkSummary,
  ReactRenderStat,
  UiInteractionEvent,
} from '@rn-agent-observer/schemas';

const NETWORK_PREFIX = 'RN_AGENT_OBSERVER_NETWORK ';
const RENDER_PREFIX = 'RN_AGENT_OBSERVER_RENDER ';
const ROUTE_PREFIX = 'RN_AGENT_OBSERVER_ROUTE ';
const JS_TASK_PREFIX = 'RN_AGENT_OBSERVER_JS_TASK ';
const APP_DATA_PREFIX = 'RN_AGENT_OBSERVER_APP_DATA ';
const UI_ELEMENT_PREFIX = 'RN_AGENT_OBSERVER_UI_ELEMENT ';
const UI_INTERACTION_PREFIX = 'RN_AGENT_OBSERVER_UI_INTERACTION ';

export interface UiElementTelemetry {
  elementId: string;
  testId: string | null;
  componentName: string;
  role: string | null;
  label: string | null;
  parentId: string | null;
  mounted: boolean;
  visible: boolean | null;
  enabled: boolean | null;
  timestamp: string;
}

export interface AppDataEvent {
  namespace: string;
  data: unknown;
  timestamp: string;
}

/**
 * Returns the latest app-data snapshot per namespace, in namespace order.
 * Sources: instrumentation `reportAppData` (Redux store, navigation state,
 * MMKV storage dumps, or any app-owned state).
 */
export function appDataFromLogs(logs: LogEntry[]): AppDataEvent[] {
  const latest = new Map<string, AppDataEvent>();
  for (const entry of logs) {
    const payload = parsePayload<{
      namespace: string;
      data: unknown;
      timestamp?: string;
    }>(entry.message, APP_DATA_PREFIX);
    if (!payload?.namespace) continue;
    latest.set(payload.namespace, {
      namespace: payload.namespace,
      data: payload.data,
      timestamp: payload.timestamp ?? entry.timestamp,
    });
  }
  return [...latest.values()].sort((a, b) =>
    a.namespace.localeCompare(b.namespace),
  );
}

const SAFE_QUERY_KEYS = new Set([
  'q',
  'query',
  'page',
  'limit',
  'offset',
  'sort',
  'order',
  'lang',
  'locale',
  'platform',
  'version',
]);

function redactQueryPairs(value: string): string {
  return value.replace(
    /(^|[?&\s])([a-zA-Z0-9_.-]+)=([^&\s]+)/g,
    (match: string, prefix: string, key: string) =>
      SAFE_QUERY_KEYS.has(key.toLowerCase())
        ? match
        : `${prefix}${key}=[REDACTED]`,
  );
}

/**
 * Host-side URL redaction for CDP-collected requests. Kept in parallel with
 * rn-instrumentation's redactUrl because that package must stay dependency-free
 * for app bundling.
 */
export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (!SAFE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return redactQueryPairs(value);
  }
}

export interface JsTaskEvent {
  durationMs: number;
  label: string;
  timestamp: string;
  source: string;
}

function parsePayload<T>(message: string, prefix: string): T | null {
  const index = message.indexOf(prefix);
  if (index < 0) return null;
  try {
    return JSON.parse(message.slice(index + prefix.length)) as T;
  } catch {
    return null;
  }
}

export function networkRequestsFromLogs(logs: LogEntry[]): NetworkRequest[] {
  return logs
    .map((entry) => parsePayload<NetworkRequest>(entry.message, NETWORK_PREFIX))
    .filter((request): request is NetworkRequest => request !== null);
}

export function renderStatsFromLogs(logs: LogEntry[]): ReactRenderStat[] {
  return logs
    .map((entry) => parsePayload<ReactRenderStat>(entry.message, RENDER_PREFIX))
    .filter((stat): stat is ReactRenderStat => stat !== null);
}

export function routeFromLogs(logs: LogEntry[]): string | null {
  return (
    logs
      .map((entry) =>
        parsePayload<{ route: string }>(entry.message, ROUTE_PREFIX),
      )
      .filter((value): value is { route: string } => value !== null)
      .at(-1)?.route ?? null
  );
}

export function uiElementsFromLogs(logs: LogEntry[]): UiElementTelemetry[] {
  const latest = new Map<string, UiElementTelemetry>();
  for (const entry of logs) {
    const payload = parsePayload<Partial<UiElementTelemetry>>(
      entry.message,
      UI_ELEMENT_PREFIX,
    );
    if (
      !payload?.elementId ||
      !payload.componentName ||
      typeof payload.mounted !== 'boolean'
    ) {
      continue;
    }
    latest.set(payload.elementId, {
      elementId: payload.elementId,
      testId: payload.testId ?? null,
      componentName: payload.componentName,
      role: payload.role ?? null,
      label: payload.label ?? null,
      parentId: payload.parentId ?? null,
      mounted: payload.mounted,
      visible: payload.visible ?? null,
      enabled: payload.enabled ?? null,
      timestamp: payload.timestamp ?? entry.timestamp,
    });
  }
  return [...latest.values()];
}

export function uiInteractionsFromLogs(logs: LogEntry[]): UiInteractionEvent[] {
  const events: UiInteractionEvent[] = [];
  for (const entry of logs) {
    const payload = parsePayload<Partial<UiInteractionEvent>>(
      entry.message,
      UI_INTERACTION_PREFIX,
    );
    if (
      !payload?.interactionId ||
      !payload.elementId ||
      !payload.phase ||
      !['start', 'success', 'error'].includes(payload.phase)
    ) {
      continue;
    }
    events.push({
      interactionId: payload.interactionId,
      elementId: payload.elementId,
      testId: payload.testId ?? null,
      label: payload.label ?? null,
      phase: payload.phase,
      timestamp: payload.timestamp ?? entry.timestamp,
      durationMs: payload.durationMs ?? null,
      error: payload.error ?? null,
    });
  }
  return events;
}

export function jsTasksFromLogs(logs: LogEntry[]): JsTaskEvent[] {
  return logs
    .map((entry) => parsePayload<JsTaskEvent>(entry.message, JS_TASK_PREFIX))
    .filter((event): event is JsTaskEvent => event !== null);
}

function percentile(sorted: number[], value: number): number | null {
  if (!sorted.length) return null;
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)] ??
    null
  );
}

export function summarizeNetwork(requests: NetworkRequest[]): NetworkSummary {
  const durations = requests
    .map((request) => request.durationMs)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  return {
    requestCount: requests.length,
    failedRequests: requests.filter(
      (request) => request.error || (request.status ?? 0) >= 400,
    ).length,
    averageLatencyMs: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    totalBytes: requests.reduce(
      (sum, request) =>
        sum + (request.requestBytes ?? 0) + (request.responseBytes ?? 0),
      0,
    ),
    slowestEndpoints: [...requests]
      .filter(
        (request): request is NetworkRequest & { durationMs: number } =>
          request.durationMs !== undefined,
      )
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 5)
      .map((request) => ({
        url: request.url,
        method: request.method,
        durationMs: request.durationMs,
      })),
  };
}
