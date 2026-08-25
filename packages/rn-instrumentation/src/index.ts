import { hmacSha256Hex } from './hmac.js';

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

const SAFE_HEADER_KEYS = new Set([
  'accept',
  'accept-language',
  'cache-control',
  'content-length',
  'content-type',
  'etag',
  'expires',
  'last-modified',
]);

const SAFE_BODY_KEYS = new Set([
  'code',
  'count',
  'limit',
  'offset',
  'ok',
  'page',
  'status',
  'type',
]);

/** Current on-device telemetry contract written into every observer log. */
export const TELEMETRY_VERSION = 1 as const;

/** Hard upper bound for one serialized app-data payload. */
export const MAX_APP_DATA_PAYLOAD_CHARACTERS = 8192;

/**
 * React Native defines `__DEV__` at bundle time. Treat a missing flag as
 * disabled rather than assuming development: this package may accidentally be
 * imported by a production, SSR, or non-RN bundle and telemetry must fail
 * closed there.
 */
export function isDevelopmentInstrumentationEnabled(): boolean {
  return (
    (globalThis as typeof globalThis & { readonly __DEV__?: unknown })
      .__DEV__ === true
  );
}

/**
 * Conservative keys that are useful for UI/debug state and do not normally
 * carry identity, credentials, or arbitrary user content. Matching is
 * case-insensitive. Unknown keys are retained only as redaction markers.
 */
export const DEFAULT_SAFE_APP_DATA_KEYS = [
  'active',
  'attempt',
  'attempts',
  'count',
  'enabled',
  'errorCode',
  'feature',
  'flag',
  'flags',
  'index',
  'isLoading',
  'itemCount',
  'itemsCount',
  'length',
  'loading',
  'mode',
  'ok',
  'page',
  'ready',
  'route',
  'rowArrayLength',
  'screen',
  'selected',
  'status',
  'step',
  'tick',
  'type',
  'version',
  'visible',
] as const;

export interface AppDataPrivacyPolicy {
  /** Keys whose scalar values are safe to emit. Sensitive key names still win. */
  safeKeys: readonly string[];
  /** May lower, but never raise, the global 8 KiB serialized payload cap. */
  maxPayloadCharacters?: number;
}

export interface InstrumentationConfig {
  enabled: boolean;
  captureNetworkBodies: boolean;
  maxBodyPreviewCharacters: number;
}

export interface NetworkEvent {
  id: string;
  method: string;
  url: string;
  status?: number;
  durationMs: number;
  requestBytes?: number;
  responseBytes?: number;
  requestBodyPreview?: string;
  responseBodyPreview?: string;
  responseHeaders?: Record<string, string>;
  timestamp: string;
  source: 'rn-instrumentation';
  error?: string;
}

export interface ObservedUiElement {
  elementId: string;
  testId?: string;
  componentName: string;
  role?: string;
  label?: string;
  parentId?: string;
  mounted: boolean;
  visible?: boolean;
  enabled?: boolean;
}

export interface ObservedInteraction {
  elementId: string;
  testId?: string;
  label?: string;
}

export function createInstrumentationConfig(
  enabled = false,
  captureNetworkBodies = false,
): InstrumentationConfig {
  return { enabled, captureNetworkBodies, maxBodyPreviewCharacters: 4096 };
}

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
    return value.replace(
      /(^|[?&\s])([a-zA-Z0-9_.-]+)=([^&\s]+)/g,
      (match: string, prefix: string, key: string) =>
        SAFE_QUERY_KEYS.has(key.toLowerCase())
          ? match
          : `${prefix}${key}=[REDACTED]`,
    );
  }
}

function redactBodyValue(value: unknown, safe = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactBodyValue(item, safe));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SAFE_BODY_KEYS.has(key.toLowerCase())
          ? redactBodyValue(item, true)
          : '[REDACTED]',
      ]),
    );
  }
  if (!safe) return '[REDACTED]';
  return typeof value === 'string' ? value.slice(0, 128) : value;
}

export function redactSensitiveText(value: string): string {
  try {
    return JSON.stringify(redactBodyValue(JSON.parse(value) as unknown)).slice(
      0,
      4096,
    );
  } catch {
    // Unstructured text has no trustworthy field boundary, so fail closed.
    return '[REDACTED]';
  }
}

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SAFE_HEADER_KEYS.has(key.toLowerCase())
      ? value
      : '[REDACTED]';
  }
  return redacted;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function serializeTelemetryPayload(payload: object): string {
  return JSON.stringify({ ...payload, telemetryVersion: TELEMETRY_VERSION });
}

/**
 * Batched telemetry sink: many short events (render ticks, interactions) are
 * queued and flushed as a few console lines instead of one line per event,
 * which protects the logcat ring buffer during long sessions. Interactive
 * evidence is never lost — the queue always flushes on a timer and at
 * teardown. Batching is disabled by default; enable via
 * `configureTelemetryBatching({ enabled: true })` when a flow emits a high
 * event rate.
 */
interface TelemetryBatchingConfig {
  enabled: boolean;
  flushIntervalMs: number;
  maxQueuedEvents: number;
}

let batchingConfig: TelemetryBatchingConfig = {
  enabled: false,
  flushIntervalMs: 1_000,
  maxQueuedEvents: 20,
};
let telemetryQueue: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | undefined;

export function configureTelemetryBatching(
  config: Partial<TelemetryBatchingConfig>,
): TelemetryBatchingConfig {
  batchingConfig = { ...batchingConfig, ...config };
  if (!batchingConfig.enabled) flushTelemetryQueue();
  return { ...batchingConfig };
}

function flushTelemetryQueue(): void {
  if (telemetryQueue.length === 0) return;
  const batch = telemetryQueue;
  telemetryQueue = [];
  console.info(`RN_AGENT_OBSERVER_BATCH ${JSON.stringify(batch)}`);
}

function ensureFlushTimer(): void {
  if (flushTimer !== undefined || !batchingConfig.enabled) return;
  flushTimer = setInterval(() => {
    flushTelemetryQueue();
    if (flushTimer !== undefined && telemetryQueue.length === 0) {
      clearInterval(flushTimer);
      flushTimer = undefined;
    }
  }, batchingConfig.flushIntervalMs);
}

function emit(prefix: string, payload: object): void {
  if (!isDevelopmentInstrumentationEnabled()) return;
  const body = serializeTelemetryPayload(payload);
  const line = `${prefix} ${signTelemetryBody(body)}`;
  if (batchingConfig.enabled) {
    telemetryQueue.push(line);
    if (telemetryQueue.length >= batchingConfig.maxQueuedEvents) {
      flushTelemetryQueue();
    }
    ensureFlushTimer();
    return;
  }
  console.info(line);
}

/** Flushes any queued telemetry immediately (call before app teardown). */
export function flushTelemetry(): void {
  flushTelemetryQueue();
}

declare global {
  var __RNOBS_TELEMETRY_SECRET__: string | undefined;
}

/**
 * HMAC-SHA-256 integrity tag over the payload + a per-build secret set by the
 * app via globalThis.__RNOBS_TELEMETRY_SECRET__. The same secret must be set
 * in the observer process as RN_OBSERVER_TELEMETRY_SECRET. It protects against
 * another process injecting logcat lines without knowing the secret; it does
 * not protect a development bundle whose secret has been extracted. Pair it
 * with the observer's pid-pinned logcat filter.
 */
export function signTelemetryBody(body: string): string {
  const secret =
    (typeof globalThis !== 'undefined' &&
      globalThis.__RNOBS_TELEMETRY_SECRET__) ||
    '';
  if (secret.length === 0) return body;
  return `${body} rnobsSig=${hmacSha256Hex(secret, body)}`;
}

function safeUiLabel(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[REDACTED]',
    )
    .slice(0, 160);
}

let nextNetworkEventId = 0;

function networkEventId(): string {
  nextNetworkEventId += 1;
  return `${Date.now()}-${nextNetworkEventId}`;
}

export function installNetworkObserver(
  config = createInstrumentationConfig(true),
): () => void {
  if (
    !isDevelopmentInstrumentationEnabled() ||
    !config.enabled ||
    typeof globalThis.fetch !== 'function'
  )
    return () => {};
  if (config.captureNetworkBodies) {
    console.warn(
      'RN Agent Observer: development-only network body capture is enabled and may expose sensitive information.',
    );
  }
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const [input, init] = args;
    const started = performance.now();
    const timestamp = new Date().toISOString();
    const base = {
      id: networkEventId(),
      method:
        init?.method ??
        (typeof input === 'string' || input instanceof URL
          ? 'GET'
          : input.method),
      url: redactUrl(requestUrl(input)),
      timestamp,
      source: 'rn-instrumentation' as const,
      ...(config.captureNetworkBodies && typeof init?.body === 'string'
        ? {
            requestBodyPreview: redactSensitiveText(init.body).slice(
              0,
              config.maxBodyPreviewCharacters,
            ),
          }
        : {}),
    };
    try {
      const response = await original(...args);
      const contentLength = response.headers.get('content-length');
      const headers: Record<string, string> = {};
      if (config.captureNetworkBodies) {
        for (const [key, value] of response.headers.entries()) {
          headers[key] = value;
        }
      }
      const event: NetworkEvent = {
        ...base,
        status: response.status,
        durationMs: performance.now() - started,
        ...(contentLength ? { responseBytes: Number(contentLength) } : {}),
        ...(config.captureNetworkBodies
          ? {
              responseHeaders: redactHeaders(headers),
              responseBodyPreview: redactSensitiveText(
                await response
                  .clone()
                  .text()
                  .catch(() => ''),
              ).slice(0, config.maxBodyPreviewCharacters),
            }
          : {}),
      };
      emit('RN_AGENT_OBSERVER_NETWORK', event);
      return response;
    } catch (error) {
      const event: NetworkEvent = {
        ...base,
        durationMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
      emit('RN_AGENT_OBSERVER_NETWORK', event);
      throw error;
    }
  };
  return () => {
    globalThis.fetch = original;
  };
}

export function reportRoute(route: string): void {
  if (!isDevelopmentInstrumentationEnabled()) return;
  emit('RN_AGENT_OBSERVER_ROUTE', {
    route,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Reports React-owned mount/visibility state without serializing props or
 * input values. Call on mount/update and once with mounted=false on cleanup.
 */
export function reportUiElement(element: ObservedUiElement): void {
  if (!isDevelopmentInstrumentationEnabled()) return;
  emit('RN_AGENT_OBSERVER_UI_ELEMENT', {
    ...element,
    ...(element.label ? { label: safeUiLabel(element.label) } : {}),
    timestamp: new Date().toISOString(),
  });
}

let nextInteractionId = 0;

function interactionId(): string {
  nextInteractionId += 1;
  return `${Date.now()}-ui-${nextInteractionId}`;
}

/**
 * Wraps an app handler so physical/user presses are correlated with their
 * owning testID and completion/error. Arguments and return values are never
 * logged. The original sync/async behavior is preserved.
 */
export function observeInteraction<TArgs extends unknown[], TResult>(
  element: ObservedInteraction,
  handler: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  if (!isDevelopmentInstrumentationEnabled()) return handler;
  return (...args: TArgs): TResult => {
    const id = interactionId();
    const started = performance.now();
    const base = {
      interactionId: id,
      elementId: element.elementId,
      testId: element.testId ?? null,
      label: safeUiLabel(element.label) ?? null,
    };
    emit('RN_AGENT_OBSERVER_UI_INTERACTION', {
      ...base,
      phase: 'start',
      durationMs: null,
      error: null,
      timestamp: new Date().toISOString(),
    });
    try {
      const result = handler(...args);
      if (result instanceof Promise) {
        void result.then(
          () =>
            emit('RN_AGENT_OBSERVER_UI_INTERACTION', {
              ...base,
              phase: 'success',
              durationMs: performance.now() - started,
              error: null,
              timestamp: new Date().toISOString(),
            }),
          (error: unknown) =>
            emit('RN_AGENT_OBSERVER_UI_INTERACTION', {
              ...base,
              phase: 'error',
              durationMs: performance.now() - started,
              error: safeUiLabel(
                error instanceof Error ? error.message : String(error),
              ),
              timestamp: new Date().toISOString(),
            }),
        );
      } else {
        emit('RN_AGENT_OBSERVER_UI_INTERACTION', {
          ...base,
          phase: 'success',
          durationMs: performance.now() - started,
          error: null,
          timestamp: new Date().toISOString(),
        });
      }
      return result;
    } catch (error) {
      emit('RN_AGENT_OBSERVER_UI_INTERACTION', {
        ...base,
        phase: 'error',
        durationMs: performance.now() - started,
        error: safeUiLabel(
          error instanceof Error ? error.message : String(error),
        ),
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  };
}

const APP_DATA_REDACTED = '[REDACTED]';
const APP_DATA_TOO_LARGE = '[REDACTED_PAYLOAD_TOO_LARGE]';
const MAX_APP_DATA_DEPTH = 5;
const MAX_APP_DATA_ARRAY_ITEMS = 50;
const MAX_APP_DATA_OBJECT_KEYS = 50;
const MAX_APP_DATA_STRING_CHARACTERS = 160;
const MIN_APP_DATA_PAYLOAD_CHARACTERS = 512;

interface AppDataRedactionState {
  redacted: boolean;
  truncated: boolean;
}

function isSensitiveAppDataKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    normalized.includes('password') ||
    normalized.includes('passcode') ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('authorization') ||
    normalized.includes('credential') ||
    normalized.includes('cookie') ||
    normalized.includes('session') ||
    normalized.includes('privatekey') ||
    normalized.includes('apikey') ||
    normalized.includes('email') ||
    normalized.includes('phone') ||
    normalized.includes('address') ||
    normalized.includes('fullname') ||
    normalized.includes('firstname') ||
    normalized.includes('lastname') ||
    normalized.includes('username') ||
    normalized === 'pin' ||
    normalized === 'key'
  );
}

function redactSafeAppDataText(
  value: string,
  state: AppDataRedactionState,
): string {
  const redacted = redactUrl(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      APP_DATA_REDACTED,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]');
  if (redacted !== value) state.redacted = true;
  if (redacted.length > MAX_APP_DATA_STRING_CHARACTERS) {
    state.truncated = true;
  }
  return redacted.slice(0, MAX_APP_DATA_STRING_CHARACTERS);
}

function sanitizedAppDataValue(
  value: unknown,
  safeKeys: ReadonlySet<string>,
  state: AppDataRedactionState,
  seen: Set<object>,
  depth: number,
  scalarIsAllowed: boolean,
): unknown {
  if (depth > MAX_APP_DATA_DEPTH) {
    state.redacted = true;
    state.truncated = true;
    return APP_DATA_REDACTED;
  }
  if (value === null) return scalarIsAllowed ? null : APP_DATA_REDACTED;
  if (typeof value === 'string') {
    if (!scalarIsAllowed) {
      state.redacted = true;
      return APP_DATA_REDACTED;
    }
    return redactSafeAppDataText(value, state);
  }
  if (typeof value === 'number') {
    if (!scalarIsAllowed || !Number.isFinite(value)) {
      state.redacted = true;
      return APP_DATA_REDACTED;
    }
    return value;
  }
  if (typeof value === 'boolean') {
    if (!scalarIsAllowed) {
      state.redacted = true;
      return APP_DATA_REDACTED;
    }
    return value;
  }
  if (typeof value !== 'object') {
    state.redacted = true;
    return APP_DATA_REDACTED;
  }
  if (seen.has(value)) {
    state.redacted = true;
    state.truncated = true;
    return APP_DATA_REDACTED;
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (!scalarIsAllowed) {
        state.redacted = true;
        return APP_DATA_REDACTED;
      }
      if (value.length > MAX_APP_DATA_ARRAY_ITEMS) state.truncated = true;
      return value
        .slice(0, MAX_APP_DATA_ARRAY_ITEMS)
        .map((item) =>
          sanitizedAppDataValue(item, safeKeys, state, seen, depth + 1, true),
        );
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      state.redacted = true;
      return APP_DATA_REDACTED;
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_APP_DATA_OBJECT_KEYS) state.truncated = true;
    const output: [string, unknown][] = [];
    for (const [index, [key, item]] of entries
      .slice(0, MAX_APP_DATA_OBJECT_KEYS)
      .entries()) {
      const safe =
        safeKeys.has(key.toLowerCase()) && !isSensitiveAppDataKey(key);
      if (!safe) state.redacted = true;
      const outputKey = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(key)
        ? key
        : `[REDACTED_FIELD_${index + 1}]`;
      if (outputKey !== key) {
        state.redacted = true;
        if (key.length > 64) state.truncated = true;
      }
      output.push([
        outputKey,
        safe
          ? sanitizedAppDataValue(item, safeKeys, state, seen, depth + 1, true)
          : APP_DATA_REDACTED,
      ]);
    }
    return Object.fromEntries(output);
  } catch {
    state.redacted = true;
    return APP_DATA_REDACTED;
  } finally {
    seen.delete(value);
  }
}

function appDataPayloadLimit(policy: AppDataPrivacyPolicy | undefined): number {
  const requested = policy?.maxPayloadCharacters;
  if (requested === undefined || !Number.isFinite(requested)) {
    return MAX_APP_DATA_PAYLOAD_CHARACTERS;
  }
  return Math.max(
    MIN_APP_DATA_PAYLOAD_CHARACTERS,
    Math.min(MAX_APP_DATA_PAYLOAD_CHARACTERS, Math.floor(requested)),
  );
}

function safeAppDataNamespace(namespace: string): string {
  const safe = namespace
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '-')
    .slice(0, 80);
  return safe || 'unknown';
}

/**
 * Publishes an app-owned state snapshot (Redux store, navigation state,
 * feature flags, ...). Values are fail-closed: the built-in allowlist keeps a
 * useful set of operational fields while unknown and sensitive fields are
 * replaced with redaction markers. Pass an explicit policy to allow other
 * app-owned fields that are known to be safe. Credentials and common PII key
 * names cannot be allowlisted.
 */
export function reportAppData(
  namespace: string,
  data: unknown,
  policy?: AppDataPrivacyPolicy,
): void {
  if (!isDevelopmentInstrumentationEnabled()) return;
  const state: AppDataRedactionState = {
    redacted: false,
    truncated: false,
  };
  const safeKeys = new Set(
    (policy?.safeKeys ?? DEFAULT_SAFE_APP_DATA_KEYS).map((key) =>
      key.toLowerCase(),
    ),
  );
  const base = {
    namespace: safeAppDataNamespace(namespace),
    timestamp: new Date().toISOString(),
  };
  let safeData = sanitizedAppDataValue(
    data,
    safeKeys,
    state,
    new Set(),
    0,
    false,
  );
  let privacy = {
    policy: policy
      ? ('explicit-safe-allowlist' as const)
      : ('default-safe-allowlist' as const),
    redacted: state.redacted,
    truncated: state.truncated,
  };
  const limit = appDataPayloadLimit(policy);
  if (
    serializeTelemetryPayload({ ...base, data: safeData, privacy }).length >
    limit
  ) {
    safeData = APP_DATA_TOO_LARGE;
    privacy = { ...privacy, redacted: true, truncated: true };
  }
  emit('RN_AGENT_OBSERVER_APP_DATA', {
    ...base,
    data: safeData,
    privacy,
  });
}

export function reportJsTask(durationMs: number, label = 'anonymous'): void {
  if (!isDevelopmentInstrumentationEnabled()) return;
  emit('RN_AGENT_OBSERVER_JS_TASK', {
    durationMs,
    label,
    timestamp: new Date().toISOString(),
    source: 'rn-instrumentation',
  });
}

export function reportPerformanceMark(input: {
  name:
    | 'nativeLaunchStart'
    | 'nativeLaunchEnd'
    | 'runJSBundleStart'
    | 'runJSBundleEnd'
    | 'contentAppeared'
    | 'screenInteractive';
  startupId: string;
  startupType: 'cold' | 'warm' | 'hot' | 'unknown';
  foreground: boolean;
  timestamp?: string;
  monotonicMs?: number;
  source?: string;
}): void {
  if (!isDevelopmentInstrumentationEnabled()) return;
  if (!input.startupId || input.startupId.length > 80) {
    throw new RangeError('startupId must contain 1 to 80 characters');
  }
  if (
    input.monotonicMs !== undefined &&
    (!Number.isFinite(input.monotonicMs) || input.monotonicMs < 0)
  ) {
    throw new RangeError('monotonicMs must be a finite non-negative number');
  }
  emit('RN_AGENT_OBSERVER_PERFORMANCE_MARK', {
    name: input.name,
    startupId: input.startupId,
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...(input.monotonicMs === undefined
      ? {}
      : { monotonicMs: input.monotonicMs }),
    startupType: input.startupType,
    foreground: input.foreground,
    source: input.source ?? 'rn-instrumentation',
  });
}

export function reportNetworkRequest(input: {
  method: string;
  url: string;
  status?: number;
  durationMs: number;
  requestBytes?: number;
  responseBytes?: number;
  requestBodyPreview?: string;
  responseBodyPreview?: string;
  error?: string;
}): void {
  if (!isDevelopmentInstrumentationEnabled()) return;
  emit('RN_AGENT_OBSERVER_NETWORK', {
    id: networkEventId(),
    ...input,
    url: redactUrl(input.url),
    ...(input.requestBodyPreview !== undefined
      ? {
          requestBodyPreview: redactSensitiveText(
            input.requestBodyPreview,
          ).slice(0, 4096),
        }
      : {}),
    ...(input.responseBodyPreview !== undefined
      ? {
          responseBodyPreview: redactSensitiveText(
            input.responseBodyPreview,
          ).slice(0, 4096),
        }
      : {}),
    timestamp: new Date().toISOString(),
    source: 'rn-instrumentation',
  });
}

export function createRenderTracker(componentName: string) {
  if (!isDevelopmentInstrumentationEnabled()) {
    return (): void => undefined;
  }
  let renderCount = 0;
  let commitCount = 0;
  return (
    _id: string,
    _phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
  ): void => {
    renderCount += 1;
    commitCount += 1;
    emit('RN_AGENT_OBSERVER_RENDER', {
      componentName,
      renderCount,
      renderDurationMs: actualDuration,
      commitCount,
      changedProps: [],
      timestamp: new Date().toISOString(),
      source: 'react-profiler',
    });
  };
}
