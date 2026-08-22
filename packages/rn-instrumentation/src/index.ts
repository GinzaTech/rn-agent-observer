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

function emit(prefix: string, payload: unknown): void {
  console.info(`${prefix} ${JSON.stringify(payload)}`);
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
  if (!config.enabled || typeof globalThis.fetch !== 'function')
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

/**
 * Publishes an app-owned state snapshot (Redux store, navigation state,
 * MMKV storage, feature flags, ...). The observer surfaces the latest
 * snapshot per namespace through the app-data evidence channel.
 */
export function reportAppData(namespace: string, data: unknown): void {
  emit('RN_AGENT_OBSERVER_APP_DATA', {
    namespace,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function reportJsTask(durationMs: number, label = 'anonymous'): void {
  emit('RN_AGENT_OBSERVER_JS_TASK', {
    durationMs,
    label,
    timestamp: new Date().toISOString(),
    source: 'rn-instrumentation',
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
