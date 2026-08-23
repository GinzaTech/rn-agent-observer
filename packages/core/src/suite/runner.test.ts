import { describe, expect, it, vi } from 'vitest';
import {
  SuiteDefinitionSchema,
  type SuiteDefinition,
  type SuiteStep,
} from '@rn-agent-observer/schemas';
import { runSuite, type SuiteCommandExecutor } from './runner.js';

const target = {
  platform: 'android' as const,
  deviceId: 'emulator-5554',
  appId: 'dev.rnagentobserver.demo',
};

const makeSuite = (
  step: Partial<SuiteStep> = {},
  extras: Record<string, unknown> = {},
): SuiteDefinition =>
  SuiteDefinitionSchema.parse({
    apiVersion: 'rn-observer/v1alpha1',
    kind: 'Suite',
    metadata: { id: 'community.smoke', name: 'Community smoke suite' },
    steps: [
      {
        id: 'screen',
        title: 'Understand the current screen',
        action: { command: 'understand-screen' },
        ...step,
      },
    ],
    ...extras,
  });

describe('suite runner', () => {
  it('executes an evidenced assertion and returns PASS', async () => {
    const execute = vi.fn<SuiteCommandExecutor['execute']>().mockResolvedValue({
      output: { state: 'content' },
      evidence: [
        {
          id: 'screen-1',
          kind: 'screen-understanding',
          relation: 'supports',
        },
      ],
    });
    const suite = makeSuite({
      requiredCapabilities: ['screen-understanding'],
      assertions: [
        {
          id: 'content',
          title: 'Screen contains content',
          type: 'equals',
          path: 'state',
          expected: 'content',
          evidenceKinds: ['screen-understanding'],
          onUnavailable: 'NOT_VERIFIED',
        },
      ],
    });

    const result = await runSuite(suite, {
      target,
      capabilities: ['screen-understanding'],
      executor: { execute },
      createRunId: () => 'run-pass',
    });

    expect(result.outcome).toBe('PASS');
    expect(result.steps[0]?.assertions[0]?.outcome).toBe('PASS');
    expect(execute).toHaveBeenCalledOnce();
  });

  it('returns NOT_VERIFIED without executing when a capability is missing', async () => {
    const execute = vi.fn<SuiteCommandExecutor['execute']>();
    const result = await runSuite(
      makeSuite({ requiredCapabilities: ['screen-understanding'] }),
      {
        target,
        capabilities: [],
        executor: { execute },
      },
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.steps[0]?.attempts).toBe(0);
    expect(result.steps[0]?.reason).toContain('Missing capabilities');
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed for a mutating risk without explicit authorization', async () => {
    const execute = vi.fn<SuiteCommandExecutor['execute']>();
    const result = await runSuite(makeSuite({ risk: 'device-state' }), {
      target,
      capabilities: [],
      executor: { execute },
    });

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.steps[0]?.reason).toContain('explicit authorization');
    expect(execute).not.toHaveBeenCalled();
  });

  it('retries a failed assertion and records only the final attempt', async () => {
    const execute = vi
      .fn<SuiteCommandExecutor['execute']>()
      .mockResolvedValueOnce({ output: { ready: false } })
      .mockResolvedValueOnce({ output: { ready: true } });
    const result = await runSuite(
      makeSuite({
        retry: { maxAttempts: 2, backoffMs: 1 },
        assertions: [
          {
            id: 'ready',
            title: 'App is ready',
            type: 'equals',
            path: 'ready',
            expected: true,
            evidenceKinds: [],
            onUnavailable: 'NOT_VERIFIED',
          },
        ],
      }),
      {
        target,
        capabilities: [],
        executor: { execute },
        sleep: async () => undefined,
      },
    );

    expect(result.outcome).toBe('PASS');
    expect(result.steps[0]?.attempts).toBe(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('runs cleanup even when an execution step fails', async () => {
    const commands: string[] = [];
    const executor: SuiteCommandExecutor = {
      execute: async (command) => {
        commands.push(command);
        if (command === 'broken') throw new Error('fixture failure');
        return {};
      },
    };
    const suite = makeSuite(
      { action: { command: 'broken', input: {} } },
      {
        cleanup: [
          {
            id: 'restore',
            title: 'Restore fixture',
            action: { command: 'restore' },
          },
        ],
      },
    );

    const result = await runSuite(suite, {
      target,
      capabilities: [],
      executor,
    });

    expect(result.outcome).toBe('FAIL');
    expect(commands).toEqual(['broken', 'restore']);
    expect(result.cleanup[0]?.outcome).toBe('PASS');
  });

  it('aborts and reports a command timeout', async () => {
    let observedAbort = false;
    const executor: SuiteCommandExecutor = {
      execute: async (_command, _input, context) =>
        new Promise(() => {
          context.signal.addEventListener('abort', () => {
            observedAbort = true;
          });
        }),
    };
    const result = await runSuite(makeSuite({ timeoutMs: 10 }), {
      target,
      capabilities: [],
      executor,
    });

    expect(result.outcome).toBe('FAIL');
    expect(result.steps[0]?.reason).toContain('timed out');
    expect(observedAbort).toBe(true);
  });

  it('cancels remaining steps, reports progress, and still runs cleanup', async () => {
    const controller = new AbortController();
    const commands: string[] = [];
    const progress: string[] = [];
    let notifyStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const suite = makeSuite(
      {},
      {
        steps: [
          {
            id: 'wait',
            title: 'Wait for cancellation',
            action: { command: 'wait' },
          },
          {
            id: 'never',
            title: 'Must not run',
            action: { command: 'never' },
          },
        ],
        cleanup: [
          {
            id: 'restore',
            title: 'Restore fixture',
            action: { command: 'restore' },
          },
        ],
      },
    );
    const executor: SuiteCommandExecutor = {
      execute: async (command, _input, context) => {
        commands.push(command);
        if (command !== 'wait') return {};
        notifyStarted?.();
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
        return {};
      },
    };

    const pending = runSuite(suite, {
      target,
      capabilities: [],
      executor,
      signal: controller.signal,
      onProgress: ({ phase, completed, stepId }) => {
        progress.push(`${phase}:${completed}:${stepId}`);
      },
    });
    await started;
    controller.abort();
    const result = await pending;

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.limitations).toContain(
      'Suite execution was cancelled before all steps ran',
    );
    expect(commands).toEqual(['wait', 'restore']);
    expect(progress).toEqual([
      'steps:0:wait',
      'steps:1:wait',
      'cleanup:0:restore',
      'cleanup:1:restore',
    ]);
  });
});
