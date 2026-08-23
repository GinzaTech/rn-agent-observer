import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  AssuranceFinding,
  EvidenceEnvelope,
  Session,
  TargetFingerprint,
} from '@rn-agent-observer/schemas';
import {
  DASHBOARD_CONTENT_SECURITY_POLICY,
  buildDashboardReport,
  loadDashboardRunMetadata,
  renderOfflineDashboard,
  summarizeDashboardRun,
  writeOfflineDashboard,
  type DashboardRunInput,
} from './report.js';

const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

const target = (
  overrides: Partial<TargetFingerprint> = {},
): TargetFingerprint => ({
  platform: 'android',
  deviceId: 'emulator-5554',
  appId: 'dev.rnagentobserver.private-app',
  appVersion: '1.0.0',
  buildId: 'private-build-id',
  sourceRevision: 'revision-a',
  operatingSystem: 'Android 16',
  architecture: 'arm64-v8a',
  reactNativeVersion: '0.86.2',
  expoVersion: '57.0.0',
  hermesVersion: '1.0',
  deviceClass: 'emulator-medium',
  ...overrides,
});

const session = (
  id: string,
  startedAt = '2026-08-22T00:00:00.000Z',
): Session => ({
  schemaVersion: '1.0',
  id,
  projectRoot: `C:\\Users\\private\\${secret}`,
  startedAt,
  stoppedAt: new Date(new Date(startedAt).getTime() + 1_000).toISOString(),
  status: 'complete',
  artifactIds: ['private-artifact-id'],
  artifacts: [
    {
      id: 'private-artifact-id',
      kind: 'screenshot',
      path: `C:\\private\\${secret}.png`,
      mimeType: 'image/png',
      createdAt: startedAt,
    },
  ],
  timeline: [
    {
      schemaVersion: '1.0',
      id: 1,
      type: 'tap',
      timestamp: startedAt,
      data: { authorization: `Bearer ${secret}` },
    },
    {
      schemaVersion: '1.0',
      id: 2,
      type: `password=${secret}`,
      timestamp: startedAt,
      data: { payload: secret },
    },
  ],
});

const evidence = (
  runTarget: TargetFingerprint = target(),
): EvidenceEnvelope => ({
  schemaVersion: '1.0',
  id: `evidence-${secret}`,
  runId: `run-${secret}`,
  kind: `private-kind-${secret}`,
  capturedAt: '2026-08-22T00:00:00.000Z',
  provider: { id: `provider-${secret}`, version: '1.0.0' },
  target: runTarget,
  availability: { status: 'AVAILABLE' },
  classification: 'sensitive',
  payload: {
    password: secret,
    image: `data:image/png;base64,${secret}`,
  },
  references: [],
});

const finding: AssuranceFinding = {
  schemaVersion: '1.0',
  id: `finding-${secret}`,
  ruleId: `private-rule-${secret}`,
  title: `Private finding ${secret}`,
  description: `Password is ${secret}`,
  outcome: 'FAIL',
  severity: 'high',
  confidence: 0.9,
  category: 'security',
  controls: [],
  evidence: [],
  source: { file: `C:\\private\\${secret}.tsx`, line: 1 },
  remediation: `Rotate ${secret}`,
  limitations: [],
};

const run = (
  id: string,
  startedAt: string,
  metricValue: number,
  runTarget: TargetFingerprint = target(),
): DashboardRunInput => ({
  session: session(id, startedAt),
  target: runTarget,
  metrics: [
    {
      metric: 'frame_time_ms',
      unit: 'ms',
      statistic: 'p95',
      value: metricValue,
      available: true,
      timestamp: startedAt,
    },
  ],
});

describe('offline dashboard report', () => {
  it('reduces sensitive session and evidence objects to allowlisted metadata', () => {
    const summary = summarizeDashboardRun({
      session: session(secret),
      target: target(),
      evidence: [evidence()],
      findings: [finding],
      metrics: [
        {
          metric: `private_metric_${secret}`,
          unit: 'secret-unit',
          value: 42,
          available: true,
          timestamp: '2026-08-22T00:00:00.000Z',
        },
        {
          metric: 'memory_mb',
          unit: 'MB',
          value: 512,
          available: true,
          timestamp: '2026-08-22T00:00:00.000Z',
        },
      ],
    });
    const serialized = JSON.stringify(summary);

    expect(summary.runRef).toMatch(/^run-[a-f0-9]{16}$/u);
    expect(summary.eventTypes).toEqual([
      { type: 'other', count: 1 },
      { type: 'tap', count: 1 },
    ]);
    expect(summary.omittedMetricCount).toBe(1);
    expect(summary.metrics).toHaveLength(1);
    expect(summary.evidenceClassification.sensitive).toBe(1);
    expect(summary.findingSeverities.high).toBe(1);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('private-artifact-id');
    expect(serialized).not.toContain('private-app');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('data:image');
  });

  it('renders self-contained HTML with strict CSP and no active or encoded resources', () => {
    const report = buildDashboardReport(
      [
        {
          session: session(secret),
          target: target(),
          evidence: [evidence()],
          findings: [finding],
        },
      ],
      { generatedAt: '2026-08-22T00:00:02.000Z' },
    );
    const html = renderOfflineDashboard(report);

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('default-src &#39;none&#39;');
    expect(DASHBOARD_CONTENT_SECURITY_POLICY).toContain("script-src 'none'");
    expect(html).not.toMatch(/<script\b|<style\b|<img\b|<iframe\b/iu);
    expect(html).not.toMatch(/data:|file:\/\/|base64/iu);
    expect(html).not.toContain(secret);
    expect(html).not.toContain('private-artifact-id');
    expect(html).not.toContain('private-app');
    expect(html).not.toContain('C:\\');
  });

  it('revalidates a report model instead of rendering injected extra fields', () => {
    const report = buildDashboardReport([
      run('first', '2026-08-22T00:00:00.000Z', 10),
    ]);
    Object.assign(report, { limitations: [secret] });
    Object.assign(report.trend, { privateReason: secret });
    Object.assign(report.runs[0]?.evidenceAvailability ?? {}, {
      [secret]: 0,
    });

    expect(renderOfflineDashboard(report)).not.toContain(secret);
  });

  it('calculates trends only for compatible comparison fingerprints', () => {
    const first = run(
      'first',
      '2026-08-22T00:00:00.000Z',
      10,
      target({ appVersion: '1.0.0', sourceRevision: 'revision-a' }),
    );
    const second = run(
      'second',
      '2026-08-22T00:01:00.000Z',
      12,
      target({ appVersion: '1.1.0', sourceRevision: 'revision-b' }),
    );
    const compatible = buildDashboardReport([first, second], {
      generatedAt: '2026-08-22T00:02:00.000Z',
    });
    const incompatible = buildDashboardReport([
      first,
      {
        ...second,
        target: target({ deviceId: 'different-device' }),
      },
    ]);

    expect(compatible.trend.status).toBe('COMPATIBLE');
    expect(compatible.trend.series).toEqual([
      expect.objectContaining({
        metric: 'frame_time_ms',
        statistic: 'p95',
        absoluteChange: 2,
        percentChange: 20,
        direction: 'higher',
      }),
    ]);
    expect(compatible.runs[0]?.target?.fingerprint).not.toBe(
      compatible.runs[1]?.target?.fingerprint,
    );
    expect(compatible.runs[0]?.target?.comparisonFingerprint).toBe(
      compatible.runs[1]?.target?.comparisonFingerprint,
    );
    expect(incompatible.trend).toEqual({
      status: 'INCOMPATIBLE_FINGERPRINTS',
      series: [],
    });
  });

  it('returns NOT_VERIFIED for missing or internally mixed targets', () => {
    const missing = buildDashboardReport([
      { session: session('one') },
      { session: session('two', '2026-08-22T00:01:00.000Z') },
    ]);
    const mixed = buildDashboardReport([
      {
        session: session('one'),
        target: target(),
        evidence: [evidence(target({ deviceId: 'different-device' }))],
      },
      run('two', '2026-08-22T00:01:00.000Z', 10),
    ]);
    const activeSession = session('active', '2026-08-22T00:01:00.000Z');
    delete activeSession.stoppedAt;
    activeSession.status = 'active';
    const incomplete = buildDashboardReport([
      run('one', '2026-08-22T00:00:00.000Z', 10),
      {
        session: activeSession,
        target: target(),
        metrics: [
          {
            metric: 'frame_time_ms',
            unit: 'ms',
            statistic: 'p95',
            value: 11,
            available: true,
            timestamp: '2026-08-22T00:01:00.000Z',
          },
        ],
      },
    ]);

    expect(missing.trend.status).toBe('NOT_VERIFIED');
    expect(missing.trend.series).toEqual([]);
    expect(mixed.trend.status).toBe('INCOMPATIBLE_FINGERPRINTS');
    expect(mixed.trend.series).toEqual([]);
    expect(incomplete.trend.status).toBe('NOT_VERIFIED');
    expect(incomplete.trend.series).toEqual([]);
  });

  it('rejects a session whose stop time precedes its start time', () => {
    const invalid = session('invalid');
    invalid.stoppedAt = '2026-08-21T23:59:59.000Z';

    expect(() => summarizeDashboardRun({ session: invalid })).toThrow(
      'cannot precede',
    );
  });

  it('loads bounded JSON only through contained real paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rn-observer-dashboard-'));
    const outside = await mkdtemp(
      join(tmpdir(), 'rn-observer-dashboard-outside-'),
    );
    try {
      await mkdir(join(directory, 'metadata'));
      const input: DashboardRunInput = {
        session: session(secret),
        target: target(),
        evidence: [evidence()],
      };
      await writeFile(
        join(directory, 'metadata', 'run.json'),
        JSON.stringify(input),
        'utf8',
      );
      await writeFile(
        join(outside, 'outside.json'),
        JSON.stringify(input),
        'utf8',
      );
      await symlink(
        outside,
        join(directory, 'escape-link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const loaded = await loadDashboardRunMetadata({
        root: directory,
        relativePath: 'metadata/run.json',
      });
      expect(JSON.stringify(loaded)).not.toContain(secret);
      await expect(
        loadDashboardRunMetadata({
          root: directory,
          relativePath: '../outside.json',
        }),
      ).rejects.toThrow(/within|escapes/u);
      await expect(
        loadDashboardRunMetadata({
          root: directory,
          relativePath: 'escape-link/outside.json',
        }),
      ).rejects.toThrow('outside');
      await expect(
        loadDashboardRunMetadata({
          root: directory,
          relativePath: 'metadata/run.json',
          maxBytes: 8,
        }),
      ).rejects.toThrow('safety limit');
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('writes a new HTML report inside the configured root without overwrite', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'rn-observer-dashboard-write-'),
    );
    const outside = await mkdtemp(
      join(tmpdir(), 'rn-observer-dashboard-write-out-'),
    );
    try {
      const report = buildDashboardReport([
        run('first', '2026-08-22T00:00:00.000Z', 10),
        run('second', '2026-08-22T00:01:00.000Z', 11),
      ]);
      const written = await writeOfflineDashboard({
        root: directory,
        relativePath: 'reports/index.html',
        report,
      });
      const html = await readFile(written.path, 'utf8');

      expect(written.sha256).toHaveLength(64);
      expect(written.bytes).toBe(Buffer.byteLength(html, 'utf8'));
      expect(html).toContain('RN Agent Observer local report');
      await expect(
        writeOfflineDashboard({
          root: directory,
          relativePath: 'reports/index.html',
          report,
        }),
      ).rejects.toMatchObject({ code: 'EEXIST' });
      await expect(
        writeOfflineDashboard({
          root: directory,
          relativePath: '../escape.html',
          report,
        }),
      ).rejects.toThrow(/within|escapes/u);

      await symlink(
        outside,
        join(directory, 'outside-link'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      await expect(
        writeOfflineDashboard({
          root: directory,
          relativePath: 'outside-link/report.html',
          report,
        }),
      ).rejects.toThrow('outside');
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
