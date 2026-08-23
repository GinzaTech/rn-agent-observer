import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OBSERVER_CONFIG_FILENAME,
  defaultObserverConfig,
} from './config/observer-config.js';
import { ObserverCore } from './index.js';

const roots: string[] = [];
const appId = 'dev.rnagent.policy';
const targetDeviceId = 'emulator-5554';

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const createCore = (
  security: Partial<ReturnType<typeof defaultObserverConfig>['security']> = {},
  selectedDeviceId?: string,
): ObserverCore => {
  const root = mkdtempSync(join(tmpdir(), 'rn-observer-action-policy-'));
  roots.push(root);
  const defaults = defaultObserverConfig();
  writeFileSync(
    join(root, OBSERVER_CONFIG_FILENAME),
    JSON.stringify({
      ...defaults,
      target: { ...defaults.target, appId, deviceId: targetDeviceId },
      security: { ...defaults.security, ...security },
    }),
  );
  return new ObserverCore({
    projectRoot: root,
    ...(selectedDeviceId ? { deviceId: selectedDeviceId } : {}),
    onWarning: () => {},
  });
};

describe('ObserverCore action policy', () => {
  it('fails closed before direct state-changing Core commands reach adb', async () => {
    const core = createCore();
    const launch = vi.spyOn(core.adb, 'launch');
    const tap = vi.spyOn(core.adb, 'tap');
    const swipe = vi.spyOn(core.adb, 'swipe');
    const typeText = vi.spyOn(core.adb, 'typeText');
    const deepLink = vi.spyOn(core.adb, 'deepLink');
    const setPermission = vi.spyOn(core.adb, 'setPermission');

    await expect(core.appLaunch()).rejects.toMatchObject({
      code: 'ACTION_NOT_AUTHORIZED',
      recoverable: true,
    });
    await expect(core.tap({ x: 1, y: 2 })).rejects.toThrow(
      'security.mode=authorized-active',
    );
    await expect(core.swipe({ x: 1, y: 2 }, { x: 3, y: 4 })).rejects.toThrow(
      'security.mode=authorized-active',
    );
    await expect(core.typeText('fixture')).rejects.toThrow(
      'security.mode=authorized-active',
    );
    await expect(core.deepLink('fixture://safe')).rejects.toThrow(
      'security.mode=authorized-active',
    );
    await expect(
      core.setPermission('android.permission.CAMERA', true, {
        confirmed: true,
      }),
    ).rejects.toThrow('security.mode=authorized-active');

    expect(launch).not.toHaveBeenCalled();
    expect(tap).not.toHaveBeenCalled();
    expect(swipe).not.toHaveBeenCalled();
    expect(typeText).not.toHaveBeenCalled();
    expect(deepLink).not.toHaveBeenCalled();
    expect(setPermission).not.toHaveBeenCalled();
  });

  it('requires both the action risk and exact app allowlist', async () => {
    const core = createCore({
      mode: 'authorized-active',
      allowedActions: ['read', 'app-state', 'device-state'],
      allowedAppIds: ['dev.rnagent.other'],
    });
    const deepLink = vi.spyOn(core.adb, 'deepLink');

    await expect(core.deepLink('fixture://safe')).rejects.toThrow(
      'Target app ID is not explicitly allowlisted',
    );
    expect(deepLink).not.toHaveBeenCalled();
  });

  it('allows explicitly authorized actions and a separately authorized persistent permission change', async () => {
    const core = createCore({
      mode: 'authorized-active',
      allowedActions: [
        'read',
        'app-state',
        'device-state',
        'persistent-permission',
      ],
      allowedAppIds: [appId],
      allowPersistentPermissionChanges: true,
      allowedPersistentPermissions: ['android.permission.CAMERA'],
    });
    const launch = vi.spyOn(core.adb, 'launch').mockResolvedValue(undefined);
    const tap = vi.spyOn(core.adb, 'tap').mockResolvedValue(undefined);
    const swipe = vi.spyOn(core.adb, 'swipe').mockResolvedValue(undefined);
    const typeText = vi
      .spyOn(core.adb, 'typeText')
      .mockResolvedValue(undefined);
    const deepLink = vi
      .spyOn(core.adb, 'deepLink')
      .mockResolvedValue(undefined);
    const setPermission = vi
      .spyOn(core.adb, 'setPermission')
      .mockResolvedValue(undefined);
    vi.spyOn(core.adb, 'runtimePermissions')
      .mockResolvedValueOnce([
        { name: 'android.permission.CAMERA', granted: false },
      ])
      .mockResolvedValueOnce([
        { name: 'android.permission.CAMERA', granted: true },
      ]);

    await core.appLaunch();
    await core.tap({ x: 1, y: 2 });
    await core.swipe({ x: 1, y: 2 }, { x: 3, y: 4 });
    await core.typeText('fixture');
    await core.deepLink('fixture://safe');
    await expect(
      core.setPermission('android.permission.CAMERA', true, {
        confirmed: true,
      }),
    ).resolves.toMatchObject({
      previouslyGranted: false,
      verified: true,
      persistent: true,
    });

    expect(launch).toHaveBeenCalledWith(appId);
    expect(tap).toHaveBeenCalledWith({ x: 1, y: 2 });
    expect(swipe).toHaveBeenCalledWith({ x: 1, y: 2 }, { x: 3, y: 4 }, 500);
    expect(typeText).toHaveBeenCalledWith('fixture');
    expect(deepLink).toHaveBeenCalledWith(appId, 'fixture://safe');
    expect(setPermission).toHaveBeenCalledWith(
      appId,
      'android.permission.CAMERA',
      true,
    );
  });

  it('fails closed before Core dispatches active actions to a different device', async () => {
    const core = createCore(
      {
        mode: 'authorized-active',
        allowedActions: [
          'read',
          'app-state',
          'device-state',
          'persistent-permission',
        ],
        allowedAppIds: [appId],
        allowPersistentPermissionChanges: true,
        allowedPersistentPermissions: ['android.permission.CAMERA'],
      },
      'emulator-5556',
    );
    const launch = vi.spyOn(core.adb, 'launch');
    const setPermission = vi.spyOn(core.adb, 'setPermission');

    await expect(core.appLaunch()).rejects.toThrow(
      'selected ADB device to exactly match config.target.deviceId',
    );
    await expect(
      core.setPermission('android.permission.CAMERA', true, {
        confirmed: true,
      }),
    ).rejects.toThrow(
      'selected ADB device to exactly match config.target.deviceId',
    );

    expect(launch).not.toHaveBeenCalled();
    expect(setPermission).not.toHaveBeenCalled();
  });

  it('does not treat device-state as permission-change authorization', async () => {
    const core = createCore({
      mode: 'authorized-active',
      allowedActions: ['read', 'device-state'],
      allowedAppIds: [appId],
    });
    const setPermission = vi.spyOn(core.adb, 'setPermission');

    await expect(
      core.setPermission('android.permission.CAMERA', true, {
        confirmed: true,
      }),
    ).rejects.toThrow('persistent-permission');
    expect(setPermission).not.toHaveBeenCalled();
  });

  it('requires an explicit confirmation and verifies declared-before and desired-after state', async () => {
    const core = createCore({
      mode: 'authorized-active',
      allowedActions: ['read', 'persistent-permission'],
      allowedAppIds: [appId],
      allowPersistentPermissionChanges: true,
      allowedPersistentPermissions: ['android.permission.CAMERA'],
    });
    const setPermission = vi
      .spyOn(core.adb, 'setPermission')
      .mockResolvedValue(undefined);
    const runtimePermissions = vi.spyOn(core.adb, 'runtimePermissions');

    await expect(
      core.setPermission(
        'android.permission.CAMERA',
        true,
        {} as { confirmed: true },
      ),
    ).rejects.toMatchObject({
      code: 'PERSISTENT_PERMISSION_CONFIRMATION_REQUIRED',
    });
    expect(setPermission).not.toHaveBeenCalled();

    runtimePermissions.mockResolvedValueOnce([]);
    await expect(
      core.setPermission('android.permission.CAMERA', true, {
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_NOT_DECLARED' });
    expect(setPermission).not.toHaveBeenCalled();

    runtimePermissions
      .mockResolvedValueOnce([
        { name: 'android.permission.CAMERA', granted: false },
      ])
      .mockResolvedValueOnce([
        { name: 'android.permission.CAMERA', granted: false },
      ]);
    await expect(
      core.setPermission('android.permission.CAMERA', true, {
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_STATE_NOT_VERIFIED' });
    expect(setPermission).toHaveBeenCalledOnce();
  });

  it('leaves explicitly read-only permission inspection available by default', async () => {
    const core = createCore();
    vi.spyOn(core.adb, 'runtimePermissions').mockResolvedValue([
      { name: 'android.permission.CAMERA', granted: false },
    ]);

    await expect(core.listPermissions()).resolves.toEqual({
      appId,
      permissions: [{ name: 'android.permission.CAMERA', granted: false }],
    });
  });

  it('gates active security scenarios before they can dispatch mutations', async () => {
    const core = createCore();

    await expect(
      core.runMalformedDeepLinkSecurityScenario({
        scenarioId: 'safe-uri',
        kind: 'malformed-deep-link',
        appId,
        risk: 'app-state',
        ownership: 'owned',
        baseUri: 'fixture://safe',
        probes: [{ id: 'empty', mutation: 'empty-value', parameter: 'q' }],
        allowedScreenStates: ['content'],
        maximumErrorLogs: 0,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_NOT_AUTHORIZED' });
    await expect(
      core.runPermissionTransitionSecurityScenario({
        scenarioId: 'camera',
        kind: 'permission-transition',
        appId,
        risk: 'device-state',
        ownership: 'owned',
        permission: 'android.permission.CAMERA',
        probes: [
          {
            id: 'revoke',
            granted: false,
            allowedScreenStates: ['content'],
            maximumErrorLogs: 0,
          },
        ],
        timeoutMs: 1_000,
        cleanupTimeoutMs: 500,
      }),
    ).rejects.toMatchObject({ code: 'ACTION_NOT_AUTHORIZED' });
  });
});
