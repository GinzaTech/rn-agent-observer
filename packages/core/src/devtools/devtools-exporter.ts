import type {
  DevToolsConsoleEntry,
  DevToolsExport,
  DevToolsException,
  DevToolsHeap,
  DevToolsTarget,
} from '@rn-agent-observer/schemas';
import { ObserverError } from '../errors.js';
import { withCdpLock } from './cdp-lock.js';
import { CdpConnection } from './cdp-client.js';
import {
  listMetroTargets,
  metroUrlFromEnv,
  selectTarget,
  type MetroTarget,
} from './metro.js';

interface CdpRemoteObject {
  value?: unknown;
  description?: string;
  unserializableValue?: string;
  type?: string;
}

const CONSOLE_LEVELS: Record<string, DevToolsConsoleEntry['level']> = {
  log: 'info',
  info: 'info',
  warning: 'warn',
  error: 'error',
  debug: 'debug',
  verbose: 'trace',
};

export function consoleEntryFromEvent(
  params: Record<string, unknown>,
  receivedAt: string,
): DevToolsConsoleEntry | null {
  const type = typeof params.type === 'string' ? params.type : 'log';
  const level = CONSOLE_LEVELS[type];
  if (!level) return null;
  const args = Array.isArray(params.args)
    ? (params.args as CdpRemoteObject[])
    : [];
  const text = args
    .map((arg) => {
      if (arg.value !== undefined) {
        return typeof arg.value === 'string'
          ? arg.value
          : JSON.stringify(arg.value);
      }
      if (arg.unserializableValue !== undefined) {
        return arg.unserializableValue;
      }
      return arg.description ?? arg.type ?? 'undefined';
    })
    .join(' ')
    .trim();
  if (!text) return null;
  return {
    level,
    text,
    source: 'cdp-Runtime.consoleAPICalled',
    timestamp: receivedAt,
  };
}

export function exceptionFromEvent(
  params: Record<string, unknown>,
  receivedAt: string,
): DevToolsException | null {
  const details = params.exceptionDetails as
    | { text?: string; exception?: { description?: string; value?: unknown } }
    | undefined;
  if (!details) return null;
  const text = (
    details.exception?.description ??
    details.exception?.value ??
    details.text ??
    ''
  )
    .toString()
    .trim();
  if (!text) return null;
  // Keep only the message line; stack frames start with "    at ".
  const message = text.split(/\r?\n/)[0] ?? text;
  return { text: message, timestamp: receivedAt };
}

export function heapFromUsage(result: unknown): DevToolsHeap {
  const usage = result as { usedSize?: number; totalSize?: number } | undefined;
  const usedMb =
    typeof usage?.usedSize === 'number' ? usage.usedSize / 1024 / 1024 : null;
  const totalMb =
    typeof usage?.totalSize === 'number' ? usage.totalSize / 1024 / 1024 : null;
  return {
    usedMb,
    totalMb,
    available: usedMb !== null,
    source: 'cdp-Runtime.getHeapUsage',
    ...(usedMb === null ? { reason: 'Hermes did not report heap usage' } : {}),
  };
}

function targetInfo(target: MetroTarget): DevToolsTarget {
  return {
    id: target.id,
    title: target.title,
    ...(target.description ? { description: target.description } : {}),
    ...(target.deviceName ? { deviceName: target.deviceName } : {}),
  };
}

export async function collectDevToolsExport(options: {
  appId: string;
  metroUrl?: string;
  durationMs?: number;
  connectTimeoutMs?: number;
  artifactRoot?: string;
}): Promise<Omit<DevToolsExport, 'artifactId'>> {
  const metroUrl = metroUrlFromEnv(options.metroUrl);
  const durationMs = Math.max(
    1_000,
    Math.min(options.durationMs ?? 5_000, 60_000),
  );
  const targets = await listMetroTargets(metroUrl);
  const target = selectTarget(targets, options.appId);
  const run = () => collectFromTarget(target, metroUrl, options, durationMs);
  if (options.artifactRoot) {
    return withCdpLock(options.artifactRoot, run);
  }
  return run();
}

async function collectFromTarget(
  target: MetroTarget,
  metroUrl: string,
  options: { appId: string; connectTimeoutMs?: number },
  durationMs: number,
): Promise<Omit<DevToolsExport, 'artifactId'>> {
  let connection: CdpConnection;
  try {
    connection = await CdpConnection.connect(
      target.webSocketDebuggerUrl,
      options.connectTimeoutMs ?? 10_000,
    );
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
  const consoleEntries: DevToolsConsoleEntry[] = [];
  const exceptions: DevToolsException[] = [];
  try {
    await connection.send('Runtime.enable');
    await connection.send('Log.enable').catch(() => undefined);
    connection.on('Runtime.consoleAPICalled', (params) => {
      const entry = consoleEntryFromEvent(params, new Date().toISOString());
      if (entry) consoleEntries.push(entry);
    });
    connection.on('Runtime.exceptionThrown', (params) => {
      const entry = exceptionFromEvent(params, new Date().toISOString());
      if (entry) exceptions.push(entry);
    });
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const heap = heapFromUsage(
      await connection
        .send('Runtime.getHeapUsage', {}, 5_000)
        .catch(() => undefined),
    );
    await connection.send('Runtime.disable').catch(() => undefined);
    return {
      timestamp: new Date().toISOString(),
      metroUrl,
      appId: options.appId,
      target: targetInfo(target),
      durationMs,
      consoleEntries,
      exceptions,
      heap,
    };
  } finally {
    connection.close();
  }
}
