import { ObserverError } from '../errors.js';

export interface MetroTarget {
  id: string;
  title: string;
  description?: string | undefined;
  deviceName?: string | undefined;
  appId?: string | undefined;
  webSocketDebuggerUrl: string;
}

export function metroUrlFromEnv(explicit?: string): string {
  return (
    explicit ?? process.env.RN_OBSERVER_METRO_URL ?? 'http://127.0.0.1:8081'
  );
}

export async function listMetroTargets(
  metroUrl: string,
  timeoutMs = 5_000,
): Promise<MetroTarget[]> {
  let response: Response;
  try {
    response = await fetch(new URL('json', metroUrl), {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new ObserverError(
      'METRO_UNREACHABLE',
      `Could not reach Metro at ${metroUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      true,
      'Start Metro (pnpm --filter <app> start) and run adb reverse tcp:8081 tcp:8081',
    );
  }
  if (!response.ok) {
    throw new ObserverError(
      'METRO_UNREACHABLE',
      `Metro responded ${response.status} at ${metroUrl}/json`,
      true,
      'Verify the Metro URL points at the bundler for this app',
    );
  }
  const raw = (await response.json()) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is MetroTarget =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as MetroTarget).webSocketDebuggerUrl === 'string',
  );
}

export function selectTarget(
  targets: MetroTarget[],
  appId: string,
): MetroTarget {
  const exact = targets.find(
    (target) => target.appId === appId || target.title.startsWith(appId),
  );
  const target = exact ?? targets[0];
  if (!target) {
    throw new ObserverError(
      'DEVTOOLS_TARGET_NOT_FOUND',
      `No React Native inspector target is registered for ${appId}`,
      true,
      'Open the app so it connects to Metro, and avoid opening React Native DevTools at the same time',
    );
  }
  return target;
}
