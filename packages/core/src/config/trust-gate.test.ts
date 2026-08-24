import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObserverCore } from '../index.js';
import { loadObserverConfig } from './observer-config.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  delete process.env.RN_OBSERVER_TRUST_ACTIVE_CONFIG;
});

function activeConfig(): string {
  return JSON.stringify({
    schemaVersion: 1,
    target: {
      platform: 'android',
      mode: 'enhanced',
      appId: 'dev.example.app',
      deviceId: 'emulator-5554',
      metroUrl: 'http://127.0.0.1:8081',
    },
    packs: ['smoke'],
    budgets: {},
    artifacts: {
      root: '.artifacts',
      retentionDays: 14,
      classification: 'sensitive',
      hash: true,
      allowShare: false,
    },
    security: {
      mode: 'authorized-active',
      allowedActions: ['read', 'app-state'],
      allowedAppIds: ['dev.example.app'],
      allowNetworkInterception: false,
      allowSensitiveBodyCapture: false,
      allowPersistentPermissionChanges: false,
      allowedPersistentPermissions: [],
    },
  });
}

describe('active config trust gate', () => {
  it('loads an authorized-active config read-only but rejects its mutation without host trust', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rnobs-trust-'));
    roots.push(root);
    writeFileSync(join(root, '.rn-observer.json'), activeConfig());
    expect(loadObserverConfig(root).config.security.mode).toBe(
      'authorized-active',
    );
    const core = new ObserverCore({ projectRoot: root, onWarning: () => {} });
    await expect(core.appLaunch()).rejects.toMatchObject({
      code: 'ACTION_NOT_AUTHORIZED',
      suggestion: expect.stringContaining('RN_OBSERVER_TRUST_ACTIVE_CONFIG=1'),
    });
  });

  it('does not allow a config file to self-attest trusted state', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnobs-trust-'));
    roots.push(root);
    writeFileSync(
      join(root, '.rn-observer.json'),
      activeConfig().replace(
        '"allowedActions"',
        '"trusted": true, "allowedActions"',
      ),
    );
    expect(() => loadObserverConfig(root)).toThrow(/unknown keys: trusted/);
  });

  it('honors the session environment opt-in over the file flag', () => {
    const root = mkdtempSync(join(tmpdir(), 'rnobs-trust-'));
    roots.push(root);
    writeFileSync(join(root, '.rn-observer.json'), activeConfig());
    const core = new ObserverCore({
      projectRoot: root,
      trustActiveConfig: true,
      onWarning: () => {},
    });
    expect(core.config.security.mode).toBe('authorized-active');
  });
});
