import { describe, expect, it } from 'vitest';
import { MAX_SECRET_SCAN_BYTES, scanSecrets } from './secret-scanner.js';

describe('passive secret scanner', () => {
  it('returns locations, redacted previews, and keyed fingerprints only', () => {
    const accessKey = 'AKIAABCDEFGHIJKLMNOP';
    const bearer = 'exampleBearerToken1234567890';
    const text = `log start\naws=${accessKey}\nAuthorization: Bearer ${bearer}`;
    const result = scanSecrets(text, {
      source: 'device.log',
      fingerprintKey: 'test-only-fingerprint-key',
      analyzedAt: '2026-08-22T00:00:00.000Z',
    });
    const serialized = JSON.stringify(result);

    expect(result.outcome).toBe('FAIL');
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toMatchObject({
      kind: 'aws-access-key',
      source: 'device.log',
      line: 2,
      column: 5,
    });
    expect(result.matches[0]?.fingerprint).toMatch(
      /^hmac-sha256:[a-f0-9]{64}$/u,
    );
    expect(
      result.matches.every((match) =>
        match.redactedPreview.includes('[REDACTED'),
      ),
    ).toBe(true);
    expect(serialized).not.toContain(accessKey);
    expect(serialized).not.toContain(bearer);
  });

  it('uses a keyed fingerprint so callers control correlation scope', () => {
    const text = 'password=correct-horse-battery-staple';
    const first = scanSecrets(text, { fingerprintKey: 'scope-a' });
    const repeated = scanSecrets(text, { fingerprintKey: 'scope-a' });
    const isolated = scanSecrets(text, { fingerprintKey: 'scope-b' });

    expect(first.matches[0]?.fingerprint).toBe(
      repeated.matches[0]?.fingerprint,
    );
    expect(first.matches[0]?.fingerprint).not.toBe(
      isolated.matches[0]?.fingerprint,
    );
  });

  it('emits an evidenced PASS while keeping pattern limitations explicit', () => {
    const result = scanSecrets('ordinary structured log', {
      source: 'safe.log',
      fingerprintKey: 'scope',
    });

    expect(result.outcome).toBe('PASS');
    expect(result.findings[0]).toMatchObject({
      ruleId: 'security.secret.none-detected',
      outcome: 'PASS',
    });
    expect(result.limitations).not.toHaveLength(0);
  });

  it('fails closed when the bounded scan limit is exceeded', () => {
    const result = scanSecrets('x'.repeat(33), {
      source: 'large.log',
      maxBytes: 32,
    });
    const hardLimit = scanSecrets('x'.repeat(MAX_SECRET_SCAN_BYTES + 1));

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.matches).toEqual([]);
    expect(hardLimit.outcome).toBe('NOT_VERIFIED');
  });
});
