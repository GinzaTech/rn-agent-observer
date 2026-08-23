import { describe, expect, it, vi } from 'vitest';
import { AssuranceFindingSchema } from '@rn-agent-observer/schemas';
import {
  MAX_ACTIVE_DEEP_LINK_PROBES,
  runMalformedDeepLinkScenario,
  runPermissionTransitionScenario,
  type ActiveSecurityAuthorizationRequest,
  type ActiveSecurityRawObservation,
  type MalformedDeepLinkExecutor,
  type MalformedDeepLinkScenario,
  type PermissionTransitionExecutor,
  type PermissionTransitionScenario,
} from './active-scenario.js';

const NOW = '2026-08-22T00:00:00.000Z';

const authorized = (request: ActiveSecurityAuthorizationRequest) => ({
  authorized: true as const,
  authorizationId: 'authorization-owned-app',
  appId: request.appId,
  action: request.action,
  risk: request.risk,
  ownedApp: true as const,
  allowlisted: true as const,
});

function observation(
  overrides: Partial<ActiveSecurityRawObservation> = {},
): ActiveSecurityRawObservation {
  return {
    appId: 'dev.test.app',
    capturedAt: NOW,
    appState: { processRunning: true, appInForeground: true },
    screen: { state: 'content', issueCodes: [] },
    logs: [
      {
        level: 'info',
        source: 'ReactNativeJS owner@example.test',
        timestamp: NOW,
        message: 'token=private-token owner@example.test',
      },
    ],
    ...overrides,
  };
}

function deepLinkScenario(
  overrides: Partial<MalformedDeepLinkScenario> = {},
): MalformedDeepLinkScenario {
  return {
    scenarioId: 'deep-link-fuzz',
    kind: 'malformed-deep-link',
    appId: 'dev.test.app',
    risk: 'app-state',
    ownership: 'owned',
    baseUri: 'demo://diagnostics/fuzz?mode=private-value#private-fragment',
    probes: [
      {
        id: 'invalid-encoding',
        mutation: 'invalid-percent-encoding',
        parameter: 'input',
      },
      {
        id: 'oversized-value',
        mutation: 'oversized-value',
        parameter: 'input',
      },
    ],
    allowedScreenStates: ['content'],
    maximumErrorLogs: 0,
    timeoutMs: 1_000,
    settleMs: 0,
    ...overrides,
  };
}

function permissionScenario(
  overrides: Partial<PermissionTransitionScenario> = {},
): PermissionTransitionScenario {
  return {
    scenarioId: 'permission-camera',
    kind: 'permission-transition',
    appId: 'dev.test.app',
    risk: 'device-state',
    ownership: 'owned',
    permission: 'android.permission.CAMERA',
    probes: [
      {
        id: 'grant-camera',
        granted: true,
        allowedScreenStates: ['content'],
        maximumErrorLogs: 0,
      },
    ],
    timeoutMs: 1_000,
    cleanupTimeoutMs: 1_000,
    settleMs: 0,
    ...overrides,
  };
}

describe('active security scenarios', () => {
  it('does nothing when exact owned-app authorization is denied', async () => {
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async () => ({
        authorized: false,
        reason: 'private denial reason',
      })),
      openDeepLink: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runMalformedDeepLinkScenario(
      deepLinkScenario(),
      executor,
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.authorization).toBe('denied-or-invalid');
    expect(executor.openDeepLink).not.toHaveBeenCalled();
    expect(executor.captureObservation).not.toHaveBeenCalled();
    const request = vi.mocked(executor.authorize).mock.calls[0]?.[0];
    expect(request).toMatchObject({
      appId: 'dev.test.app',
      action: 'malformed-deep-link',
      risk: 'app-state',
      ownership: 'owned',
      constraints: {
        noLogin: true,
        noPurchase: true,
        noAccountMutation: true,
        noNetworkInterception: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('private denial reason');
  });

  it('rejects an authorized-looking decision bound to another app', async () => {
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async (request) => ({
        ...authorized(request),
        appId: 'dev.someone.else',
      })),
      openDeepLink: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runMalformedDeepLinkScenario(
      deepLinkScenario(),
      executor,
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(executor.openDeepLink).not.toHaveBeenCalled();
    expect(executor.captureObservation).not.toHaveBeenCalled();
  });

  it('runs bounded malformed links and emits only redacted structured evidence', async () => {
    const opened: Parameters<MalformedDeepLinkExecutor['openDeepLink']>[0][] =
      [];
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      openDeepLink: vi.fn(async (input) => {
        opened.push(input);
      }),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runMalformedDeepLinkScenario(
      deepLinkScenario(),
      executor,
    );

    expect(result.outcome).toBe('PASS');
    expect(result.probes).toHaveLength(2);
    expect(result.probes.every((probe) => probe.outcome === 'PASS')).toBe(true);
    expect(opened).toHaveLength(2);
    expect(
      opened.every(
        (action) =>
          action.appId === 'dev.test.app' &&
          action.risk === 'app-state' &&
          action.authorizationId === 'authorization-owned-app' &&
          action.uri.length <= 2_048 &&
          !action.signal.aborted,
      ),
    ).toBe(true);
    expect(result.probes[0]?.target).toBe('demo://diagnostics/fuzz');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('private-value');
    expect(serialized).not.toContain('private-fragment');
    expect(serialized).not.toContain('private-token');
    expect(serialized).not.toContain('owner@example.test');
    expect(serialized).not.toContain('owner-example.test');
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
  });

  it('fails from explicit crash metadata without repeating log messages', async () => {
    let captureCount = 0;
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      openDeepLink: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => {
        captureCount += 1;
        return captureCount === 1
          ? observation()
          : observation({
              appState: {
                processRunning: false,
                appInForeground: false,
              },
              logs: [
                {
                  level: 'fatal',
                  source: 'ReactNativeJS',
                  timestamp: NOW,
                  message: 'secret crash payload',
                },
              ],
            });
      }),
    };

    const result = await runMalformedDeepLinkScenario(
      deepLinkScenario({ probes: [deepLinkScenario().probes[0]!] }),
      executor,
    );

    expect(result.outcome).toBe('FAIL');
    expect(result.probes[0]?.outcome).toBe('FAIL');
    expect(JSON.stringify(result)).not.toContain('secret crash payload');
  });

  it('counts stack trace continuations as detail rather than separate errors', async () => {
    let captureCount = 0;
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      openDeepLink: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => {
        captureCount += 1;
        return captureCount === 1
          ? observation()
          : observation({
              logs: [
                {
                  level: 'error',
                  source: 'ReactHost',
                  timestamp: NOW,
                  message: 'ReactHost: Unhandled SoftException',
                },
                {
                  level: 'error',
                  source: 'ReactHost',
                  timestamp: NOW,
                  message:
                    'ReactHost: com.facebook.react.bridge.ReactNoCrashSoftException: context is not ready',
                },
                {
                  level: 'error',
                  source: 'ReactHost',
                  timestamp: NOW,
                  message: '\tat com.example.App.start(App.ts:1)',
                },
                {
                  level: 'error',
                  source: 'ReactHost',
                  timestamp: NOW,
                  message:
                    'ReactHost: \tat android.app.ActivityThread.main(ActivityThread.java:1)',
                },
              ],
            });
      }),
    };

    const result = await runMalformedDeepLinkScenario(
      deepLinkScenario({
        probes: [deepLinkScenario().probes[0]!],
        maximumErrorLogs: 1,
      }),
      executor,
    );

    expect(result.outcome).toBe('PASS');
    expect(result.probes[0]?.observation?.logs?.errorCount).toBe(1);
  });

  it('does not verify observations bound to another appId', async () => {
    let captureCount = 0;
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      openDeepLink: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => {
        captureCount += 1;
        return captureCount === 1
          ? observation()
          : observation({ appId: 'dev.someone.else' });
      }),
    };

    const result = await runMalformedDeepLinkScenario(
      deepLinkScenario({ probes: [deepLinkScenario().probes[0]!] }),
      executor,
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.probes[0]?.reason).toContain('target appId');
  });

  it('rejects forbidden or unbounded deep-link semantics before authorization', async () => {
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      openDeepLink: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => observation()),
    };

    await expect(
      runMalformedDeepLinkScenario(
        deepLinkScenario({ baseUri: 'demo://account/login?mode=test' }),
        executor,
      ),
    ).rejects.toThrow(/login, purchase, account/u);
    await expect(
      runMalformedDeepLinkScenario(
        deepLinkScenario({
          probes: Array.from(
            { length: MAX_ACTIVE_DEEP_LINK_PROBES + 1 },
            (_, index) => ({
              id: `probe-${index}`,
              mutation: 'empty-value' as const,
              parameter: `input${index}`,
            }),
          ),
        }),
        executor,
      ),
    ).rejects.toThrow(/1-6/u);
    expect(executor.authorize).not.toHaveBeenCalled();
  });

  it('honors the scenario timeout through AbortSignal', async () => {
    let actionSignal: AbortSignal | undefined;
    const executor: MalformedDeepLinkExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      openDeepLink: vi.fn(
        async (input) =>
          await new Promise<void>((_resolve, reject) => {
            actionSignal = input.signal;
            input.signal.addEventListener(
              'abort',
              () => reject(new Error('private timeout detail')),
              { once: true },
            );
          }),
      ),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runMalformedDeepLinkScenario(
      deepLinkScenario({
        timeoutMs: 30,
        probes: [deepLinkScenario().probes[0]!],
      }),
      executor,
    );

    expect(actionSignal?.aborted).toBe(true);
    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.probes[0]?.reason).toContain('timed out');
    expect(JSON.stringify(result)).not.toContain('private timeout detail');
  });

  it('restores the original permission after a successful transition', async () => {
    let permissionState = false;
    const setCalls: Array<{ granted: boolean; signal: AbortSignal }> = [];
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => permissionState),
      setPermission: vi.fn(async (input) => {
        setCalls.push({ granted: input.granted, signal: input.signal });
        permissionState = input.granted;
      }),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario(),
      executor,
    );

    expect(result.outcome).toBe('PASS');
    expect(result.cleanup).toMatchObject({
      status: 'restored',
      attempted: true,
      originalPermissionState: false,
      observedPermissionState: false,
    });
    expect(permissionState).toBe(false);
    expect(setCalls.map((call) => call.granted)).toEqual([true, false]);
    expect(setCalls[0]?.signal).not.toBe(setCalls[1]?.signal);
    expect(setCalls[1]?.signal.aborted).toBe(false);
    expect(
      result.findings.every(
        (finding) => AssuranceFindingSchema.safeParse(finding).success,
      ),
    ).toBe(true);
  });

  it('records a verified permission-change relaunch before accepting fresh evidence', async () => {
    let permissionState = true;
    let recoveryCall = 0;
    const recoverAfterPermissionChange = vi.fn(async () => {
      recoveryCall += 1;
      return {
        status:
          recoveryCall === 1 ? ('recovered' as const) : ('not-needed' as const),
      };
    });
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => permissionState),
      setPermission: vi.fn(async (input) => {
        permissionState = input.granted;
        return { priorProcessId: 42 };
      }),
      recoverAfterPermissionChange,
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario({
        probes: [
          {
            id: 'revoke-camera',
            granted: false,
            allowedScreenStates: ['content'],
            maximumErrorLogs: 0,
          },
        ],
      }),
      executor,
    );

    expect(result.outcome).toBe('PASS');
    expect(result.probes[0]).toMatchObject({
      outcome: 'PASS',
      recovery: { status: 'recovered' },
    });
    expect(result.probes[0]?.evidence).toHaveLength(1);
    expect(result.findings[0]?.limitations).toContain(
      'Android reported a matching permission-change process termination; the exact authorized app was relaunched before this fresh observation.',
    );
    expect(recoverAfterPermissionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'dev.test.app',
        permission: 'android.permission.CAMERA',
        priorProcessId: 42,
      }),
    );
  });

  it('re-observes one transient blank screen after a verified relaunch', async () => {
    let permissionState = true;
    let recoveryCall = 0;
    let captureCall = 0;
    const captureObservation = vi.fn(async () => {
      captureCall += 1;
      if (captureCall === 2) {
        return observation({
          screen: { state: 'blank', issueCodes: ['blank-screen'] },
        });
      }
      return observation();
    });
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => permissionState),
      setPermission: vi.fn(async (input) => {
        permissionState = input.granted;
        return { priorProcessId: 42 };
      }),
      recoverAfterPermissionChange: vi.fn(async () => {
        recoveryCall += 1;
        return {
          status:
            recoveryCall === 1
              ? ('recovered' as const)
              : ('not-needed' as const),
        };
      }),
      captureObservation,
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario({
        probes: [
          {
            id: 'revoke-camera',
            granted: false,
            allowedScreenStates: ['content'],
            maximumErrorLogs: 0,
          },
        ],
      }),
      executor,
    );

    expect(result.outcome).toBe('PASS');
    expect(result.probes[0]).toMatchObject({
      outcome: 'PASS',
      recovery: { status: 'recovered' },
      recoveryObservationAttempts: 2,
    });
    expect(captureObservation).toHaveBeenCalledTimes(3);
  });

  it('does not pass a permission transition when termination evidence is unavailable', async () => {
    let permissionState = true;
    let recoveryCall = 0;
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => permissionState),
      setPermission: vi.fn(async (input) => {
        permissionState = input.granted;
        return { priorProcessId: 42 };
      }),
      recoverAfterPermissionChange: vi.fn(async () => {
        recoveryCall += 1;
        return {
          status:
            recoveryCall === 1
              ? ('not-verified' as const)
              : ('not-needed' as const),
        };
      }),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario({
        probes: [
          {
            id: 'revoke-camera',
            granted: false,
            allowedScreenStates: ['content'],
            maximumErrorLogs: 0,
          },
        ],
      }),
      executor,
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.probes[0]).toMatchObject({
      outcome: 'NOT_VERIFIED',
      recovery: { status: 'not-verified' },
    });
    expect(result.probes[0]?.reason).toContain('not verified');
  });

  it('restores permission in finally after a transition executor error', async () => {
    let permissionState = false;
    const setCalls: boolean[] = [];
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => permissionState),
      setPermission: vi.fn(async (input) => {
        setCalls.push(input.granted);
        if (input.granted) throw new Error('private executor failure');
        permissionState = false;
      }),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario(),
      executor,
    );

    expect(setCalls).toEqual([true, false]);
    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.cleanup?.status).toBe('restored');
    expect(JSON.stringify(result)).not.toContain('private executor failure');
  });

  it('uses a fresh cleanup signal after external abort', async () => {
    let permissionState = false;
    const controller = new AbortController();
    const setCalls: Array<{ granted: boolean; signal: AbortSignal }> = [];
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => permissionState),
      setPermission: vi.fn(async (input) => {
        setCalls.push({ granted: input.granted, signal: input.signal });
        permissionState = input.granted;
        if (input.granted) controller.abort();
      }),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario(),
      executor,
      controller.signal,
    );

    expect(setCalls.map((call) => call.granted)).toEqual([true, false]);
    expect(setCalls[0]?.signal.aborted).toBe(true);
    expect(setCalls[1]?.signal).not.toBe(setCalls[0]?.signal);
    expect(setCalls[1]?.signal.aborted).toBe(false);
    expect(permissionState).toBe(false);
    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(result.cleanup?.status).toBe('restored');
  });

  it('fails loudly when permission cleanup cannot restore state', async () => {
    let permissionState = false;
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => permissionState),
      setPermission: vi.fn(async (input) => {
        if (!input.granted) throw new Error('cleanup secret');
        permissionState = true;
      }),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario(),
      executor,
    );

    expect(result.outcome).toBe('FAIL');
    expect(result.cleanup?.status).toBe('failed');
    expect(permissionState).toBe(true);
    expect(JSON.stringify(result)).not.toContain('cleanup secret');
  });

  it('does not mutate when original permission state is unavailable', async () => {
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => null),
      setPermission: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => observation()),
    };

    const result = await runPermissionTransitionScenario(
      permissionScenario(),
      executor,
    );

    expect(result.outcome).toBe('NOT_VERIFIED');
    expect(executor.setPermission).not.toHaveBeenCalled();
    expect(result.cleanup).toMatchObject({
      status: 'not-needed',
      attempted: false,
      originalPermissionState: null,
    });
  });

  it('rejects account permission probes before authorization', async () => {
    const executor: PermissionTransitionExecutor = {
      authorize: vi.fn(async (request) => authorized(request)),
      getPermissionState: vi.fn(async () => false),
      setPermission: vi.fn(async () => undefined),
      captureObservation: vi.fn(async () => observation()),
    };

    await expect(
      runPermissionTransitionScenario(
        permissionScenario({ permission: 'android.permission.GET_ACCOUNTS' }),
        executor,
      ),
    ).rejects.toThrow(/account semantics/u);
    expect(executor.authorize).not.toHaveBeenCalled();
  });
});
