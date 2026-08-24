import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
/** realpathSync.native expands Windows 8.3 short names; plain realpath does not. */
const realPath = (value: string): string => realpathSync.native(value);
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExternalPluginHost,
  ExternalPluginHostError,
  ExternalPluginRpcError,
  resolveContainedPluginCwd,
} from './external-host.js';
import { EXTERNAL_PLUGIN_PROTOCOL } from './manifest.js';

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/external-plugin-fixture.mjs', import.meta.url),
);
const PLUGIN_ID = 'community.external-action';
const PROVIDES = ['action.device-tap'];
const REQUIRES = ['device.android'];
const temporaryDirectories: string[] = [];
const activeHosts: ExternalPluginHost[] = [];

afterEach(async () => {
  for (const host of activeHosts.splice(0).reverse()) {
    await host.dispose().catch(() => undefined);
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
});

function temporaryProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'rnobs-plugin-host-'));
  temporaryDirectories.push(root);
  return root;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return predicate();
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function actionManifest(
  options: {
    readonly maxMessageBytes?: number;
    readonly requestTimeoutMs?: number;
    readonly fixturePluginId?: string;
    readonly fixtureProvides?: readonly string[];
  } = {},
) {
  return {
    manifestVersion: 1,
    apiVersion: 1,
    id: PLUGIN_ID,
    displayName: 'External action fixture',
    version: '1.0.0',
    kind: 'action',
    capabilities: { provides: PROVIDES, requires: REQUIRES },
    permissions: ['device:control'],
    risk: 'high',
    execution: {
      mode: 'external-process',
      protocol: EXTERNAL_PLUGIN_PROTOCOL,
      command: process.execPath,
      args: [
        FIXTURE_PATH,
        options.fixturePluginId ?? PLUGIN_ID,
        'action',
        JSON.stringify(options.fixtureProvides ?? PROVIDES),
        JSON.stringify(REQUIRES),
      ],
      shell: false,
      environmentAllowlist: ['PLUGIN_ALLOWED'],
      requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
      shutdownTimeoutMs: 500,
      maxMessageBytes: options.maxMessageBytes ?? 16 * 1024,
    },
  } as const;
}

function providerManifest() {
  return {
    ...actionManifest(),
    id: 'community.external-provider',
    displayName: 'External provider fixture',
    kind: 'provider',
    capabilities: {
      provides: ['provider.device-state'],
      requires: REQUIRES,
    },
    permissions: ['device:read'],
    risk: 'read-only',
    execution: {
      ...actionManifest().execution,
      args: [
        FIXTURE_PATH,
        'community.external-provider',
        'provider',
        JSON.stringify(['provider.device-state']),
        JSON.stringify(REQUIRES),
      ],
    },
  } as const;
}

function createActionHost(
  root: string,
  manifest = actionManifest(),
  options: {
    readonly stderrMaxBytes?: number;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  } = {},
): ExternalPluginHost {
  const host = new ExternalPluginHost(manifest, {
    projectRoot: root,
    environment:
      options.environment ??
      ({
        PLUGIN_ALLOWED: 'visible',
        PLUGIN_SECRET: 'must-not-forward',
      } as const),
    capabilities: REQUIRES,
    grantedPermissions: ['device:control'],
    ...(options.stderrMaxBytes === undefined
      ? {}
      : { stderrMaxBytes: options.stderrMaxBytes }),
  });
  activeHosts.push(host);
  return host;
}

describe('external plugin process host', () => {
  it('enforces cwd containment after path resolution', () => {
    const root = temporaryProject();
    const contained = join(root, 'plugins', 'fixture');
    mkdirSync(contained, { recursive: true });
    expect(resolveContainedPluginCwd(root, 'plugins/fixture')).toBe(
      realPath(contained),
    );

    const outside = temporaryProject();
    expect(() => resolveContainedPluginCwd(root, outside)).toThrow(
      ExternalPluginHostError,
    );
  });

  it('handshakes, forwards only allowlisted env, tracks IDs and disposes', async () => {
    const root = temporaryProject();
    const host = createActionHost(root, actionManifest(), {
      stderrMaxBytes: 128,
    });
    const handshake = await host.start();
    expect(handshake).toMatchObject({
      protocol: EXTERNAL_PLUGIN_PROTOCOL,
      pluginId: PLUGIN_ID,
      kind: 'action',
      apiVersion: 1,
      capabilities: { provides: PROVIDES, requires: REQUIRES },
    });
    expect(handshake.pid).toBeGreaterThan(0);

    const first = await host.executeAction({ mode: 'echo', value: 1 });
    const second = await host.executeAction({ mode: 'echo', value: 2 });
    expect(first).toMatchObject({
      requestId: 3,
      cwd: realPath(root),
      environment: { allowed: 'visible', secret: null },
      params: { value: 1 },
    });
    expect(second).toMatchObject({ requestId: 4, params: { value: 2 } });

    await host.executeAction({ mode: 'stderr' });
    // On POSIX the stderr chunk can be pumped after the stdout response,
    // so wait briefly for the pipe to drain instead of asserting instantly.
    await vi.waitFor(() => expect(host.stderr.truncated).toBe(true), {
      timeout: 5_000,
      interval: 25,
    });
    expect(host.stderr.text).toContain('REDACTED');
    expect(host.stderr.text).not.toContain('super-secret');
    expect(host.stderr.text).not.toContain('abc.def.ghi');
    expect(host.stderr.text).not.toContain('user@example.com');

    await host.dispose();
    expect(host.state).toBe('stopped');
  });

  it('keeps JSON-RPC application errors recoverable and redacted', async () => {
    const root = temporaryProject();
    const host = createActionHost(root);
    await expect(
      host.executeAction({ mode: 'rpc-error' }),
    ).rejects.toBeInstanceOf(ExternalPluginRpcError);
    await expect(host.executeAction({ mode: 'rpc-error' })).rejects.not.toThrow(
      'rpc-secret',
    );
    expect(host.state).toBe('ready');
  });

  it('fails closed when runtime identity or capabilities differ from manifest', async () => {
    const root = temporaryProject();
    const identityHost = createActionHost(
      root,
      actionManifest({ fixturePluginId: 'community.impostor' }),
    );
    await expect(identityHost.start()).rejects.toMatchObject({
      code: 'PLUGIN_HANDSHAKE_INVALID',
    });
    expect(identityHost.state).toBe('failed');

    const capabilityHost = createActionHost(
      root,
      actionManifest({ fixtureProvides: ['action.undeclared'] }),
    );
    await expect(capabilityHost.start()).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_MISMATCH',
    });
    expect(capabilityHost.state).toBe('failed');
  });

  it('rejects oversized or unterminated stdout and terminates the plugin', async () => {
    const root = temporaryProject();
    const host = createActionHost(
      root,
      actionManifest({ maxMessageBytes: 512 }),
    );
    await expect(
      host.executeAction({ mode: 'oversize' }),
    ).rejects.toMatchObject({ code: 'PLUGIN_STDOUT_LIMIT' });
    expect(host.state).toBe('failed');
  });

  it(
    'terminates a verified live child tree after request timeout',
    { timeout: 15_000 },
    async () => {
      const root = temporaryProject();
      const markerPath = join(root, 'orphan-marker.txt');
      const readyPath = join(root, 'descendant-ready.txt');
      const host = createActionHost(
        root,
        actionManifest({ requestTimeoutMs: 8_000 }),
      );
      const pending = host.executeAction(
        {
          mode: 'hang',
          markerPath,
          readyPath,
          markerDelayMs: 7_000,
        },
        { timeoutMs: 5_000 },
      );
      const pendingError = pending.catch((error: unknown) => error);
      expect(await waitUntil(() => existsSync(readyPath), 4_000)).toBe(true);
      const descendantPid = Number.parseInt(
        readFileSync(readyPath, 'utf8').trim(),
        10,
      );
      expect(Number.isSafeInteger(descendantPid)).toBe(true);
      expect(processIsAlive(descendantPid)).toBe(true);

      await expect(pendingError).resolves.toMatchObject({
        code: 'PLUGIN_REQUEST_TIMEOUT',
      });
      expect(host.state).toBe('failed');
      await host.dispose();
      expect(await waitUntil(() => !processIsAlive(descendantPid), 3_000)).toBe(
        true,
      );
      await new Promise((resolveWait) => setTimeout(resolveWait, 2_500));
      expect(existsSync(markerPath)).toBe(false);
    },
  );

  it('terminates the process when AbortSignal cancels a request', async () => {
    const root = temporaryProject();
    const host = createActionHost(root);
    const controller = new AbortController();
    const pending = host.executeAction(
      { mode: 'hang' },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({
      code: 'PLUGIN_REQUEST_ABORTED',
    });
    expect(host.state).toBe('failed');
  });

  it('checks permissions before spawn and dispatches only by plugin kind', async () => {
    const root = temporaryProject();
    expect(
      () =>
        new ExternalPluginHost(actionManifest(), {
          projectRoot: root,
          capabilities: REQUIRES,
          grantedPermissions: [],
        }),
    ).toThrow(/did not grant/);

    const provider = new ExternalPluginHost(providerManifest(), {
      projectRoot: root,
      capabilities: REQUIRES,
      grantedPermissions: ['device:read'],
    });
    activeHosts.push(provider);
    await expect(
      provider.executeAction({ mode: 'echo' }),
    ).rejects.toMatchObject({ code: 'PLUGIN_KIND_MISMATCH' });
    const result = await provider.collect({ mode: 'echo' });
    expect(result).toMatchObject({ params: { mode: 'echo' } });
  });
});
