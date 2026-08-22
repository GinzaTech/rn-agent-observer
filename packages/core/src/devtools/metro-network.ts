import type {
  NetworkRequest,
  NetworkSummary,
} from '@rn-agent-observer/schemas';
import { ObserverError } from '../errors.js';
import { redactUrl, summarizeNetwork } from '../network/network.js';
import { CdpConnection } from './cdp-client.js';
import { listMetroTargets, metroUrlFromEnv, selectTarget } from './metro.js';

export interface CdpNetworkEvent {
  method: string;
  params: Record<string, unknown>;
}

export interface MetroNetworkSnapshot {
  timestamp: string;
  metroUrl: string;
  appId: string;
  target: { id: string; title: string };
  durationMs: number;
  requests: NetworkRequest[];
  summary: NetworkSummary;
}

interface RequestStart {
  url: string;
  method: string;
  timestamp: number;
  wallTime?: number | undefined;
}

/**
 * Merges raw CDP Network domain events into observer NetworkRequests.
 * Durations use CDP monotonic timestamps; redirects keep the first timestamp
 * and the latest URL.
 */
export function mergeCdpNetworkEvents(
  events: CdpNetworkEvent[],
  receivedAtIso: string,
): NetworkRequest[] {
  const starts = new Map<string, RequestStart>();
  const responses = new Map<string, { status: number; timestamp: number }>();
  const finished = new Map<
    string,
    { timestamp: number; encodedDataLength?: number | undefined }
  >();
  const failed = new Map<string, { reason: string; timestamp?: number }>();
  for (const event of events) {
    const params = event.params;
    const requestId =
      typeof params.requestId === 'string' ? params.requestId : undefined;
    if (!requestId) continue;
    if (event.method === 'Network.requestWillBeSent') {
      const request = params.request as
        { url?: string; method?: string } | undefined;
      const timestamp =
        typeof params.timestamp === 'number' ? params.timestamp : undefined;
      if (!request?.url || !request.method || timestamp === undefined) continue;
      const existing = starts.get(requestId);
      starts.set(requestId, {
        url: request.url,
        method: request.method,
        timestamp: existing?.timestamp ?? timestamp,
        ...(typeof params.wallTime === 'number'
          ? { wallTime: params.wallTime }
          : {}),
      });
    } else if (event.method === 'Network.responseReceived') {
      const response = params.response as { status?: number } | undefined;
      const timestamp =
        typeof params.timestamp === 'number' ? params.timestamp : undefined;
      if (response?.status === undefined || timestamp === undefined) continue;
      responses.set(requestId, { status: response.status, timestamp });
    } else if (event.method === 'Network.loadingFinished') {
      const timestamp =
        typeof params.timestamp === 'number' ? params.timestamp : undefined;
      if (timestamp === undefined) continue;
      finished.set(requestId, {
        timestamp,
        ...(typeof params.encodedDataLength === 'number'
          ? { encodedDataLength: params.encodedDataLength }
          : {}),
      });
    } else if (event.method === 'Network.loadingFailed') {
      const reason =
        typeof params.errorText === 'string' && params.errorText
          ? params.errorText
          : typeof params.blockedReason === 'string'
            ? `blocked: ${params.blockedReason}`
            : params.canceled === true
              ? 'canceled'
              : 'failed';
      failed.set(requestId, {
        reason,
        ...(typeof params.timestamp === 'number'
          ? { timestamp: params.timestamp }
          : {}),
      });
    }
  }
  const requests: NetworkRequest[] = [];
  for (const [requestId, start] of starts) {
    const response = responses.get(requestId);
    const finish = finished.get(requestId);
    const failure = failed.get(requestId);
    const endTimestamp =
      finish?.timestamp ?? failure?.timestamp ?? response?.timestamp;
    const durationMs =
      endTimestamp !== undefined
        ? Math.max(
            0,
            Math.round((endTimestamp - start.timestamp) * 10_000) / 10,
          )
        : undefined;
    requests.push({
      id: requestId,
      method: start.method,
      url: redactUrl(start.url),
      ...(response ? { status: response.status } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(finish?.encodedDataLength !== undefined
        ? { responseBytes: Math.max(0, Math.round(finish.encodedDataLength)) }
        : {}),
      timestamp:
        start.wallTime !== undefined
          ? new Date(start.wallTime * 1_000).toISOString()
          : receivedAtIso,
      source: 'metro-cdp-network',
      ...(failure ? { error: failure.reason } : {}),
    });
  }
  return requests;
}

export async function collectMetroNetwork(options: {
  appId: string;
  metroUrl?: string;
  durationMs?: number;
}): Promise<MetroNetworkSnapshot> {
  const metroUrl = metroUrlFromEnv(options.metroUrl);
  const durationMs = Math.max(
    1_000,
    Math.min(options.durationMs ?? 5_000, 30_000),
  );
  const targets = await listMetroTargets(metroUrl);
  const target = selectTarget(targets, options.appId);
  let connection: CdpConnection;
  try {
    connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
  } catch (error) {
    throw new ObserverError(
      'DEVTOOLS_CONNECT_FAILED',
      `Could not attach to the React Native inspector target: ${
        error instanceof Error ? error.message : String(error)
      }`,
      true,
      'Ensure the app is running, Metro is reachable, and no other debugger session is active',
    );
  }
  const events: CdpNetworkEvent[] = [];
  try {
    await connection.send('Network.enable').catch((error: Error) => {
      throw new ObserverError(
        'METRO_NETWORK_UNSUPPORTED',
        `The runtime rejected the CDP Network domain: ${error.message}`,
        true,
        'The app runtime may not expose network events over CDP (needs RN 0.83+ / recent Hermes)',
      );
    });
    for (const method of [
      'Network.requestWillBeSent',
      'Network.responseReceived',
      'Network.loadingFinished',
      'Network.loadingFailed',
    ]) {
      connection.on(method, (params) => events.push({ method, params }));
    }
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    await connection.send('Network.disable').catch(() => undefined);
  } finally {
    connection.close();
  }
  const receivedAt = new Date().toISOString();
  const requests = mergeCdpNetworkEvents(events, receivedAt);
  return {
    timestamp: receivedAt,
    metroUrl,
    appId: options.appId,
    target: { id: target.id, title: target.title },
    durationMs,
    requests,
    summary: summarizeNetwork(requests),
  };
}
