import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXTERNAL_PLUGIN_PROTOCOL } from './manifest.js';
import { loadPluginManifestFile } from './file-loader.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const root = (): string => {
  const value = mkdtempSync(join(tmpdir(), 'rnobs-plugin-manifest-'));
  roots.push(value);
  return value;
};

const manifest = () => ({
  manifestVersion: 1,
  apiVersion: 1,
  id: 'community.web-provider',
  displayName: 'Web provider',
  version: '1.0.0',
  kind: 'provider',
  capabilities: {
    provides: ['target.web.logs'],
    requires: ['host.evidence-v1'],
  },
  permissions: ['device:read'],
  risk: 'read-only',
  execution: {
    mode: 'external-process',
    protocol: EXTERNAL_PLUGIN_PROTOCOL,
    command: 'node',
    args: ['provider.mjs'],
    shell: false,
    environmentAllowlist: [],
    requestTimeoutMs: 1_000,
    shutdownTimeoutMs: 500,
    maxMessageBytes: 65_536,
  },
});

describe('plugin manifest file loader', () => {
  it('loads and hashes a contained bounded manifest', () => {
    const projectRoot = root();
    const directory = join(projectRoot, 'plugins');
    mkdirSync(directory);
    writeFileSync(join(directory, 'web.json'), JSON.stringify(manifest()));

    const loaded = loadPluginManifestFile(projectRoot, 'plugins/web.json');

    expect(loaded.manifest).toMatchObject({
      id: 'community.web-provider',
      kind: 'provider',
    });
    expect(loaded.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects traversal and symlink escapes', () => {
    const projectRoot = root();
    const outside = root();
    const outsideManifest = join(outside, 'outside.json');
    writeFileSync(outsideManifest, JSON.stringify(manifest()));

    expect(() => loadPluginManifestFile(projectRoot, outsideManifest)).toThrow(
      'inside projectRoot',
    );

    const link = join(projectRoot, 'linked.json');
    symlinkSync(outsideManifest, link, 'file');
    expect(() => loadPluginManifestFile(projectRoot, link)).toThrow(
      'inside projectRoot',
    );
  });

  it('rejects oversized and malformed JSON before execution', () => {
    const projectRoot = root();
    writeFileSync(join(projectRoot, 'oversized.json'), 'x'.repeat(100));
    expect(() =>
      loadPluginManifestFile(projectRoot, 'oversized.json', { maxBytes: 50 }),
    ).toThrow('limit is 50');

    writeFileSync(join(projectRoot, 'invalid.json'), '{');
    expect(() => loadPluginManifestFile(projectRoot, 'invalid.json')).toThrow(
      'valid JSON',
    );
  });
});
