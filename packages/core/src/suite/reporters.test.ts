import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SuiteRunResultSchema,
  type SuiteReporter,
  type SuiteRunResult,
} from '@rn-agent-observer/schemas';
import { renderSuiteReport, writeSuiteReports } from './reporters.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const makeResult = (): SuiteRunResult =>
  SuiteRunResultSchema.parse({
    schemaVersion: '1.0',
    id: 'run-1',
    suiteId: 'community.smoke',
    startedAt: '2026-08-22T00:00:00.000Z',
    finishedAt: '2026-08-22T00:00:01.000Z',
    outcome: 'FAIL',
    target: {
      platform: 'android',
      deviceId: 'emulator-5554',
      appId: 'dev.rnagentobserver.demo',
    },
    capabilities: ['screen-understanding'],
    steps: [
      {
        id: 'screen',
        title: 'Inspect <script>alert(1)</script>',
        outcome: 'FAIL',
        attempts: 1,
        startedAt: '2026-08-22T00:00:00.000Z',
        finishedAt: '2026-08-22T00:00:00.100Z',
        durationMs: 100,
        reason: 'Expected content & received error',
      },
      {
        id: 'js-fps',
        title: 'Measure JS FPS',
        outcome: 'NOT_VERIFIED',
        attempts: 0,
        startedAt: '2026-08-22T00:00:00.100Z',
        finishedAt: '2026-08-22T00:00:00.100Z',
        durationMs: 0,
        reason: 'Metric unavailable from ADB',
      },
    ],
    cleanup: [],
    findings: [
      {
        schemaVersion: '1.0',
        id: 'finding-1',
        ruleId: 'security.debuggable',
        title: 'Debuggable release',
        description: 'The release manifest enables debugging.',
        outcome: 'FAIL',
        severity: 'high',
        confidence: 1,
        category: 'security',
        source: { file: 'android/app/src/main/AndroidManifest.xml', line: 7 },
      },
    ],
  });

describe('suite reporters', () => {
  it('renders machine-readable JSON and JUnit outcomes', () => {
    const run = makeResult();
    const json = renderSuiteReport(run, 'json');
    const junit = renderSuiteReport(run, 'junit');

    expect(JSON.parse(json.content)).toMatchObject({ id: 'run-1' });
    expect(junit.content).toContain('failures="1"');
    expect(junit.content).toContain('skipped="1"');
    expect(junit.content).toContain('Expected content &amp; received error');
  });

  it('renders SARIF with source locations and policy outcomes', () => {
    const sarif = JSON.parse(renderSuiteReport(makeResult(), 'sarif').content);

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.runs[0].results[0]).toMatchObject({
      ruleId: 'security.debuggable',
      level: 'error',
      properties: { outcome: 'FAIL' },
    });
    expect(
      sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation
        .uri,
    ).toBe('android/app/src/main/AndroidManifest.xml');
  });

  it('produces a static CSP-protected HTML report with escaped content', () => {
    const html = renderSuiteReport(makeResult(), 'html').content;

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('writes each requested reporter with a content hash', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rn-observer-report-'));
    temporaryDirectories.push(directory);
    const reporters: SuiteReporter[] = [
      'json',
      'junit',
      'sarif',
      'html',
      'github',
    ];

    const written = await writeSuiteReports(makeResult(), {
      outputDirectory: directory,
      reporters,
      basename: '../unsafe name',
    });

    expect(written).toHaveLength(5);
    expect(written.every((report) => report.sha256.length === 64)).toBe(true);
    expect(written.every((report) => report.path.startsWith(directory))).toBe(
      true,
    );
    expect(
      JSON.parse(
        await readFile(
          written.find((report) => report.reporter === 'json')?.path ?? '',
          'utf8',
        ),
      ).id,
    ).toBe('run-1');
  });
});
