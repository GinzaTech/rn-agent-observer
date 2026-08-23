import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObserverCore } from '../index.js';
import {
  OBSERVER_CONFIG_FILENAME,
  defaultObserverConfig,
} from './observer-config.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rn-observer-core-config-'));
  roots.push(root);
  const defaults = defaultObserverConfig();
  writeFileSync(
    join(root, OBSERVER_CONFIG_FILENAME),
    JSON.stringify({
      ...defaults,
      target: {
        ...defaults.target,
        appId: 'dev.config.app',
        deviceId: 'config-device',
      },
      artifacts: { ...defaults.artifacts, root: '.evidence' },
    }),
  );
  return root;
};

describe('ObserverCore project config integration', () => {
  it('uses project target and artifact configuration', () => {
    const projectRoot = fixture();
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });

    expect(core.configExists).toBe(true);
    expect(core.appId).toBe('dev.config.app');
    expect(core.adb.deviceId).toBe('config-device');
    expect(core.artifacts.root).toBe(resolve(projectRoot, '.evidence'));
  });

  it('keeps explicit constructor options above project configuration', () => {
    const projectRoot = fixture();
    const core = new ObserverCore({
      projectRoot,
      appId: 'dev.explicit.app',
      deviceId: 'explicit-device',
      artifactRoot: join(projectRoot, '.explicit-artifacts'),
      onWarning: () => {},
    });

    expect(core.appId).toBe('dev.explicit.app');
    expect(core.adb.deviceId).toBe('explicit-device');
    expect(core.artifacts.root).toBe(
      resolve(projectRoot, '.explicit-artifacts'),
    );
  });
});
