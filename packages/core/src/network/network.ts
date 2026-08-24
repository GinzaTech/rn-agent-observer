import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  AppDataTelemetryPayloadSchema,
  JsTaskTelemetryPayloadSchema,
  NetworkTelemetryPayloadSchema,
  RenderTelemetryPayloadSchema,
  RouteTelemetryPayloadSchema,
  UiElementTelemetryPayloadSchema,
  UiInteractionTelemetryPayloadSchema,
  type AppDataPrivacy,
  type JsTaskTelemetryPayload,
  type LogEntry,
  type NetworkRequest,
  type NetworkSummary,
  type ReactRenderStat,
  type UiInteractionEvent,
} from '@rn-agent-observer/schemas';

const NETWORK_PREFIX = 'RN_AGENT_OBSERVER_NETWORK ';
const RENDER_PREFIX = 'RN_AGENT_OBSERVER_RENDER ';
const ROUTE_PREFIX = 'RN_AGENT_OBSERVER_ROUTE ';
const JS_TASK_PREFIX = 'RN_AGENT_OBSERVER_JS_TASK ';
const APP_DATA_PREFIX = 'RN_AGENT_OBSERVER_APP_DATA ';
const UI_ELEMENT_PREFIX = 'RN_AGENT_OBSERVER_UI_ELEMENT ';
const UI_INTERACTION_PREFIX = 'RN_AGENT_OBSERVER_UI_INTERACTION ';
const BATCH_PREFIX = 'RN_AGENT_OBSERVER_BATCH ';

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
  privacy?: AppDataPrivacy;
}

/**
 * Returns the latest app-data snapshot per namespace, in namespace order.
 * Sources: instrumentation `reportAppData` (Redux store, navigation state,
 * MMKV storage dumps, or any app-owned state).
 */
/**
 * Expands `RN_AGENT_OBSERVER_BATCH ["line","line",...]` entries (emitted by
 * the instrumentation's batching mode) back into individual log entries so
 * downstream parsers stay simple. Non-batch entries pass through untouched.
 */
export function expandBatchedEntries(logs: LogEntry[]): LogEntry[] {
  const expanded: LogEntry[] = [];
  for (const entry of logs) {
    const marker = entry.message.indexOf(BATCH_PREFIX);
    if (marker < 0) {
      expanded.push(entry);
      continue;
    }
    try {
      const lines = JSON.parse(
        entry.message.slice(marker + BATCH_PREFIX.length),
      ) as unknown;
      if (!Array.isArray(lines)) {
        expanded.push(entry);
        continue;
      }
      for (const line of lines) {
        if (typeof line !== 'string') continue;
        expanded.push({
          ...entry,
          message: line,
          metadata: { ...entry.metadata, batched: true },
        });
      }
    } catch {
      expanded.push(entry);
    }
  }
  return expanded;
}

export function appDataFromLogs(logs: LogEntry[]): AppDataEvent[] {
  const latest = new Map<string, AppDataEvent>();
  for (const entry of logs) {
    const payload = validPayload(
      parsePayload(
        entry.message,
        APP_DATA_PREFIX,
        AppDataTelemetryPayloadSchema,
      ),
    );
    if (!payload) continue;
    const event: AppDataEvent = {
      namespace: payload.namespace,
      data: payload.data,
      timestamp: payload.timestamp ?? entry.timestamp,
    };
    if (payload.privacy) event.privacy = payload.privacy;
    latest.set(payload.namespace, event);
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

export interface RouteEvent {
  route: string;
  timestamp: string;
  source: string;
}

export type TelemetryKind =
  | 'network'
  | 'render'
  | 'route'
  | 'js-task'
  | 'app-data'
  | 'ui-element'
  | 'ui-interaction';

export interface InvalidTelemetryEvent {
  kind: TelemetryKind;
  timestamp: string;
  source: string;
  reason: 'malformed-json' | 'schema-validation';
  details: string;
}

interface RuntimeSchema<T> {
  safeParse(
    value: unknown,
  ):
    { success: true; data: T } | { success: false; error: { message: string } };
}

type PayloadParseResult<T> =
  | { status: 'not-present' }
  | { status: 'valid'; data: T }
  | {
      status: 'invalid';
      reason: InvalidTelemetryEvent['reason'];
      details: string;
    };

/**
 * Verifies the optional HMAC-SHA-256 tag appended by instrumentation
 * (`rnobsSig=<hex>`). Once the observer has RN_OBSERVER_TELEMETRY_SECRET,
 * unsigned payloads are rejected too: accepting them would reopen the
 * evidence-poisoning path that enabled the integrity mode in the first place.
 */
export function verifyTelemetrySignature(body: string): {
  body: string;
  signatureValid: boolean | null;
} {
  const secret = process.env.RN_OBSERVER_TELEMETRY_SECRET ?? '';
  const match = body.match(/\s?rnobsSig=([0-9a-fA-F]{64})$/);
  if (!match) {
    return { body, signatureValid: secret.length > 0 ? false : null };
  }
  const signedBody = body.slice(0, match.index);
  const signature = match[1];
  if (!signature) return { body: signedBody, signatureValid: false };
  if (secret.length === 0) return { body: signedBody, signatureValid: null };
  const expected = Buffer.from(
    createHmac('sha256', secret).update(signedBody).digest('hex'),
    'hex',
  );
  const actual = Buffer.from(signature, 'hex');
  return {
    body: signedBody,
    signatureValid:
      actual.length === expected.length && timingSafeEqual(actual, expected),
  };
}

function parsePayload<T>(
  message: string,
  prefix: string,
  schema: RuntimeSchema<T>,
): PayloadParseResult<T> {
  const index = message.indexOf(prefix);
  if (index < 0) return { status: 'not-present' };
  const raw = message.slice(index + prefix.length);
  const { body, signatureValid } = verifyTelemetrySignature(raw);
  if (signatureValid === false) {
    return {
      status: 'invalid',
      reason: 'schema-validation',
      details:
        'Telemetry signature mismatch (possible forged RN_AGENT_OBSERVER event)',
    };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(body);
  } catch {
    return {
      status: 'invalid',
      reason: 'malformed-json',
      details: 'Telemetry payload is not valid JSON',
    };
  }
  const result = schema.safeParse(candidate);
  if (!result.success) {
    return {
      status: 'invalid',
      reason: 'schema-validation',
      details: result.error.message.slice(0, 1000),
    };
  }
  return { status: 'valid', data: result.data };
}

function validPayload<T>(result: PayloadParseResult<T>): T | null {
  return result.status === 'valid' ? result.data : null;
}

const TELEMETRY_DEFINITIONS: readonly {
  kind: TelemetryKind;
  prefix: string;
  schema: RuntimeSchema<unknown>;
}[] = [
  {
    kind: 'network',
    prefix: NETWORK_PREFIX,
    schema: NetworkTelemetryPayloadSchema,
  },
  {
    kind: 'render',
    prefix: RENDER_PREFIX,
    schema: RenderTelemetryPayloadSchema,
  },
  { kind: 'route', prefix: ROUTE_PREFIX, schema: RouteTelemetryPayloadSchema },
  {
    kind: 'js-task',
    prefix: JS_TASK_PREFIX,
    schema: JsTaskTelemetryPayloadSchema,
  },
  {
    kind: 'app-data',
    prefix: APP_DATA_PREFIX,
    schema: AppDataTelemetryPayloadSchema,
  },
  {
    kind: 'ui-element',
    prefix: UI_ELEMENT_PREFIX,
    schema: UiElementTelemetryPayloadSchema,
  },
  {
    kind: 'ui-interaction',
    prefix: UI_INTERACTION_PREFIX,
    schema: UiInteractionTelemetryPayloadSchema,
  },
];

/**
 * Reports observer-prefixed log lines that were rejected instead of silently
 * treating malformed or incompatible telemetry as evidence. Raw payloads are
 * intentionally omitted because they may contain sensitive data.
 */
export function invalidTelemetryFromLogs(
  logs: LogEntry[],
): InvalidTelemetryEvent[] {
  const invalid: InvalidTelemetryEvent[] = [];
  for (const entry of logs) {
    for (const definition of TELEMETRY_DEFINITIONS) {
      const result = parsePayload(
        entry.message,
        definition.prefix,
        definition.schema,
      );
      if (result.status !== 'invalid') continue;
      invalid.push({
        kind: definition.kind,
        timestamp: entry.timestamp,
        source: entry.source,
        reason: result.reason,
        details: result.details,
      });
      break;
    }
  }
  return invalid;
}

export function networkRequestsFromLogs(logs: LogEntry[]): NetworkRequest[] {
  return expandBatchedEntries(logs)
    .map((entry) =>
      validPayload(
        parsePayload(
          entry.message,
          NETWORK_PREFIX,
          NetworkTelemetryPayloadSchema,
        ),
      ),
    )
    .filter(
      (request): request is NonNullable<typeof request> => request !== null,
    )
    .map((request) => {
      const output = { ...request };
      delete output.telemetryVersion;
      return output;
    });
}

export function renderStatsFromLogs(logs: LogEntry[]): ReactRenderStat[] {
  return expandBatchedEntries(logs)
    .map((entry) =>
      validPayload(
        parsePayload(
          entry.message,
          RENDER_PREFIX,
          RenderTelemetryPayloadSchema,
        ),
      ),
    )
    .filter((stat): stat is NonNullable<typeof stat> => stat !== null)
    .map((stat) => {
      const output = { ...stat };
      delete output.telemetryVersion;
      return output;
    });
}

export function routeEventsFromLogs(logs: LogEntry[]): RouteEvent[] {
  const events: RouteEvent[] = [];
  for (const entry of expandBatchedEntries(logs)) {
    const payload = validPayload(
      parsePayload(entry.message, ROUTE_PREFIX, RouteTelemetryPayloadSchema),
    );
    if (!payload) continue;
    events.push({
      route: payload.route,
      timestamp: payload.timestamp ?? entry.timestamp,
      source: entry.source,
    });
  }
  return events;
}

export function routeFromLogs(logs: LogEntry[]): string | null {
  return routeEventsFromLogs(logs).at(-1)?.route ?? null;
}

export function uiElementsFromLogs(logs: LogEntry[]): UiElementTelemetry[] {
  const latest = new Map<string, UiElementTelemetry>();
  for (const entry of expandBatchedEntries(logs)) {
    const payload = validPayload(
      parsePayload(
        entry.message,
        UI_ELEMENT_PREFIX,
        UiElementTelemetryPayloadSchema,
      ),
    );
    if (!payload) continue;
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
  for (const entry of expandBatchedEntries(logs)) {
    const payload = validPayload(
      parsePayload(
        entry.message,
        UI_INTERACTION_PREFIX,
        UiInteractionTelemetryPayloadSchema,
      ),
    );
    if (!payload) continue;
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
  return expandBatchedEntries(logs)
    .map((entry) =>
      validPayload(
        parsePayload(
          entry.message,
          JS_TASK_PREFIX,
          JsTaskTelemetryPayloadSchema,
        ),
      ),
    )
    .filter((event): event is JsTaskTelemetryPayload => event !== null)
    .map((event) => {
      const output = { ...event };
      delete output.telemetryVersion;
      return output;
    });
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
  // A p95/p99 from a handful of samples is statistically meaningless;
  // disclose the sample count and flag low confidence instead of hiding it.
  const minSamplesForTailPercentile = 20;
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
    latencySampleCount: durations.length,
    percentileLowConfidence: durations.length < minSamplesForTailPercentile,
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
