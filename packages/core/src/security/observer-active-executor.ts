import { randomUUID } from 'node:crypto';
import type { ObserverCore } from '../index.js';
import { ObserverError } from '../errors.js';
import type {
  ActiveSecurityAction,
  ActiveSecurityAuthorizationDecision,
  ActiveSecurityAuthorizationRequest,
  ActiveSecurityRawObservation,
  ActiveSecurityRisk,
  MalformedDeepLinkExecutor,
  PermissionTransitionMutation,
  PermissionTransitionRecovery,
  PermissionTransitionExecutor,
} from './active-scenario.js';

const AUTHORIZATION_TTL_MS = 60_000;

interface ActiveGrant {
  readonly appId: string;
  readonly action: ActiveSecurityAction;
  readonly risk: ActiveSecurityRisk;
  readonly expiresAt: number;
}

type AuthorizedInput = {
  appId: string;
  risk: ActiveSecurityRisk;
  authorizationId: string;
  signal: AbortSignal;
};

export class ObserverActiveSecurityExecutor
  implements MalformedDeepLinkExecutor, PermissionTransitionExecutor
{
  private readonly grants = new Map<string, ActiveGrant>();

  constructor(private readonly core: ObserverCore) {}

  async authorize(
    request: ActiveSecurityAuthorizationRequest,
  ): Promise<ActiveSecurityAuthorizationDecision> {
    if (request.signal.aborted) {
      return { authorized: false, reason: 'Authorization was cancelled' };
    }
    if (
      request.appId !== this.core.appId ||
      request.ownership !== 'owned' ||
      request.constraints.noLogin !== true ||
      request.constraints.noPurchase !== true ||
      request.constraints.noAccountMutation !== true ||
      request.constraints.noNetworkInterception !== true
    ) {
      return {
        authorized: false,
        reason:
          'The request was not bound to the configured owned app and safe active-scenario constraints',
      };
    }
    const expectedRisk: ActiveSecurityRisk =
      request.action === 'malformed-deep-link' ? 'app-state' : 'device-state';
    if (request.risk !== expectedRisk) {
      return {
        authorized: false,
        reason: `Action ${request.action} requires risk ${expectedRisk}`,
      };
    }
    try {
      this.core.assertActionAuthorized(
        request.action === 'malformed-deep-link'
          ? 'security-active-deep-link'
          : 'security-active-permission',
      );
    } catch (error) {
      return {
        authorized: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    const authorizationId = randomUUID();
    const expiresAt = Date.now() + AUTHORIZATION_TTL_MS;
    this.grants.set(authorizationId, {
      appId: request.appId,
      action: request.action,
      risk: request.risk,
      expiresAt,
    });
    return {
      authorized: true,
      authorizationId,
      appId: request.appId,
      action: request.action,
      risk: request.risk,
      ownedApp: true,
      allowlisted: true,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async openDeepLink(input: AuthorizedInput & { uri: string }): Promise<void> {
    this.assertGrant(input, 'malformed-deep-link');
    await this.core.adb.deepLink(input.appId, input.uri);
  }

  async getPermissionState(
    input: AuthorizedInput & { permission: string },
  ): Promise<boolean | null> {
    this.assertGrant(input, 'permission-transition');
    const permissions = await this.core.listPermissions();
    return (
      permissions.permissions.find(
        (permission) => permission.name === input.permission,
      )?.granted ?? null
    );
  }

  async setPermission(
    input: AuthorizedInput & { permission: string; granted: boolean },
  ): Promise<PermissionTransitionMutation> {
    this.assertGrant(input, 'permission-transition');
    const appState = await this.core.getAppState();
    const priorProcessId =
      appState.processRunning &&
      typeof appState.pid === 'number' &&
      Number.isInteger(appState.pid) &&
      appState.pid > 0
        ? appState.pid
        : null;
    await this.core.adb.setPermission(
      input.appId,
      input.permission,
      input.granted,
    );
    this.assertGrant(input, 'permission-transition');
    return { priorProcessId };
  }

  async recoverAfterPermissionChange(
    input: AuthorizedInput & {
      permission: string;
      priorProcessId: number | null;
    },
  ): Promise<PermissionTransitionRecovery> {
    this.assertGrant(input, 'permission-transition');
    const appState = await this.core.getAppState();
    if (appState.processRunning) return { status: 'not-needed' };
    if (input.priorProcessId === null) return { status: 'not-verified' };

    let exitStatus: Awaited<
      ReturnType<ObserverCore['adb']['permissionChangeExitStatus']>
    >;
    try {
      exitStatus = await this.core.adb.permissionChangeExitStatus(
        input.appId,
        input.priorProcessId,
      );
    } catch {
      return { status: 'not-verified' };
    }
    if (exitStatus === 'unavailable') return { status: 'not-verified' };
    if (exitStatus === 'unexpected') return { status: 'unexpected-exit' };

    this.assertGrant(input, 'permission-transition');
    try {
      await this.core.appLaunch();
    } catch (error) {
      return {
        status:
          error instanceof ObserverError &&
          error.code === 'ACTION_NOT_AUTHORIZED'
            ? 'not-verified'
            : 'relaunch-failed',
      };
    }
    this.assertGrant(input, 'permission-transition');
    return { status: 'recovered' };
  }

  async captureObservation(
    input: AuthorizedInput,
  ): Promise<ActiveSecurityRawObservation> {
    const grant = this.assertGrant(input);
    const [appState, screen, logs] = await Promise.all([
      this.core.getAppState(),
      this.core.understandScreen(),
      this.core.getLogs({ limit: 500 }),
    ]);
    this.assertGrant(input, grant.action);
    return {
      appId: input.appId,
      capturedAt: new Date().toISOString(),
      appState: {
        processRunning: appState.processRunning,
        appInForeground: appState.appInForeground,
      },
      screen: {
        state: screen.state,
        issueCodes: screen.issues.map((issue) => issue.code),
      },
      logs: logs.map((entry) => ({
        level: entry.level,
        source: entry.source,
        timestamp: entry.timestamp,
        message: entry.message,
      })),
    };
  }

  private assertGrant(
    input: AuthorizedInput,
    action?: ActiveSecurityAction,
  ): ActiveGrant {
    if (input.signal.aborted)
      throw new Error('Active security action was cancelled');
    const grant = this.grants.get(input.authorizationId);
    if (
      !grant ||
      grant.expiresAt <= Date.now() ||
      grant.appId !== input.appId ||
      grant.risk !== input.risk ||
      (action !== undefined && grant.action !== action)
    ) {
      throw new Error(
        'Active security authorization is missing, expired, or does not match the exact app/action/risk',
      );
    }
    return grant;
  }
}

export const createObserverActiveSecurityExecutor = (
  core: ObserverCore,
): ObserverActiveSecurityExecutor => new ObserverActiveSecurityExecutor(core);
