import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  OBSERVER_CONFIG_FILENAME,
  authorizePersistentPermissionChange,
  authorizeSecurityAction,
  defaultObserverConfig,
  initObserverConfig,
  loadObserverConfig,
  parseObserverConfig,
  resolveArtifactRoot,
} from './observer-config.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'rn-observer-config-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createDirectoryLink(target: string, path: string): boolean {
  try {
    symlinkSync(
      target,
      path,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw error;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('observer project config', () => {
  it('defaults to fail-closed local evidence collection', () => {
    const config = defaultObserverConfig();

    expect(config.schemaVersion).toBe(1);
    expect(config.$schema).toContain('rn-observer.schema.json');
    expect(config.packs).toEqual(['smoke']);
    expect(config.artifacts.classification).toBe('sensitive');
    expect(config.artifacts.hash).toBe(true);
    expect(config.artifacts.allowShare).toBe(false);
    expect(config.security).toEqual({
      mode: 'read-only',
      allowedActions: ['read'],
      allowedAppIds: [],
      allowNetworkInterception: false,
      allowSensitiveBodyCapture: false,
      allowPersistentPermissionChanges: false,
      allowedPersistentPermissions: [],
    });
  });

  it('parses an explicitly authorized active policy', () => {
    const config = parseObserverConfig({
      schemaVersion: 1,
      target: {
        platform: 'android',
        mode: 'enhanced',
        appId: 'dev.example.app',
        deviceId: 'emulator-5554',
        metroUrl: 'http://127.0.0.1:8082',
      },
      packs: ['smoke', 'security', 'performance'],
      budgets: { uiFpsMin: 55, coldStartMaxMs: 2500 },
      artifacts: { retentionDays: 7 },
      security: {
        mode: 'authorized-active',
        allowedActions: ['read', 'app-state', 'network-interception'],
        allowedAppIds: ['dev.example.app'],
        allowNetworkInterception: true,
      },
    });

    expect(config.target.appId).toBe('dev.example.app');
    expect(config.target.mode).toBe('enhanced');
    expect(config.packs).toEqual(['smoke', 'security', 'performance']);
    expect(config.budgets.uiFpsMin).toBe(55);
    expect(config.artifacts.retentionDays).toBe(7);
    expect(
      authorizeSecurityAction(
        config,
        'network-interception',
        'dev.example.app',
        'emulator-5554',
      ),
    ).toMatchObject({ allowed: true });
  });

  it('binds active authorization to the exact configured ADB device', () => {
    const config = parseObserverConfig({
      schemaVersion: 1,
      target: {
        appId: 'dev.example.app',
        deviceId: 'emulator-5554',
      },
      security: {
        mode: 'authorized-active',
        allowedActions: ['read', 'app-state'],
        allowedAppIds: ['dev.example.app'],
      },
    });

    expect(
      authorizeSecurityAction(
        config,
        'app-state',
        'dev.example.app',
        'emulator-5554',
      ),
    ).toMatchObject({ allowed: true });
    expect(
      authorizeSecurityAction(
        config,
        'app-state',
        'dev.example.app',
        'emulator-5556',
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('config.target.deviceId'),
    });
    expect(
      authorizeSecurityAction(config, 'app-state', 'dev.example.app'),
    ).toMatchObject({ allowed: false });

    const withoutConfiguredDevice = parseObserverConfig({
      schemaVersion: 1,
      target: { appId: 'dev.example.app' },
      security: {
        mode: 'authorized-active',
        allowedActions: ['read', 'app-state'],
        allowedAppIds: ['dev.example.app'],
      },
    });
    expect(
      authorizeSecurityAction(
        withoutConfiguredDevice,
        'app-state',
        'dev.example.app',
        'emulator-5554',
      ),
    ).toMatchObject({ allowed: false });
  });

  it('requires a dedicated opt-in and exact allowlist for persistent permission changes', () => {
    const config = parseObserverConfig({
      schemaVersion: 1,
      target: {
        appId: 'dev.example.app',
        deviceId: 'emulator-5554',
      },
      security: {
        mode: 'authorized-active',
        allowedActions: ['read', 'persistent-permission'],
        allowedAppIds: ['dev.example.app'],
        allowPersistentPermissionChanges: true,
        allowedPersistentPermissions: ['android.permission.CAMERA'],
      },
    });

    expect(
      authorizePersistentPermissionChange(
        config,
        'android.permission.CAMERA',
        'dev.example.app',
        'emulator-5554',
      ),
    ).toMatchObject({ allowed: true, risk: 'persistent-permission' });
    expect(
      authorizePersistentPermissionChange(
        config,
        'android.permission.RECORD_AUDIO',
        'dev.example.app',
        'emulator-5554',
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('allowlisted'),
    });
    expect(
      authorizePersistentPermissionChange(
        config,
        'android.permission.CAMERA',
        'dev.example.app',
        'emulator-5556',
      ),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('config.target.deviceId'),
    });
  });

  it('rejects unknown fields and unsafe policy combinations', () => {
    expect(() =>
      parseObserverConfig({
        schemaVersion: 1,
        target: {},
        packs: ['smoke'],
        unexpected: true,
      }),
    ).toThrow(/unknown keys/i);

    expect(() =>
      parseObserverConfig({
        schemaVersion: 1,
        target: {},
        packs: ['security'],
        security: {
          mode: 'authorized-active',
          allowedActions: ['read', 'app-state'],
          allowedAppIds: [],
        },
      }),
    ).toThrow(/allowedAppId/i);

    expect(() =>
      parseObserverConfig({
        schemaVersion: 1,
        target: {},
        packs: ['security'],
        security: {
          mode: 'read-only',
          allowedActions: ['read', 'app-state'],
        },
      }),
    ).toThrow(/read-only/i);

    expect(() =>
      parseObserverConfig({
        schemaVersion: 1,
        target: {},
        packs: ['smoke'],
        artifacts: { hash: false },
      }),
    ).toThrow(/hash must remain true/i);

    expect(() =>
      parseObserverConfig({
        schemaVersion: 1,
        target: { appId: 'dev.example.app', deviceId: 'emulator-5554' },
        security: {
          mode: 'authorized-active',
          allowedActions: ['read', 'device-state'],
          allowedAppIds: ['dev.example.app'],
          allowPersistentPermissionChanges: true,
          allowedPersistentPermissions: ['android.permission.CAMERA'],
        },
      }),
    ).toThrow(/persistent-permission/i);

    expect(() =>
      parseObserverConfig({
        schemaVersion: 1,
        target: { appId: 'dev.example.app', deviceId: 'emulator-5554' },
        security: {
          mode: 'authorized-active',
          allowedActions: ['read', 'persistent-permission'],
          allowedAppIds: ['dev.example.app'],
          allowPersistentPermissionChanges: false,
          allowedPersistentPermissions: ['android.permission.CAMERA'],
        },
      }),
    ).toThrow(/allowPersistentPermissionChanges=true/i);
  });

  it('loads safe defaults when no project config exists', () => {
    const projectRoot = temporaryDirectory();
    const result = loadObserverConfig(projectRoot);

    expect(result.exists).toBe(false);
    expect(result.path).toBe(join(projectRoot, OBSERVER_CONFIG_FILENAME));
    expect(result.config.security.mode).toBe('read-only');
  });

  it('supports dry-run and idempotent initialization', () => {
    const projectRoot = temporaryDirectory();
    const path = join(projectRoot, OBSERVER_CONFIG_FILENAME);

    const preview = initObserverConfig(projectRoot, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.created).toBe(false);
    expect(existsSync(path)).toBe(false);

    const created = initObserverConfig(projectRoot);
    expect(created.created).toBe(true);
    expect(existsSync(path)).toBe(true);
    expect(loadObserverConfig(projectRoot).exists).toBe(true);

    const repeated = initObserverConfig(projectRoot);
    expect(repeated.created).toBe(false);
  });

  it('keeps artifacts inside the target project', () => {
    const projectRoot = temporaryDirectory();
    const config = defaultObserverConfig();
    expect(resolveArtifactRoot(projectRoot, config)).toBe(
      join(projectRoot, '.artifacts'),
    );

    expect(() =>
      resolveArtifactRoot(projectRoot, {
        ...config,
        artifacts: { ...config.artifacts, root: '..' },
      }),
    ).toThrow(/within projectRoot/i);
  });

  it('allows a missing artifact directory when its existing parent is in-project', () => {
    const projectRoot = temporaryDirectory();
    const config = defaultObserverConfig();
    const artifactRoot = join(projectRoot, '.evidence', 'next-run');

    expect(
      resolveArtifactRoot(projectRoot, {
        ...config,
        artifacts: { ...config.artifacts, root: '.evidence/next-run' },
      }),
    ).toBe(artifactRoot);
    expect(existsSync(artifactRoot)).toBe(false);
  });

  it('rejects artifact roots that escape via an existing directory link', () => {
    const projectRoot = temporaryDirectory();
    const outside = temporaryDirectory();
    const link = join(projectRoot, 'linked-artifacts');
    if (!createDirectoryLink(outside, link)) return;
    const config = defaultObserverConfig();

    expect(() =>
      resolveArtifactRoot(projectRoot, {
        ...config,
        artifacts: {
          ...config.artifacts,
          root: 'linked-artifacts/future-run',
        },
      }),
    ).toThrow(/after resolving symlinks/i);
  });

  it('denies active actions unless mode, app and risk are all allowlisted', () => {
    const config = defaultObserverConfig();

    expect(authorizeSecurityAction(config, 'read')).toMatchObject({
      allowed: true,
    });
    expect(
      authorizeSecurityAction(config, 'app-state', 'dev.example.app'),
    ).toMatchObject({ allowed: false });
  });
});
