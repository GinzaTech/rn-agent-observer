import { describe, expect, it } from 'vitest';
import { AssuranceFindingSchema, EvidenceEnvelopeSchema } from './assurance.js';

const evidence = {
  id: 'screen-1',
  kind: 'screen-understanding',
  relation: 'supports' as const,
  sha256: 'a'.repeat(64),
};

describe('assurance contracts', () => {
  it('accepts a versioned evidence envelope with an honest availability state', () => {
    const result = EvidenceEnvelopeSchema.parse({
      schemaVersion: '1.0',
      id: 'evidence-1',
      runId: 'run-1',
      kind: 'screen-understanding',
      capturedAt: '2026-08-22T00:00:00.000Z',
      provider: { id: 'android-adb', version: '1.0.0' },
      target: {
        platform: 'android',
        deviceId: 'emulator-5554',
        appId: 'dev.rnagentobserver.demo',
      },
      availability: { status: 'AVAILABLE' },
      payload: { route: '/home' },
    });

    expect(result.classification).toBe('sensitive');
    expect(result.references).toEqual([]);
  });

  it('rejects unavailable evidence without a reason', () => {
    expect(
      EvidenceEnvelopeSchema.safeParse({
        schemaVersion: '1.0',
        id: 'evidence-1',
        runId: 'run-1',
        kind: 'js-fps',
        capturedAt: '2026-08-22T00:00:00.000Z',
        provider: { id: 'adb', version: '1.0.0' },
        target: {
          platform: 'android',
          deviceId: 'emulator-5554',
          appId: 'dev.rnagentobserver.demo',
        },
        availability: { status: 'UNAVAILABLE' },
        payload: null,
      }).success,
    ).toBe(false);
  });

  it('does not allow an unevidenced PASS', () => {
    expect(
      AssuranceFindingSchema.safeParse({
        schemaVersion: '1.0',
        id: 'finding-1',
        ruleId: 'security.no-debuggable',
        title: 'Application is not debuggable',
        description: 'The release manifest disables debugging.',
        outcome: 'PASS',
        severity: 'high',
        confidence: 1,
        category: 'security',
      }).success,
    ).toBe(false);
  });

  it('requires NOT_VERIFIED to explain the missing evidence', () => {
    expect(
      AssuranceFindingSchema.safeParse({
        schemaVersion: '1.0',
        id: 'finding-1',
        ruleId: 'performance.js-fps',
        title: 'JS FPS remains within budget',
        description: 'ADB does not expose JS FPS.',
        outcome: 'NOT_VERIFIED',
        severity: 'medium',
        confidence: 1,
        category: 'performance',
      }).success,
    ).toBe(false);

    expect(
      AssuranceFindingSchema.safeParse({
        schemaVersion: '1.0',
        id: 'finding-2',
        ruleId: 'security.no-debuggable',
        title: 'Application is not debuggable',
        description: 'The manifest setting was inspected.',
        outcome: 'PASS',
        severity: 'high',
        confidence: 1,
        category: 'security',
        evidence: [evidence],
      }).success,
    ).toBe(true);
  });
});
