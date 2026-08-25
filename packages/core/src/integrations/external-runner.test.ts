import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compareExternalRunnerResults,
  importJunitRunnerResult,
  loadExternalRunnerResult,
  parseJunitRunnerResult,
} from './external-runner.js';

const report = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="4" failures="1" errors="1" skipped="1">
  <testsuite name="mobile flow" tests="4">
    <testcase classname="home" name="opens home" time="0.125" />
    <testcase classname="checkout" name="fails safely" time="0.500">
      <failure message="password=do-not-persist">raw failure body</failure>
    </testcase>
    <testcase classname="device" name="driver error"><error>secret</error></testcase>
    <testcase classname="optional" name="skipped"><skipped /></testcase>
  </testsuite>
</testsuites>`;

describe('external JUnit runner import', () => {
  it('normalizes outcomes while retaining only hashes and aggregate evidence', () => {
    const result = parseJunitRunnerResult(
      report,
      'maestro',
      '2026-08-25T00:00:00.000Z',
    );

    expect(result).toMatchObject({
      runner: 'maestro',
      caseIdentityScheme: 'sha256',
      outcome: 'FAIL',
      counts: { total: 4, passed: 1, failed: 1, errors: 1, skipped: 1 },
      durationMs: 625,
      truncated: false,
    });
    expect(result.cases).toHaveLength(4);
    expect(result.cases[0]?.idHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(result)).not.toContain('opens home');
    expect(JSON.stringify(result)).not.toContain('do-not-persist');
    expect(JSON.stringify(result)).not.toContain('raw failure body');
  });

  it('supports keyed case identities without persisting the HMAC secret', () => {
    const secret = 'correct-horse-battery-staple';
    const keyed = parseJunitRunnerResult(
      report,
      'maestro',
      '2026-08-25T00:00:00.000Z',
      { caseHashSecret: secret },
    );
    const unkeyed = parseJunitRunnerResult(report, 'maestro');

    expect(keyed.caseIdentityScheme).toBe('hmac-sha256');
    expect(keyed.cases[0]?.idHash).toMatch(/^hmac-sha256:[a-f0-9]{64}$/u);
    expect(keyed.cases[0]?.idHash).not.toBe(unkeyed.cases[0]?.idHash);
    expect(JSON.stringify(keyed)).not.toContain(secret);
    expect(() =>
      parseJunitRunnerResult(report, 'maestro', undefined, {
        caseHashSecret: 'weak',
      }),
    ).toThrow(/16 to 4096/u);
  });

  it('keeps empty or skipped-only reports honest and rejects XML entities', () => {
    expect(
      parseJunitRunnerResult(
        '<testsuite><testcase name="skip"><skipped /></testcase></testsuite>',
        'detox',
      ),
    ).toMatchObject({
      outcome: 'NOT_VERIFIED',
      counts: { total: 1, skipped: 1 },
    });
    expect(() =>
      parseJunitRunnerResult(
        '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><testsuite />',
        'appium',
      ),
    ).toThrow(/DTD or entity/u);
  });

  it('only imports a report physically contained by the project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-junit-'));
    const outside = mkdtempSync(join(tmpdir(), 'rn-observer-junit-outside-'));
    try {
      writeFileSync(join(root, 'report.xml'), report);
      writeFileSync(join(outside, 'report.xml'), report);
      await expect(
        importJunitRunnerResult(root, 'report.xml', 'generic'),
      ).resolves.toMatchObject({ runner: 'generic', outcome: 'FAIL' });
      await expect(
        importJunitRunnerResult(root, join(outside, 'report.xml'), 'generic'),
      ).rejects.toMatchObject({ code: 'FILE_PATH_NOT_AUTHORIZED' });
      writeFileSync(
        join(root, 'normalized.json'),
        JSON.stringify(parseJunitRunnerResult(report, 'generic')),
      );
      await expect(
        loadExternalRunnerResult(root, 'normalized.json'),
      ).resolves.toMatchObject({ runner: 'generic', counts: { total: 4 } });
      await expect(
        loadExternalRunnerResult(root, join(outside, 'report.xml')),
      ).rejects.toMatchObject({ code: 'FILE_PATH_NOT_AUTHORIZED' });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('detects new, recovered, and persistent failures using only case hashes', () => {
    const baseline = parseJunitRunnerResult(
      `<testsuite>
        <testcase classname="flow" name="new failure" time="0.1" />
        <testcase classname="flow" name="recovers" time="0.2"><failure /></testcase>
        <testcase classname="flow" name="persistent" time="0.3"><failure /></testcase>
        <testcase classname="flow" name="removed" time="0.4" />
      </testsuite>`,
      'maestro',
    );
    const current = parseJunitRunnerResult(
      `<testsuite>
        <testcase classname="flow" name="new failure" time="0.2"><failure /></testcase>
        <testcase classname="flow" name="recovers" time="0.2" />
        <testcase classname="flow" name="persistent" time="0.4"><error /></testcase>
        <testcase classname="flow" name="added" time="0.5" />
      </testsuite>`,
      'maestro',
    );

    const comparison = compareExternalRunnerResults(
      baseline,
      current,
      '2026-08-25T01:00:00.000Z',
    );
    expect(comparison).toMatchObject({
      outcome: 'FAIL',
      delta: { failed: -1, errors: 1, durationMs: 300 },
      changes: {
        newFailures: [expect.stringMatching(/^sha256:/u)],
        recovered: [expect.stringMatching(/^sha256:/u)],
        persistentFailures: [expect.stringMatching(/^sha256:/u)],
        addedCases: 1,
        removedCases: 1,
        outcomeChanges: 3,
      },
    });
    expect(JSON.stringify(comparison)).not.toContain('new failure');
    expect(JSON.stringify(comparison)).not.toContain('recovers');
  });

  it('returns NOT_VERIFIED when runner identity or comparison completeness differs', () => {
    const baseline = parseJunitRunnerResult(
      '<testsuite><testcase classname="a" name="one" /></testsuite>',
      'detox',
    );
    const current = parseJunitRunnerResult(
      '<testsuite><testcase classname="a" name="one" /></testsuite>',
      'appium',
    );
    expect(compareExternalRunnerResults(baseline, current)).toMatchObject({
      outcome: 'NOT_VERIFIED',
      runners: { baseline: 'detox', current: 'appium' },
      limitations: ['Runner identities differ between baseline and current'],
    });
  });

  it('does not compare keyed and unkeyed identities as equivalent', () => {
    const baseline = parseJunitRunnerResult(
      '<testsuite><testcase classname="a" name="one" /></testsuite>',
      'maestro',
    );
    const current = parseJunitRunnerResult(
      '<testsuite><testcase classname="a" name="one" /></testsuite>',
      'maestro',
      undefined,
      { caseHashSecret: 'correct-horse-battery-staple' },
    );
    expect(compareExternalRunnerResults(baseline, current)).toMatchObject({
      outcome: 'NOT_VERIFIED',
      caseIdentitySchemes: {
        baseline: 'sha256',
        current: 'hmac-sha256',
      },
      limitations: expect.arrayContaining([
        'Case identity hash schemes differ between baseline and current',
      ]),
    });
  });
});
