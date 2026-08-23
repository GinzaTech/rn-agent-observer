import { describe, expect, it } from 'vitest';
import { MAX_SUITE_FILE_BYTES, parseSuiteDefinition } from './loader.js';

const jsonSuite = JSON.stringify({
  apiVersion: 'rn-observer/v1alpha1',
  kind: 'Suite',
  metadata: { id: 'community.smoke', name: 'Community smoke' },
  steps: [
    {
      id: 'observe',
      title: 'Observe',
      action: { command: 'observe' },
    },
  ],
});

describe('suite loader', () => {
  it('loads JSON and applies execution defaults', () => {
    const suite = parseSuiteDefinition(jsonSuite, 'json');

    expect(suite.steps[0]?.timeoutMs).toBe(30_000);
    expect(suite.reporters).toEqual(['json']);
  });

  it('loads a YAML suite', () => {
    const suite = parseSuiteDefinition(
      `apiVersion: rn-observer/v1alpha1
kind: Suite
metadata:
  id: community.security
  name: Passive security
steps:
  - id: manifest
    title: Inspect manifest
    action:
      command: security-manifest
`,
      'yaml',
    );

    expect(suite.metadata.id).toBe('community.security');
    expect(suite.steps[0]?.risk).toBe('read');
  });

  it('rejects duplicate YAML keys', () => {
    expect(() =>
      parseSuiteDefinition(
        `apiVersion: rn-observer/v1alpha1
kind: Suite
kind: Suite
metadata: { id: duplicate, name: Duplicate }
steps: [{ id: one, title: One, action: { command: observe } }]
`,
        'yaml',
      ),
    ).toThrow(/Map keys must be unique|unique keys/iu);
  });

  it('rejects unsupported contracts and oversized inputs', () => {
    expect(() =>
      parseSuiteDefinition(
        jsonSuite.replace('rn-observer/v1alpha1', 'rn-observer/v99'),
        'json',
      ),
    ).toThrow();
    expect(() =>
      parseSuiteDefinition(' '.repeat(MAX_SUITE_FILE_BYTES + 1), 'json'),
    ).toThrow(/safety limit/u);
  });
});
