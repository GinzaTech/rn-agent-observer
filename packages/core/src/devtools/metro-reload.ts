import { ObserverError } from '../errors.js';
import { withCdpLock } from './cdp-lock.js';
import { CdpConnection } from './cdp-client.js';
import { listMetroTargets, metroUrlFromEnv, selectTarget } from './metro.js';

/**
 * Triggers a JS-only reload through Metro's inspector (CDP Page.reload),
 * keeping native state alive. Requires the app to be connected to Metro.
 */
export async function reloadViaMetro(
  metroUrlInput: string | undefined,
  appId: string,
  artifactRoot?: string,
): Promise<void> {
  const run = async () => {
    const metroUrl = metroUrlFromEnv(metroUrlInput);
    const targets = await listMetroTargets(metroUrl);
    const target = selectTarget(targets, appId);
    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    try {
      await connection.send('Page.reload', {}, 15_000);
    } finally {
      connection.close();
    }
  };
  if (artifactRoot) {
    return withCdpLock(artifactRoot, run);
  }
  return run();
}

export function metroReloadUnavailableReason(error: unknown): string {
  if (error instanceof ObserverError) return error.code;
  return error instanceof Error ? error.message : String(error);
}
