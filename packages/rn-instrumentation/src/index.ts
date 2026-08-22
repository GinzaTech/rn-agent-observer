const SENSITIVE_QUERY_KEYS = [
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'password',
  'secret',
  'token',
  'email',
  'phone',
  'address',
  'ssn',
] as const;

const SENSITIVE_HEADER_KEYS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'token',
  'password',
  'secret',
] as const;

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
      if (
        SENSITIVE_QUERY_KEYS.some((sensitive) =>
          key.toLowerCase().includes(sensitive),
        )
      ) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.toString();
  } catch {
    return value.replace(
      /((?:access_token|refresh_token|api[_-]?key|password|secret|token)=)[^&\s]+/gi,
      '$1[REDACTED]',
    );
  }
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(
      /((?:authorization|cookie|set-cookie|x-api-key|access_token|refresh_token|api[_-]?key|password|secret|token|email|phone|address|ssn)["']?\s*[:=]\s*["']?)[^,"'&\s}]+/gi,
      '$1[REDACTED]',
    )
    .slice(0, 4096);
}

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = SENSITIVE_HEADER_KEYS.some((sensitive) =>
      key.toLowerCase().includes(sensitive),
    )
      ? '[REDACTED]'
      : value;
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
