import { describe, expect, it } from 'vitest';
import { SuiteDefinitionSchema, SuiteRunResultSchema } from './suite.js';

const suite = {
  apiVersion: 'rn-observer/v1alpha1',
  kind: 'Suite',
  metadata: { id: 'community.smoke', name: 'Community smoke suite' },
  steps: [
    {
      id: 'screen',
      title: 'Understand the current screen',
      action: { command: 'understand-screen' },
      requiredCapabilities: ['screen-understanding'],
      assertions: [
        {
          id: 'content',
          title: 'Screen contains content',
          type: 'equals',
          path: 'state',
          expected: 'content',
        },
      ],
    },
  ],
};

describe('suite contracts', () => {
  it('applies safe execution defaults', () => {
    const parsed = SuiteDefinitionSchema.parse(suite);

    expect(parsed.steps[0]?.risk).toBe('read');
    expect(parsed.steps[0]?.retry.maxAttempts).toBe(1);
    expect(parsed.reporters).toEqual(['json']);
  });

  it('rejects duplicate step ids across execution and cleanup', () => {
    expect(
      SuiteDefinitionSchema.safeParse({
        ...suite,
        cleanup: [
          {
            id: 'screen',
            title: 'Duplicate',
            action: { command: 'observe' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts the distinct persistent-permission suite risk', () => {
    const parsed = SuiteDefinitionSchema.parse({
      ...suite,
      steps: [
        {
          id: 'grant-camera',
          title: 'Persist camera permission for a fixture setup',
          risk: 'persistent-permission',
          action: {
            command: 'permission-grant',
            input: { permission: 'android.permission.CAMERA' },
          },
        },
      ],
    });

    expect(parsed.steps[0]?.risk).toBe('persistent-permission');
  });

  it('rejects a PASS finding without evidence inside a run result', () => {
    expect(
      SuiteRunResultSchema.safeParse({
        schemaVersion: '1.0',
        id: 'run-1',
        suiteId: 'community.smoke',
        startedAt: '2026-08-22T00:00:00.000Z',
        finishedAt: '2026-08-22T00:00:01.000Z',
        outcome: 'PASS',
        target: {
          platform: 'android',
          deviceId: 'emulator-5554',
          appId: 'dev.rnagentobserver.demo',
        },
        capabilities: [],
        steps: [],
        cleanup: [],
        findings: [
          {
            schemaVersion: '1.0',
            id: 'finding-1',
            ruleId: 'security.debuggable',
            title: 'Not debuggable',
            description: 'Release builds must not be debuggable.',
            outcome: 'PASS',
            severity: 'high',
            confidence: 1,
            category: 'security',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
