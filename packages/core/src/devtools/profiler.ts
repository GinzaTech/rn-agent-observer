import { ObserverError } from '../errors.js';
import { withCdpLock } from './cdp-lock.js';
import { CdpConnection } from './cdp-client.js';
import { listMetroTargets, metroUrlFromEnv, selectTarget } from './metro.js';

export interface CpuProfile {
  nodes?: unknown[];
  samples?: unknown[];
  startTime?: number;
  endTime?: number;
}

export interface DevToolsProfileResult {
  startedAt: string;
  stoppedAt: string;
  durationMs: number;
  nodeCount: number;
  sampleCount: number;
  profile: CpuProfile;
}

function profileUnsupported(error: unknown): ObserverError {
  return new ObserverError(
    'DEVTOOLS_PROFILE_FAILED',
    `The runtime could not record a JS CPU profile: ${
      error instanceof Error ? error.message : String(error)
    }`,
    true,
    'The Hermes runtime may not support the CDP Profiler domain; use Perfetto trace for native profiling',
  );
}

export function summarizeProfile(profile: unknown): {
  nodeCount: number;
  sampleCount: number;
  profile: CpuProfile;
} {
  const typed = (profile ?? {}) as CpuProfile;
  return {
    nodeCount: Array.isArray(typed.nodes) ? typed.nodes.length : 0,
    sampleCount: Array.isArray(typed.samples) ? typed.samples.length : 0,
    profile: typed,
  };
}

/**
 * Collects a JS CPU profile via the CDP Profiler domain (Hermes sampling).
 */
export async function collectDevToolsProfile(options: {
  appId: string;
  metroUrl?: string;
  durationMs?: number;
  artifactRoot?: string;
}): Promise<DevToolsProfileResult> {
  const run = () => collectProfileFromMetro(options);
  if (options.artifactRoot) {
    return withCdpLock(options.artifactRoot, run);
  }
  return run();
}

async function collectProfileFromMetro(options: {
  appId: string;
  metroUrl?: string;
  durationMs?: number;
}): Promise<DevToolsProfileResult> {
  const metroUrl = metroUrlFromEnv(options.metroUrl);
  const durationMs = Math.max(
    1_000,
    Math.min(options.durationMs ?? 5_000, 60_000),
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
  try {
    const startedAt = new Date().toISOString();
    try {
      await connection.send('Profiler.enable');
      await connection
        .send('Profiler.setSamplingInterval', { interval: 1_000 })
        .catch(() => undefined);
      await connection.send('Profiler.start');
    } catch (error) {
      throw profileUnsupported(error);
    }
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const stopped = new Date().toISOString();
    let stopResult: unknown;
    try {
      stopResult = await connection.send('Profiler.stop', {}, 15_000);
    } catch (error) {
      throw profileUnsupported(error);
    }
    const profile = (stopResult as { profile?: unknown })?.profile;
    const summarized = summarizeProfile(profile);
    return {
      startedAt,
      stoppedAt: stopped,
      durationMs,
      nodeCount: summarized.nodeCount,
      sampleCount: summarized.sampleCount,
      profile: summarized.profile,
    };
  } finally {
    connection.close();
  }
}
