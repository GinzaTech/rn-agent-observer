import { describe, expect, it } from 'vitest';
import { OBSERVER_SUITE_COMMANDS } from './observer-executor.js';
import {
  BUILTIN_SUITES,
  getBuiltinSuite,
  listBuiltinSuites,
} from './presets.js';

describe('built-in quality suites', () => {
  it('ships every configured quality pack', () => {
    expect(Object.keys(BUILTIN_SUITES).sort()).toEqual([
      'accessibility',
      'network',
      'performance',
      'resilience',
      'security',
      'smoke',
      'visual',
    ]);
    expect(listBuiltinSuites()).toHaveLength(7);
  });

  it('uses only registered commands with matching minimum risk', () => {
    for (const suite of Object.values(BUILTIN_SUITES)) {
      for (const step of [...suite.steps, ...suite.cleanup]) {
        const descriptor =
          OBSERVER_SUITE_COMMANDS[
            step.action.command as keyof typeof OBSERVER_SUITE_COMMANDS
          ];
        expect(descriptor, step.action.command).toBeDefined();
        expect(step.risk, step.action.command).toBe(descriptor?.risk);
      }
    }
  });

  it('returns a defensive parsed copy and rejects unknown names', () => {
    const first = getBuiltinSuite('security');
    const second = getBuiltinSuite('security');

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(getBuiltinSuite('unknown')).toBeUndefined();
  });
});
