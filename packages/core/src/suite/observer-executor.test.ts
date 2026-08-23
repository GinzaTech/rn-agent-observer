import { describe, expect, it, vi } from 'vitest';
import type { SuiteRisk } from '@rn-agent-observer/schemas';
import type { ObserverCore } from '../index.js';
import {
  OBSERVER_SUITE_COMMANDS,
  createObserverSuiteExecutor,
} from './observer-executor.js';

const context = (risk: SuiteRisk, aborted = false) => {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    runId: 'run-1',
    stepId: 'step-1',
    attempt: 1,
    risk,
    signal: controller.signal,
  };
};

describe('observer suite executor', () => {
  it('extracts typed evidence references from artifact output', async () => {
    const screenshot = vi.fn().mockResolvedValue({
      artifact: {
        id: 'shot-1',
        kind: 'screenshot',
        path: 'C:\\artifacts\\shot.png',
      },
      screen: { width: 1080, height: 1920 },
    });
    const executor = createObserverSuiteExecutor({
      screenshot,
    } as unknown as ObserverCore);

    const result = await executor.execute('screenshot', {}, context('read'));

    expect(result.evidence).toEqual([
      {
        id: 'shot-1',
        kind: 'screenshot',
        relation: 'supports',
        uri: 'C:\\artifacts\\shot.png',
      },
    ]);
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('rejects a suite that understates a command risk', async () => {
    const tap = vi.fn();
    const executor = createObserverSuiteExecutor({
      tap,
    } as unknown as ObserverCore);

    await expect(
      executor.execute('tap', { testId: 'checkout' }, context('read')),
    ).rejects.toThrow('requires risk app-state');
    expect(tap).not.toHaveBeenCalled();
  });

  it('executes a correctly classified mutating command', async () => {
    const tap = vi.fn().mockResolvedValue({ performed: true });
    const executor = createObserverSuiteExecutor({
      tap,
    } as unknown as ObserverCore);

    await expect(
      executor.execute('tap', { testId: 'checkout' }, context('app-state')),
    ).resolves.toMatchObject({ output: { performed: true } });
    expect(tap).toHaveBeenCalledWith({ testId: 'checkout' });
  });

  it('keeps active-security findings and report artifact evidence in suite output', async () => {
    const runPermissionTransitionSecurityScenario = vi.fn().mockResolvedValue({
      result: {
        findings: [
          {
            id: 'security.active.permission.camera',
            outcome: 'PASS',
          },
        ],
        evidence: [
          {
            id: 'active-observation-1',
            kind: 'active-security-observation',
            relation: 'supports',
          },
        ],
      },
      artifact: {
        id: 'active-report-1',
        kind: 'security-report',
        path: 'C:\\artifacts\\active-report.json',
      },
    });
    const executor = createObserverSuiteExecutor({
      appId: 'dev.example.app',
      runPermissionTransitionSecurityScenario,
    } as unknown as ObserverCore);

    const result = await executor.execute(
      'security-active-permission',
      {
        scenarioId: 'camera-transition',
        permission: 'android.permission.CAMERA',
        probes: [{ id: 'revoke', granted: false }],
        allowedScreenStates: ['content'],
        maximumErrorLogs: 0,
        timeoutMs: 500,
        cleanupTimeoutMs: 500,
      },
      context('device-state'),
    );

    expect(result.findings).toEqual([
      {
        id: 'security.active.permission.camera',
        outcome: 'PASS',
      },
    ]);
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        {
          id: 'active-report-1',
          kind: 'security-report',
          relation: 'supports',
          uri: 'C:\\artifacts\\active-report.json',
        },
        {
          id: 'active-observation-1',
          kind: 'active-security-observation',
          relation: 'supports',
        },
      ]),
    );
    expect(runPermissionTransitionSecurityScenario).toHaveBeenCalledOnce();
  });

  it('keeps coverage findings and both report/evidence references in suite output', async () => {
    const analyzeRouteActionCoverage = vi.fn().mockReturnValue({
      result: {
        findings: [{ id: 'functional.route-action-coverage', outcome: 'PASS' }],
        evidence: [
          {
            id: 'coverage-summary-1',
            kind: 'route-action-coverage-summary',
            relation: 'supports',
          },
        ],
      },
      artifact: {
        id: 'coverage-report-1',
        kind: 'coverage-report',
        path: 'C:\\artifacts\\coverage.json',
      },
    });
    const executor = createObserverSuiteExecutor({
      analyzeRouteActionCoverage,
    } as unknown as ObserverCore);

    const result = await executor.execute(
      'coverage-analyze',
      { coverage: { target: 'provided-by-suite' } },
      context('read'),
    );

    expect(analyzeRouteActionCoverage).toHaveBeenCalledWith({
      target: 'provided-by-suite',
    });
    expect(result.findings).toEqual([
      { id: 'functional.route-action-coverage', outcome: 'PASS' },
    ]);
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        {
          id: 'coverage-report-1',
          kind: 'coverage-report',
          relation: 'supports',
          uri: 'C:\\artifacts\\coverage.json',
        },
        {
          id: 'coverage-summary-1',
          kind: 'route-action-coverage-summary',
          relation: 'supports',
        },
      ]),
    );
  });

  it('refuses active permission probes without an explicit boolean transition', async () => {
    const runPermissionTransitionSecurityScenario = vi.fn();
    const executor = createObserverSuiteExecutor({
      appId: 'dev.example.app',
      runPermissionTransitionSecurityScenario,
    } as unknown as ObserverCore);

    await expect(
      executor.execute(
        'security-active-permission',
        {
          scenarioId: 'camera-transition',
          permission: 'android.permission.CAMERA',
          probes: [{ id: 'missing-transition' }],
          allowedScreenStates: ['content'],
        },
        context('device-state'),
      ),
    ).rejects.toThrow('probes[].granted must be a boolean');
    expect(runPermissionTransitionSecurityScenario).not.toHaveBeenCalled();
  });

  it('requires per-run confirmation before a suite can make a persistent permission change', async () => {
    const setPermission = vi.fn().mockResolvedValue({
      appId: 'dev.example.app',
      permission: 'android.permission.CAMERA',
      granted: true,
      previouslyGranted: false,
      verified: true,
      persistent: true,
    });
    const core = { setPermission } as unknown as ObserverCore;

    await expect(
      createObserverSuiteExecutor(core).execute(
        'permission-grant',
        { permission: 'android.permission.CAMERA' },
        context('persistent-permission'),
      ),
    ).rejects.toThrow('explicit per-run confirmation');
    expect(setPermission).not.toHaveBeenCalled();

    await expect(
      createObserverSuiteExecutor(core, {
        confirmPersistentPermissionChange: true,
      }).execute(
        'permission-grant',
        { permission: 'android.permission.CAMERA' },
        context('persistent-permission'),
      ),
    ).resolves.toMatchObject({ output: { persistent: true } });
    expect(setPermission).toHaveBeenCalledWith(
      'android.permission.CAMERA',
      true,
      { confirmed: true },
    );
  });

  it('rejects unknown commands, keys, and pre-aborted execution', async () => {
    const getStatus = vi.fn().mockReturnValue({ ready: true });
    const executor = createObserverSuiteExecutor({
      getStatus,
    } as unknown as ObserverCore);

    await expect(
      executor.execute('unknown', {}, context('read')),
    ).rejects.toThrow('Unsupported observer suite command');
    await expect(
      executor.execute('status', { typo: true }, context('read')),
    ).rejects.toThrow('Unknown command input keys');
    await expect(
      executor.execute('status', {}, context('read', true)),
    ).rejects.toThrow('aborted before execution');
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('publishes a risk and capability descriptor for every command', () => {
    expect(Object.keys(OBSERVER_SUITE_COMMANDS).length).toBeGreaterThan(40);
    expect(OBSERVER_SUITE_COMMANDS['permission-grant']).toMatchObject({
      risk: 'persistent-permission',
      capabilities: ['device'],
    });
  });
});
