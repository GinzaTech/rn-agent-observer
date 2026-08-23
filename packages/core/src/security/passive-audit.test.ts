import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runPassiveSecurityAudit } from './passive-audit.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const fixture = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rn-observer-security-'));
  roots.push(root);
  const android = join(root, 'android', 'app', 'src', 'main');
  mkdirSync(join(android, 'res', 'xml'), { recursive: true });
  writeFileSync(
    join(android, 'AndroidManifest.xml'),
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
      <application android:debuggable="true" android:usesCleartextTraffic="true" android:allowBackup="false" android:networkSecurityConfig="@xml/network_security_config" />
    </manifest>`,
  );
  writeFileSync(
    join(android, 'res', 'xml', 'network_security_config.xml'),
    `<network-security-config><base-config cleartextTrafficPermitted="true"><trust-anchors><certificates src="user" /></trust-anchors></base-config></network-security-config>`,
  );
  mkdirSync(join(root, '.artifacts'), { recursive: true });
  writeFileSync(
    join(root, '.artifacts', 'device.log'),
    'Authorization: Bearer exampleBearerToken1234567890',
  );
  return root;
};

describe('passive project security audit', () => {
  it('combines manifest, network, and redacted artifact findings', () => {
    const root = fixture();
    const result = runPassiveSecurityAudit({
      projectRoot: root,
      fingerprintKey: 'test-scope',
      analyzedAt: '2026-08-22T00:00:00.000Z',
    });
    const serialized = JSON.stringify(result);

    expect(result.outcome).toBe('FAIL');
    expect(result.totals.files).toBe(3);
    expect(result.manifestAnalyses).toHaveLength(1);
    expect(result.networkSecurityAnalyses).toHaveLength(1);
    expect(result.secretScans).toHaveLength(1);
    expect(serialized).not.toContain('exampleBearerToken1234567890');
  });

  it('rejects explicit paths outside project scope', () => {
    const root = fixture();
    const outsidePath =
      process.platform === 'win32' ? '..\\outside.log' : '../outside.log';

    expect(() =>
      runPassiveSecurityAudit({
        projectRoot: root,
        textPaths: [outsidePath],
      }),
    ).toThrow(/within project root/u);
  });

  it('reports NOT_VERIFIED when no manifest is present', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-security-empty-'));
    roots.push(root);

    const result = runPassiveSecurityAudit({
      projectRoot: root,
      scanArtifacts: false,
    });

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId: 'security.android.manifest-missing',
        outcome: 'NOT_VERIFIED',
      }),
    );
  });
});
