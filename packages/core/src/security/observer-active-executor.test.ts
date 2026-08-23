import { describe, expect, it, vi } from 'vitest';
import type { ObserverCore } from '../index.js';
import { defaultObserverConfig } from '../config/observer-config.js';
import type { ActiveSecurityAuthorizationRequest } from './active-scenario.js';
import { ObserverActiveSecurityExecutor } from './observer-active-executor.js';

const coreFixture = (): {
  core: ObserverCore;
  deepLink: ReturnType<typeof vi.fn>;
  setPermission: ReturnType<typeof vi.fn>;
  permissionChangeExitStatus: ReturnType<typeof vi.fn>;
  appLaunch: ReturnType<typeof vi.fn>;
  getAppState: ReturnType<typeof vi.fn>;
  assertActionAuthorized: ReturnType<typeof vi.fn>;
} => {
  const config = defaultObserverConfig();
  const deepLink = vi.fn().mockResolvedValue(undefined);
  const setPermission = vi.fn().mockResolvedValue(undefined);
  const permissionChangeExitStatus = vi
    .fn()
    .mockResolvedValue('permission-change');
  const appLaunch = vi.fn().mockResolvedValue({
    appId: 'dev.example',
    launched: true,
    evidenceRecorded: true,
  });
  const assertActionAuthorized = vi.fn();
  const getAppState = vi.fn().mockResolvedValue({
    processRunning: true,
    appInForeground: true,
    pid: 123,
  });
  const core = {
    appId: 'dev.example',
    config: {
      ...config,
      security: {
        ...config.security,
        mode: 'authorized-active',
        allowedActions: ['read', 'app-state', 'device-state'],
        allowedAppIds: ['dev.example'],
      },
    },
    assertActionAuthorized,
    adb: { deepLink, setPermission, permissionChangeExitStatus },
    appLaunch,
    listPermissions: vi.fn().mockResolvedValue({
      appId: 'dev.example',
      permissions: [{ name: 'android.permission.CAMERA', granted: false }],
    }),
    getAppState,
    understandScreen: vi
      .fn()
      .mockResolvedValue({ state: 'content', issues: [] }),
    getLogs: vi.fn().mockResolvedValue([]),
  } as unknown as ObserverCore;
  return {
    core,
    deepLink,
    setPermission,
    permissionChangeExitStatus,
    appLaunch,
    getAppState,
    assertActionAuthorized,
  };
};

const authorizationRequest = (
  action: 'malformed-deep-link' | 'permission-transition',
  signal: AbortSignal,
): ActiveSecurityAuthorizationRequest => ({
  scenarioId: 'security-active-1',
  action,
  appId: 'dev.example',
  risk: action === 'malformed-deep-link' ? 'app-state' : 'device-state',
  ownership: 'owned',
  constraints: {
    noLogin: true,
    noPurchase: true,
    noAccountMutation: true,
    noNetworkInterception: true,
  },
  target:
    action === 'malformed-deep-link'
      ? { kind: 'uri', identifier: 'demo://fixture' }
      : {
          kind: 'permission',
          identifier: 'android.permission.CAMERA',
        },
  signal,
});

describe('ObserverCore active security executor', () => {
  it('binds authorization to the exact owned app, action, and risk', async () => {
    const { core, assertActionAuthorized } = coreFixture();
    const executor = new ObserverActiveSecurityExecutor(core);
    const controller = new AbortController();

    const authorized = await executor.authorize(
      authorizationRequest('malformed-deep-link', controller.signal),
    );
    expect(authorized).toMatchObject({
      authorized: true,
      appId: 'dev.example',
      action: 'malformed-deep-link',
      risk: 'app-state',
    });
    expect(assertActionAuthorized).toHaveBeenCalledWith(
      'security-active-deep-link',
    );

    const mismatched = {
      ...authorizationRequest('malformed-deep-link', controller.signal),
      appId: 'other.app',
    };
    await expect(executor.authorize(mismatched)).resolves.toMatchObject({
      authorized: false,
    });
  });

  it('executes a deep link only with its matching runtime grant', async () => {
    const { core, deepLink } = coreFixture();
    const executor = new ObserverActiveSecurityExecutor(core);
    const controller = new AbortController();
    const decision = await executor.authorize(
      authorizationRequest('malformed-deep-link', controller.signal),
    );
    if (!decision.authorized) throw new Error('fixture authorization failed');

    await executor.openDeepLink({
      appId: 'dev.example',
      risk: 'app-state',
      authorizationId: decision.authorizationId,
      signal: controller.signal,
      uri: 'demo://fixture?value=%ZZ',
    });
    expect(deepLink).toHaveBeenCalledWith(
      'dev.example',
      'demo://fixture?value=%ZZ',
    );
    await expect(
      executor.setPermission({
        appId: 'dev.example',
        risk: 'device-state',
        authorizationId: decision.authorizationId,
        signal: controller.signal,
        permission: 'android.permission.CAMERA',
        granted: true,
      }),
    ).rejects.toThrow('does not match');
  });

  it('reads and mutates permission state through the matching device grant', async () => {
    const { core, setPermission } = coreFixture();
    const executor = new ObserverActiveSecurityExecutor(core);
    const controller = new AbortController();
    const decision = await executor.authorize(
      authorizationRequest('permission-transition', controller.signal),
    );
    if (!decision.authorized) throw new Error('fixture authorization failed');
    const context = {
      appId: 'dev.example',
      risk: 'device-state' as const,
      authorizationId: decision.authorizationId,
      signal: controller.signal,
      permission: 'android.permission.CAMERA',
    };

    await expect(executor.getPermissionState(context)).resolves.toBe(false);
    await executor.setPermission({ ...context, granted: true });
    expect(setPermission).toHaveBeenCalledWith(
      'dev.example',
      'android.permission.CAMERA',
      true,
    );
  });

  it('relaunches only after the exact permission-change exit is verified', async () => {
    const { core, appLaunch, getAppState, permissionChangeExitStatus } =
      coreFixture();
    getAppState
      .mockResolvedValueOnce({
        processRunning: true,
        appInForeground: true,
        pid: 321,
      })
      .mockResolvedValueOnce({
        processRunning: false,
        appInForeground: false,
        pid: null,
      });
    const executor = new ObserverActiveSecurityExecutor(core);
    const controller = new AbortController();
    const decision = await executor.authorize(
      authorizationRequest('permission-transition', controller.signal),
    );
    if (!decision.authorized) throw new Error('fixture authorization failed');
    const context = {
      appId: 'dev.example',
      risk: 'device-state' as const,
      authorizationId: decision.authorizationId,
      signal: controller.signal,
      permission: 'android.permission.CAMERA',
    };

    const mutation = await executor.setPermission({
      ...context,
      granted: false,
    });
    await expect(
      executor.recoverAfterPermissionChange({
        ...context,
        priorProcessId: mutation.priorProcessId,
      }),
    ).resolves.toEqual({ status: 'recovered' });
    expect(permissionChangeExitStatus).toHaveBeenCalledWith('dev.example', 321);
    expect(appLaunch).toHaveBeenCalledOnce();
  });
});
