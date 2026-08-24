import { describe, expect, it } from 'vitest';
import { runReplayScript, type ReplayActions } from './replay.js';

function stubActions(overrides: Partial<ReplayActions> = {}): ReplayActions {
  return {
    tap: async (step) => `tapped ${step.testId ?? step.ref ?? 'coords'}`,
    swipe: async () => 'swiped',
    typeText: async () => 'typed',
    back: async () => 'pressed back',
    deepLink: async (step) => `opened ${step.uri}`,
    reload: async () => 'reloaded (mode: app)',
    assert: async () => 'assert passed',
    wait: async () => 'waited',
    waitFor: async () => 'wait-for passed after 2 attempts (1200ms)',
    screenshot: async () => 'shot.png',
    ...overrides,
  };
}

describe('replay runner', () => {
  it('executes steps in order and reports pass counts', async () => {
    const report = await runReplayScript(
      {
        name: 'demo',
        steps: [
          { action: 'tap', testId: 'open-PerformanceLab' },
          { action: 'wait', ms: 200 },
          { action: 'assert', testId: 'trigger-js-block', visible: true },
        ],
      },
      stubActions(),
    );
    expect(report).toMatchObject({
      name: 'demo',
      total: 3,
      passed: 3,
      failed: 0,
      stoppedEarly: false,
    });
  });

  it('stops early on failure unless continueOnError', async () => {
    const failing: Partial<ReplayActions> = {
      assert: async () => 'FAILED assert: {}',
    };
    const stopped = await runReplayScript(
      {
        steps: [
          { action: 'tap', testId: 'a' },
          { action: 'assert', testId: 'missing' },
          { action: 'tap', testId: 'b' },
        ],
      },
      stubActions(failing),
    );
    expect(stopped).toMatchObject({
      total: 3,
      passed: 1,
      failed: 1,
      stoppedEarly: true,
    });
    expect(stopped.results).toHaveLength(2);
    const continued = await runReplayScript(
      {
        continueOnError: true,
        steps: [
          { action: 'tap', testId: 'a' },
          { action: 'assert', testId: 'missing' },
          { action: 'tap', testId: 'b' },
        ],
      },
      stubActions(failing),
    );
    expect(continued).toMatchObject({
      stoppedEarly: false,
      passed: 2,
      failed: 1,
    });
  });

  it('captures thrown errors as failed steps', async () => {
    const report = await runReplayScript(
      { steps: [{ action: 'deep-link', uri: 'demo://x' }] },
      stubActions({
        deepLink: async () => {
          throw new Error('no activity for URI');
        },
      }),
    );
    expect(report.results[0]).toMatchObject({ ok: false, action: 'deep-link' });
    expect(report.results[0]?.summary).toContain('no activity for URI');
  });

  it('treats an unobserved wait-for target as a failed step', async () => {
    const report = await runReplayScript(
      {
        steps: [{ action: 'wait-for', testId: 'cart-badge', timeoutMs: 2_000 }],
      },
      stubActions({
        waitFor: async () =>
          'FAILED wait-for: not observed within 2000ms (3 attempts)',
      }),
    );
    expect(report.results[0]).toMatchObject({
      ok: false,
      action: 'wait-for',
    });
    expect(report.stoppedEarly).toBe(true);
  });
});
