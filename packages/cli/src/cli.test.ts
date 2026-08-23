import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObserverCore } from '@rn-agent-observer/core';
import { describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';

function capture(): {
  out: string[];
  err: string[];
  io: Parameters<typeof runCli>[1];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (value) => out.push(value),
      stderr: (value) => err.push(value),
    },
  };
}

describe('rn-observe CLI', () => {
  it('prints help', async () => {
    const result = capture();
    expect(await runCli(['--help'], result.io)).toBe(0);
    expect(result.out[0]).toContain('rn-observe 2.4.0');
    expect(result.out[0]).toContain('devtools-export');
    expect(result.out[0]).toContain('rn-observe status');
    expect(result.out[0]).toContain('metro-network');
    expect(result.out[0]).toContain('record start');
    expect(result.out[0]).toContain('snapshot');
    expect(result.out[0]).toContain('understand-screen');
    expect(result.out[0]).toContain('ui-model');
    expect(result.out[0]).toContain('replay run');
    expect(result.out[0]).toContain('doctor');
    expect(result.out[0]).toContain('init [--dry-run]');
    expect(result.out[0]).toContain('suite run');
    expect(result.out[0]).toContain('rn-observe ci');
    expect(result.out[0]).toContain('performance memory');
    expect(result.out[0]).toContain('plugin check');
    expect(result.out[0]).toContain(
      'performance experiment --scenario ID (--replay SCRIPT.json | --idle | --startup) [--samples N] [--warmup N] [--interval MS]',
    );
    expect(result.out[0]).toContain(
      'target collect --manifest MANIFEST.json --operation NAME --platform NAME [--device-id ID] [--app-id ID] [--grant PERMISSION] [--env NAME] [--cwd DIR] [--host-capability NAME] [--max-evidence N] [--max-payload-bytes N] [--strict]',
    );
    expect(result.out[0]).toContain('coverage analyze');
    expect(result.out[0]).toContain('session share');
    expect(result.out[0]).toContain('bundle verify');
    expect(result.out[0]).toContain('--confirm-persistent-permission');
  });

  it('prints structured status', async () => {
    const result = capture();
    expect(await runCli(['status'], result.io)).toBe(0);
    expect(JSON.parse(result.out[0] ?? '{}')).toMatchObject({
      phase: 'android-v1',
    });
    expect(JSON.parse(result.out[0] ?? '{}').implementedCommands).toEqual(
      expect.arrayContaining(['doctor', 'init', 'artifacts']),
    );
  });

  it('fails closed for mutating CLI commands while allowing read-only inspection', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-cli-policy-'));
    writeFileSync(
      join(projectRoot, '.rn-observer.json'),
      JSON.stringify({
        schemaVersion: 1,
        target: { appId: 'dev.rnagent.cli-policy' },
      }),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    vi.spyOn(core.adb, 'runtimePermissions').mockResolvedValue([]);
    try {
      const blocked = capture();
      expect(await runCli(['launch'], blocked.io, core)).toBe(2);
      expect(JSON.parse(blocked.err[0] ?? '{}')).toMatchObject({
        error: {
          code: 'ACTION_NOT_AUTHORIZED',
          recoverable: true,
        },
      });

      const readOnly = capture();
      expect(await runCli(['permissions'], readOnly.io, core)).toBe(0);
      expect(JSON.parse(readOnly.out[0] ?? '{}')).toEqual({
        appId: 'dev.rnagent.cli-policy',
        permissions: [],
      });
    } finally {
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('requires explicit confirmation before the CLI persists a permission change', async () => {
    const setPermission = vi.fn().mockResolvedValue({
      appId: 'dev.example.app',
      permission: 'android.permission.CAMERA',
      granted: true,
      previouslyGranted: false,
      verified: true,
      persistent: true,
    });
    const core = { setPermission } as unknown as ObserverCore;
    const blocked = capture();

    expect(
      await runCli(
        ['permissions', 'grant', '--perm', 'android.permission.CAMERA'],
        blocked.io,
        core,
      ),
    ).toBe(2);
    expect(blocked.err[0]).toContain('--confirm-persistent-permission');
    expect(setPermission).not.toHaveBeenCalled();

    const confirmed = capture();
    expect(
      await runCli(
        [
          'permissions',
          'grant',
          '--perm',
          'android.permission.CAMERA',
          '--confirm-persistent-permission',
        ],
        confirmed.io,
        core,
      ),
    ).toBe(0);
    expect(setPermission).toHaveBeenCalledWith(
      'android.permission.CAMERA',
      true,
      { confirmed: true },
    );
  });

  it('lists all built-in quality suites', async () => {
    const result = capture();

    expect(await runCli(['suite', 'list'], result.io)).toBe(0);
    expect(
      JSON.parse(result.out[0] ?? '{}').suites.map(
        (suite: { id: string }) => suite.id,
      ),
    ).toEqual([
      'smoke',
      'visual',
      'performance',
      'network',
      'accessibility',
      'security',
      'resilience',
    ]);
  });

  it('previews and initializes a safe project config', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-cli-init-'));
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const preview = capture();
      expect(await runCli(['init', '--dry-run'], preview.io, core)).toBe(0);
      expect(JSON.parse(preview.out[0] ?? '{}')).toMatchObject({
        dryRun: true,
        created: false,
      });
      expect(existsSync(join(projectRoot, '.rn-observer.json'))).toBe(false);

      const created = capture();
      expect(await runCli(['init'], created.io, core)).toBe(0);
      expect(JSON.parse(created.out[0] ?? '{}')).toMatchObject({
        created: true,
      });
      expect(existsSync(join(projectRoot, '.rn-observer.json'))).toBe(true);
    } finally {
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('checks provider manifests and reports multi-platform support without executing them', async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), 'rn-observer-cli-provider-'),
    );
    const manifestPath = join(projectRoot, 'ios-provider.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        manifestVersion: 1,
        apiVersion: 1,
        id: 'community.ios-provider',
        displayName: 'iOS provider',
        version: '1.0.0',
        kind: 'provider',
        capabilities: {
          provides: ['target.ios.screenshot'],
          requires: ['host.evidence-v1'],
        },
        permissions: ['device:read'],
        risk: 'read-only',
        execution: {
          mode: 'external-process',
          protocol: 'rn-agent-observer-plugin-jsonrpc-stdio-v1',
          command: 'node',
          args: ['provider.mjs'],
          shell: false,
          environmentAllowlist: [],
          requestTimeoutMs: 1_000,
          shutdownTimeoutMs: 500,
          maxMessageBytes: 65_536,
        },
      }),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const checked = capture();
      expect(
        await runCli(['plugin', 'check', manifestPath], checked.io, core),
      ).toBe(0);
      expect(JSON.parse(checked.out[0] ?? '{}')).toMatchObject({
        valid: true,
        plugin: { id: 'community.ios-provider', kind: 'provider' },
      });

      const support = capture();
      expect(
        await runCli(
          ['target', 'support', '--manifest', manifestPath],
          support.io,
          core,
        ),
      ).toBe(0);
      const platforms = JSON.parse(support.out[0] ?? '{}').platforms as Array<{
        platform: string;
        status: string;
      }>;
      expect(
        platforms.find((item) => item.platform === 'android')?.status,
      ).toBe('built-in');
      expect(platforms.find((item) => item.platform === 'ios')?.status).toBe(
        'extension-available',
      );
    } finally {
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('analyzes bounded coverage and shares/verifies a session only when project sharing is enabled', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-cli-share-'));
    const coveragePath = join(projectRoot, 'coverage.json');
    writeFileSync(
      join(projectRoot, '.rn-observer.json'),
      JSON.stringify({
        schemaVersion: 1,
        target: {},
        artifacts: { allowShare: true },
      }),
    );
    writeFileSync(
      coveragePath,
      JSON.stringify({
        target: {
          platform: 'android',
          deviceId: 'emulator-5554',
          appId: 'dev.rnagent.coverage',
        },
        inventory: {
          routes: [
            {
              id: 'home',
              observable: true,
              actions: [{ id: 'home.search', observable: true }],
            },
          ],
        },
        checkpoints: [
          {
            routeId: 'home',
            interactions: [{ routeId: 'home', actionId: 'home.search' }],
          },
        ],
        threshold: {
          minimumCoverageRatio: 1,
          minimumObservableItems: 2,
          minimumEvidence: 2,
        },
      }),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const coverage = capture();
      expect(
        await runCli(['coverage', 'analyze', coveragePath], coverage.io, core),
      ).toBe(0);
      expect(JSON.parse(coverage.out[0] ?? '{}')).toMatchObject({
        result: { outcome: 'PASS' },
        artifact: { kind: 'coverage-report' },
      });

      const session = core.startSession();
      const share = capture();
      expect(
        await runCli(
          ['session', 'share', session.id, '--output', 'shares/cli-test.rnobs'],
          share.io,
          core,
        ),
      ).toBe(0);
      const shared = JSON.parse(share.out[0] ?? '{}');
      expect(shared).toMatchObject({
        bundle: { outcome: 'PASS' },
        artifact: { kind: 'share-bundle' },
      });
      expect(existsSync(shared.bundle.path)).toBe(true);

      const verify = capture();
      expect(
        await runCli(['bundle', 'verify', shared.bundle.path], verify.io, core),
      ).toBe(0);
      expect(JSON.parse(verify.out[0] ?? '{}')).toMatchObject({
        valid: true,
        sessionId: session.id,
      });
    } finally {
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('parses bounded active-security scenarios before delegating to core', async () => {
    const runMalformedDeepLinkSecurityScenario = vi.fn().mockResolvedValue({
      result: { outcome: 'PASS' },
      artifact: { id: 'security-report-1', kind: 'security-report' },
    });
    const runPermissionTransitionSecurityScenario = vi.fn().mockResolvedValue({
      result: { outcome: 'PASS' },
      artifact: { id: 'security-report-2', kind: 'security-report' },
    });
    const core = {
      appId: 'dev.example.safe',
      runMalformedDeepLinkSecurityScenario,
      runPermissionTransitionSecurityScenario,
    } as unknown as ObserverCore;
    const result = capture();

    expect(
      await runCli(
        [
          'security',
          'active',
          'deep-link',
          '--scenario',
          'safe-query-mutation',
          '--base-uri',
          'devexample://catalog',
          '--probe',
          'empty:empty-value:q',
          '--allow-state',
          'content',
          '--max-errors',
          '0',
        ],
        result.io,
        core,
      ),
    ).toBe(0);
    expect(runMalformedDeepLinkSecurityScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: 'safe-query-mutation',
        appId: 'dev.example.safe',
        risk: 'app-state',
        ownership: 'owned',
        baseUri: 'devexample://catalog',
        probes: [{ id: 'empty', mutation: 'empty-value', parameter: 'q' }],
        allowedScreenStates: ['content'],
        maximumErrorLogs: 0,
      }),
      undefined,
    );

    const permission = capture();
    expect(
      await runCli(
        [
          'security',
          'active',
          'permission',
          '--scenario',
          'camera-transition',
          '--permission',
          'android.permission.CAMERA',
          '--probe',
          'revoke:revoke',
          '--allow-state',
          'content',
        ],
        permission.io,
        core,
      ),
    ).toBe(0);
    expect(runPermissionTransitionSecurityScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: 'camera-transition',
        permission: 'android.permission.CAMERA',
        risk: 'device-state',
        probes: [
          expect.objectContaining({
            id: 'revoke',
            granted: false,
            allowedScreenStates: ['content'],
          }),
        ],
      }),
      undefined,
    );
  });

  it('runs a JSON suite and writes selected reports', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-cli-suite-'));
    const suitePath = join(projectRoot, 'smoke.json');
    const outputDirectory = join(projectRoot, 'reports');
    writeFileSync(
      suitePath,
      JSON.stringify({
        apiVersion: 'rn-observer/v1alpha1',
        kind: 'Suite',
        metadata: { id: 'community.status', name: 'Status suite' },
        steps: [
          {
            id: 'status',
            title: 'Read observer status',
            action: { command: 'status' },
          },
        ],
      }),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const captured = capture();
      expect(
        await runCli(
          [
            'suite',
            'run',
            suitePath,
            '--reporter',
            'json,html',
            '--output',
            outputDirectory,
          ],
          captured.io,
          core,
        ),
      ).toBe(0);
      const result = JSON.parse(captured.out[0] ?? '{}');
      expect(result.result).toMatchObject({
        suiteId: 'community.status',
        outcome: 'PASS',
      });
      expect(result.reports).toHaveLength(2);
      expect(
        result.reports.every((report: { path: string }) =>
          existsSync(report.path),
        ),
      ).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('runs the CI entry point and treats a cancelled run as exit 130', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-cli-ci-'));
    const suitePath = join(projectRoot, 'status.json');
    writeFileSync(
      suitePath,
      JSON.stringify({
        apiVersion: 'rn-observer/v1alpha1',
        kind: 'Suite',
        metadata: { id: 'community.ci', name: 'CI fixture' },
        steps: [
          {
            id: 'status',
            title: 'Read observer status',
            action: { command: 'status' },
          },
        ],
      }),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const passing = capture();
      expect(
        await runCli(
          ['ci', '--suite', suitePath, '--reporter', 'json'],
          passing.io,
          core,
        ),
      ).toBe(0);
      expect(JSON.parse(passing.out[0] ?? '{}').summary).toMatchObject({
        requested: 1,
        completed: 1,
        outcomes: { PASS: 1 },
      });

      const cancelled = capture();
      const controller = new AbortController();
      controller.abort();
      expect(
        await runCli(
          ['ci', '--suite', suitePath, '--reporter', 'json'],
          cancelled.io,
          core,
          { signal: controller.signal },
        ),
      ).toBe(130);
      expect(JSON.parse(cancelled.out[0] ?? '{}').summary).toMatchObject({
        requested: 1,
        completed: 0,
        cancelled: true,
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('returns a failing exit code for passive security findings', async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), 'rn-observer-cli-security-'),
    );
    const manifestDirectory = join(
      projectRoot,
      'android',
      'app',
      'src',
      'main',
    );
    mkdirSync(manifestDirectory, { recursive: true });
    writeFileSync(
      join(manifestDirectory, 'AndroidManifest.xml'),
      `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:debuggable="true" android:usesCleartextTraffic="true" android:allowBackup="false" /></manifest>`,
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const captured = capture();
      expect(
        await runCli(
          ['security', 'audit', '--no-artifacts'],
          captured.io,
          core,
        ),
      ).toBe(1);
      expect(JSON.parse(captured.out[0] ?? '{}')).toMatchObject({
        analyzer: 'passive-security-audit',
        outcome: 'FAIL',
      });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('writes a bounded CycloneDX SBOM without contacting a remote service', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-cli-sbom-'));
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'fixture', version: '1.0.0' }),
    );
    writeFileSync(
      join(projectRoot, 'pnpm-lock.yaml'),
      `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      alpha:
        specifier: 1.0.0
        version: 1.0.0
packages:
  alpha@1.0.0:
    resolution: {integrity: sha256-YWJj}
snapshots:
  alpha@1.0.0: {}
`,
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const captured = capture();
      expect(await runCli(['security', 'sbom'], captured.io, core)).toBe(0);
      const result = JSON.parse(captured.out[0] ?? '{}');
      expect(result.inventory).toMatchObject({
        analyzer: 'pnpm-cyclonedx-inventory',
        componentCount: 1,
      });
      expect(existsSync(result.artifact.path)).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('builds an offline aggregate dashboard inside the artifact root', async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), 'rn-observer-cli-dashboard-'),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    try {
      const captured = capture();
      expect(
        await runCli(
          ['dashboard', 'build', '--output', 'dashboard/test.html'],
          captured.io,
          core,
        ),
      ).toBe(0);
      const result = JSON.parse(captured.out[0] ?? '{}');
      expect(result.report).toMatchObject({
        schemaVersion: '1.0',
        runs: [],
      });
      expect(existsSync(result.artifact.path)).toBe(true);
    } finally {
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails explicitly for unknown commands', async () => {
    const result = capture();
    expect(await runCli(['unknown'], result.io)).toBe(2);
    expect(result.err[0]).toContain('INTERNAL_ERROR');
  });
});
