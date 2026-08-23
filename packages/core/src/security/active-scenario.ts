import { createHash } from 'node:crypto';
import type {
  AssuranceFinding,
  AssuranceOutcome,
  EvidenceReference,
  LogEntry,
  ScreenState,
  UiIssue,
} from '@rn-agent-observer/schemas';
import { redactDeepLinkUri } from '../privacy/deep-link.js';

export const MAX_ACTIVE_DEEP_LINK_PROBES = 6;
export const MAX_ACTIVE_PERMISSION_PROBES = 4;
export const MAX_ACTIVE_URI_CHARACTERS = 2048;
export const MAX_ACTIVE_SCENARIO_TIMEOUT_MS = 30_000;
export const MAX_ACTIVE_CLEANUP_TIMEOUT_MS = 10_000;
const POST_RECOVERY_REOBSERVE_DELAY_MS = 250;

export type ActiveSecurityRisk = 'app-state' | 'device-state';
export type ActiveSecurityAction =
  'malformed-deep-link' | 'permission-transition';

export interface ActiveSecurityAuthorizationRequest {
  scenarioId: string;
  action: ActiveSecurityAction;
  appId: string;
  risk: ActiveSecurityRisk;
  ownership: 'owned';
  constraints: {
    noLogin: true;
    noPurchase: true;
    noAccountMutation: true;
    noNetworkInterception: true;
  };
  target: {
    kind: 'uri' | 'permission';
    identifier: string;
  };
  signal: AbortSignal;
}

export type ActiveSecurityAuthorizationDecision =
  | {
      authorized: true;
      authorizationId: string;
      appId: string;
      action: ActiveSecurityAction;
      risk: ActiveSecurityRisk;
      ownedApp: true;
      allowlisted: true;
      expiresAt?: string;
    }
  | { authorized: false; reason?: string };

export interface ActiveSecurityAuthorizer {
  authorize(
    request: ActiveSecurityAuthorizationRequest,
  ): Promise<ActiveSecurityAuthorizationDecision>;
}

export interface ActiveSecurityRawLogMetadata {
  level: LogEntry['level'];
  source: string;
  timestamp: string;
  message?: string;
}

export interface ActiveSecurityRawObservation {
  appId: string;
  capturedAt: string;
  appState?: {
    processRunning: boolean;
    appInForeground: boolean;
  };
  screen?: {
    state: ScreenState;
    issueCodes?: UiIssue['code'][];
  };
  logs?: ActiveSecurityRawLogMetadata[];
}

export interface ActiveSecurityObservationMetadata {
  appId: string | null;
  capturedAt: string | null;
  appState: {
    processRunning: boolean;
    appInForeground: boolean;
  } | null;
  screen: {
    state: ScreenState;
    issueCodes: UiIssue['code'][];
  } | null;
  logs: {
    count: number;
    errorCount: number;
    fatalCount: number;
    sources: string[];
    messageFingerprints: string[];
  } | null;
}

export interface PermissionTransitionMutation {
  priorProcessId: number | null;
}

export interface PermissionTransitionRecovery {
  status:
    | 'not-needed'
    | 'recovered'
    | 'not-verified'
    | 'unexpected-exit'
    | 'relaunch-failed';
}

interface AuthorizedActionInput {
  appId: string;
  risk: ActiveSecurityRisk;
  authorizationId: string;
  signal: AbortSignal;
}

export interface MalformedDeepLinkExecutor extends ActiveSecurityAuthorizer {
  openDeepLink(input: AuthorizedActionInput & { uri: string }): Promise<void>;
  captureObservation(
    input: AuthorizedActionInput,
  ): Promise<ActiveSecurityRawObservation>;
}

export interface PermissionTransitionExecutor extends ActiveSecurityAuthorizer {
  getPermissionState(
    input: AuthorizedActionInput & { permission: string },
  ): Promise<boolean | null>;
  setPermission(
    input: AuthorizedActionInput & {
      permission: string;
      granted: boolean;
    },
  ): Promise<PermissionTransitionMutation | void>;
  recoverAfterPermissionChange?(
    input: AuthorizedActionInput & {
      permission: string;
      priorProcessId: number | null;
    },
  ): Promise<PermissionTransitionRecovery>;
  captureObservation(
    input: AuthorizedActionInput,
  ): Promise<ActiveSecurityRawObservation>;
}

export type MalformedDeepLinkMutation =
  | 'empty-value'
  | 'duplicate-parameter'
  | 'invalid-percent-encoding'
  | 'oversized-value'
  | 'unexpected-parameter';

export interface MalformedDeepLinkProbe {
  id: string;
  mutation: MalformedDeepLinkMutation;
  parameter: string;
}

export interface MalformedDeepLinkScenario {
  scenarioId: string;
  kind: 'malformed-deep-link';
  appId: string;
  risk: 'app-state';
  ownership: 'owned';
  baseUri: string;
  probes: MalformedDeepLinkProbe[];
  allowedScreenStates: ScreenState[];
  maximumErrorLogs: number;
  timeoutMs: number;
  settleMs?: number;
}

export interface PermissionTransitionProbe {
  id: string;
  granted: boolean;
  allowedScreenStates: ScreenState[];
  maximumErrorLogs: number;
}

export interface PermissionTransitionScenario {
  scenarioId: string;
  kind: 'permission-transition';
  appId: string;
  risk: 'device-state';
  ownership: 'owned';
  permission: string;
  probes: PermissionTransitionProbe[];
  timeoutMs: number;
  cleanupTimeoutMs: number;
  settleMs?: number;
}

export interface ActiveSecurityProbeResult {
  id: string;
  appId: string;
  risk: ActiveSecurityRisk;
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  target: string;
  observation: ActiveSecurityObservationMetadata | null;
  recovery?: PermissionTransitionRecovery;
  recoveryObservationAttempts?: number;
  evidence: EvidenceReference[];
  reason: string;
}

export interface ActiveSecurityCleanupResult {
  status: 'restored' | 'not-needed' | 'failed' | 'not-verified';
  attempted: boolean;
  originalPermissionState: boolean | null;
  observedPermissionState: boolean | null;
  recovery?: PermissionTransitionRecovery;
  evidence: EvidenceReference[];
  reason: string;
}

export interface ActiveSecurityScenarioResult {
  schemaVersion: '1.0';
  analyzer: 'security.active-scenario';
  analyzedAt: string;
  scenarioId: string;
  kind: ActiveSecurityAction;
  appId: string;
  risk: ActiveSecurityRisk;
  authorization: 'authorized' | 'denied-or-invalid';
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  evidence: EvidenceReference[];
  findings: AssuranceFinding[];
  probes: ActiveSecurityProbeResult[];
  cleanup?: ActiveSecurityCleanupResult;
  limitations: string[];
}

interface BoundedSignal {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

interface AuthorizationSuccess {
  authorizationId: string;
}

interface ProbeEvaluation {
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  reason: string;
  severity: AssuranceFinding['severity'];
  limitation?: string;
  remediation?: string;
}

const FORBIDDEN_URI_SEMANTICS =
  /account|auth|checkout|delete|login|logout|oauth|order|password|payment|profile|purchase|register|reset|signin|signup|subscribe|transfer/iu;
const FORBIDDEN_URI_PROTOCOLS = new Set([
  'data:',
  'file:',
  'intent:',
  'javascript:',
]);
const SAFE_APP_ID = /^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/u;
const SAFE_PARAMETER = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/u;
const SAFE_PERMISSION = /^android\.permission\.[A-Z][A-Z0-9_]{1,80}$/u;
const SCREEN_STATES = new Set<ScreenState>([
  'not-running',
  'background',
  'blank',
  'loading',
  'error',
  'empty',
  'content',
]);
const UI_ISSUE_CODES = new Set<UiIssue['code']>([
  'runtime-error-text',
  'runtime-log-error',
  'blank-screen',
  'loading-state',
  'loading-stuck',
  'empty-state',
  'unlabeled-control',
  'small-touch-target',
  'duplicate-test-id',
  'zero-size-control',
  'offscreen-control',
]);
const LOG_LEVELS = new Set<LogEntry['level']>([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

const activeOutcome = (
  findings: readonly AssuranceFinding[],
): ActiveSecurityScenarioResult['outcome'] => {
  if (findings.some((finding) => finding.outcome === 'FAIL')) return 'FAIL';
  if (findings.some((finding) => finding.outcome === 'NOT_VERIFIED')) {
    return 'NOT_VERIFIED';
  }
  return 'PASS';
};

const boundedSignal = (
  timeoutMs: number,
  external?: AbortSignal,
): BoundedSignal => {
  const controller = new AbortController();
  let timeoutReached = false;
  const onExternalAbort = () => controller.abort('external-abort');
  if (external?.aborted) controller.abort('external-abort');
  else external?.addEventListener('abort', onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort('timeout');
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
};

const abortReason = (signal: AbortSignal, timedOut: boolean): string =>
  timedOut
    ? 'The bounded active-security scenario timed out.'
    : signal.aborted
      ? 'The active-security scenario was aborted.'
      : 'The active-security executor did not complete the requested operation.';

const invoke = async <T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
): Promise<T> => {
  if (signal.aborted) throw new Error('ACTIVE_SCENARIO_ABORTED');
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() => reject(new Error('ACTIVE_SCENARIO_ABORTED')));
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        () => finish(() => reject(new Error('ACTIVE_SCENARIO_EXECUTOR_ERROR'))),
      );
  });
};

const delay = async (
  durationMs: number,
  signal: AbortSignal,
): Promise<void> => {
  if (durationMs <= 0) return;
  await invoke(
    signal,
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, durationMs);
        signal.addEventListener('abort', () => clearTimeout(timer), {
          once: true,
        });
      }),
  );
};

const redactMessage = (value: string): string =>
  value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
      '[REDACTED]',
    )
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(?:authorization|cookie|credential|password|secret|session|sid|token)\s*[:=]\s*\S+/giu,
      '[REDACTED]',
    )
    .replace(/(^|[?&\s])([a-zA-Z0-9_.-]+)=([^&\s]+)/gu, '$1$2=[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, '[REDACTED]')
    .slice(0, 240);

const safeSource = (value: string): string => {
  const redacted = redactMessage(value);
  if (redacted.includes('[REDACTED]')) return 'redacted';
  return redacted.replace(/[^a-zA-Z0-9_.-]/gu, '-').slice(0, 80) || 'unknown';
};

const safeTimestamp = (value: string): string | null =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value
    : null;

/** A stack frame is supporting detail for the preceding error, not another error event. */
const isStackTraceContinuation = (message: string | undefined): boolean =>
  message !== undefined &&
  (/^\s*at\s/u.test(message) ||
    /^[^:]+:\s+at\s/u.test(message) ||
    /^\s*\.\.\.\s+\d+\s+more\b/u.test(message));

/**
 * Logcat prints one ReactHost soft exception as a summary line, a detail line,
 * and many stack frames. Keep the summary as the event and omit only its
 * timestamp/source-matched detail so the configured limit measures events.
 */
const errorEvents = (
  logs: readonly ActiveSecurityRawLogMetadata[],
): ActiveSecurityRawLogMetadata[] => {
  const events: ActiveSecurityRawLogMetadata[] = [];
  for (const entry of logs) {
    if (
      (entry.level !== 'error' && entry.level !== 'fatal') ||
      isStackTraceContinuation(entry.message)
    ) {
      continue;
    }
    const previous = events.at(-1);
    if (
      entry.level === 'error' &&
      previous?.level === 'error' &&
      previous.source === entry.source &&
      previous.timestamp === entry.timestamp &&
      previous.message === 'ReactHost: Unhandled SoftException' &&
      entry.message?.startsWith(
        'ReactHost: com.facebook.react.bridge.ReactNoCrashSoftException:',
      )
    ) {
      continue;
    }
    events.push(entry);
  }
  return events;
};

const structuredObservation = (
  raw: ActiveSecurityRawObservation,
  expectedAppId: string,
): ActiveSecurityObservationMetadata => {
  const validLogs =
    raw.logs &&
    raw.logs.every(
      (entry) =>
        LOG_LEVELS.has(entry.level) &&
        typeof entry.source === 'string' &&
        entry.source.length > 0 &&
        safeTimestamp(entry.timestamp) !== null &&
        (entry.message === undefined || typeof entry.message === 'string'),
    )
      ? raw.logs
      : null;
  const errorLogs = validLogs ? errorEvents(validLogs) : null;
  const validAppState =
    raw.appState &&
    typeof raw.appState.processRunning === 'boolean' &&
    typeof raw.appState.appInForeground === 'boolean'
      ? raw.appState
      : null;
  const validScreen =
    raw.screen &&
    SCREEN_STATES.has(raw.screen.state) &&
    (raw.screen.issueCodes === undefined ||
      raw.screen.issueCodes.every((code) => UI_ISSUE_CODES.has(code)))
      ? raw.screen
      : null;
  return {
    appId: raw.appId === expectedAppId ? raw.appId : null,
    capturedAt: safeTimestamp(raw.capturedAt),
    appState: validAppState
      ? {
          processRunning: validAppState.processRunning,
          appInForeground: validAppState.appInForeground,
        }
      : null,
    screen: validScreen
      ? {
          state: validScreen.state,
          issueCodes: validScreen.issueCodes ?? [],
        }
      : null,
    logs: validLogs
      ? {
          count: validLogs.length,
          errorCount: errorLogs?.length ?? 0,
          fatalCount:
            errorLogs?.filter((entry) => entry.level === 'fatal').length ?? 0,
          sources: [
            ...new Set(validLogs.map((entry) => safeSource(entry.source))),
          ].slice(0, 20),
          messageFingerprints: validLogs
            .filter((entry) => entry.message !== undefined)
            .slice(0, 20)
            .map((entry) =>
              createHash('sha256')
                .update(redactMessage(entry.message ?? ''))
                .digest('hex')
                .slice(0, 16),
            ),
        }
      : null,
  };
};

const evidenceFor = (
  scenarioId: string,
  probeId: string,
  kind: string,
  payload: unknown,
): EvidenceReference => {
  const sha256 = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  return {
    id: `active-security-${scenarioId}-${probeId}-${sha256.slice(0, 12)}`,
    kind,
    relation: 'supports',
    sha256,
  };
};

const findingFor = (input: {
  scenarioId: string;
  probeId: string;
  ruleId: string;
  title: string;
  evaluation: ProbeEvaluation;
  evidence: EvidenceReference[];
}): AssuranceFinding => ({
  schemaVersion: '1.0',
  id: `security.active.${input.scenarioId}.${input.probeId}`,
  ruleId: input.ruleId,
  title: input.title,
  description: input.evaluation.reason,
  outcome: input.evaluation.outcome,
  severity: input.evaluation.severity,
  confidence: input.evaluation.outcome === 'NOT_VERIFIED' ? 1 : 0.95,
  category: 'security',
  controls: [],
  evidence: input.evidence,
  ...(input.evaluation.remediation
    ? { remediation: input.evaluation.remediation }
    : {}),
  limitations: input.evaluation.limitation ? [input.evaluation.limitation] : [],
});

const validateCommon = (input: {
  scenarioId: string;
  appId: string;
  timeoutMs: number;
  settleMs?: number;
}): void => {
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/u.test(input.scenarioId)) {
    throw new TypeError('scenarioId must be a bounded safe identifier');
  }
  if (!SAFE_APP_ID.test(input.appId) || input.appId.length > 200) {
    throw new TypeError('appId must be an explicit application identifier');
  }
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 25 ||
    input.timeoutMs > MAX_ACTIVE_SCENARIO_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be between 25 and ${MAX_ACTIVE_SCENARIO_TIMEOUT_MS}`,
    );
  }
  const settleMs = input.settleMs ?? 0;
  if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 2_000) {
    throw new RangeError('settleMs must be between 0 and 2000');
  }
};

const validateProbeIds = (probes: readonly { id: string }[]): void => {
  const ids = new Set<string>();
  for (const probe of probes) {
    if (!/^[a-z0-9][a-z0-9._-]{0,80}$/u.test(probe.id)) {
      throw new TypeError('probe id must be a bounded safe identifier');
    }
    if (ids.has(probe.id))
      throw new TypeError(`Duplicate probe id: ${probe.id}`);
    ids.add(probe.id);
  }
};

const authorize = async (
  executor: ActiveSecurityAuthorizer,
  request: Omit<ActiveSecurityAuthorizationRequest, 'signal'>,
  signal: AbortSignal,
): Promise<AuthorizationSuccess | null> => {
  const decision = await invoke(signal, () =>
    executor.authorize({ ...request, signal }),
  );
  if (!decision.authorized) return null;
  if (
    !decision.authorizationId.trim() ||
    decision.appId !== request.appId ||
    decision.action !== request.action ||
    decision.risk !== request.risk ||
    decision.ownedApp !== true ||
    decision.allowlisted !== true
  ) {
    return null;
  }
  if (
    decision.expiresAt !== undefined &&
    (!Number.isFinite(Date.parse(decision.expiresAt)) ||
      Date.parse(decision.expiresAt) <= Date.now())
  ) {
    return null;
  }
  return { authorizationId: decision.authorizationId };
};

const authorizationRequest = (input: {
  scenarioId: string;
  action: ActiveSecurityAction;
  appId: string;
  risk: ActiveSecurityRisk;
  target: ActiveSecurityAuthorizationRequest['target'];
}): Omit<ActiveSecurityAuthorizationRequest, 'signal'> => ({
  ...input,
  ownership: 'owned',
  constraints: {
    noLogin: true,
    noPurchase: true,
    noAccountMutation: true,
    noNetworkInterception: true,
  },
});

const deniedResult = (input: {
  scenarioId: string;
  kind: ActiveSecurityAction;
  appId: string;
  risk: ActiveSecurityRisk;
  reason: string;
}): ActiveSecurityScenarioResult => {
  const evaluation: ProbeEvaluation = {
    outcome: 'NOT_VERIFIED',
    reason: input.reason,
    severity: 'high',
    limitation: input.reason,
  };
  const finding = findingFor({
    scenarioId: input.scenarioId,
    probeId: 'authorization',
    ruleId: 'security.active.authorization',
    title: 'Active security action was explicitly authorized',
    evaluation,
    evidence: [],
  });
  return {
    schemaVersion: '1.0',
    analyzer: 'security.active-scenario',
    analyzedAt: new Date().toISOString(),
    scenarioId: input.scenarioId,
    kind: input.kind,
    appId: input.appId,
    risk: input.risk,
    authorization: 'denied-or-invalid',
    outcome: 'NOT_VERIFIED',
    evidence: [],
    findings: [finding],
    probes: [],
    limitations: [
      input.reason,
      'No login, purchase, account mutation, or network interception action was permitted.',
    ],
  };
};

const evaluateObservation = (
  observation: ActiveSecurityObservationMetadata,
  allowedScreenStates: readonly ScreenState[],
  maximumErrorLogs: number,
): ProbeEvaluation => {
  if (!observation.appId) {
    const reason =
      'Structured observation metadata was not bound to the target appId.';
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      severity: 'high',
      limitation: reason,
    };
  }
  if (!observation.capturedAt) {
    const reason = 'A valid structured capture timestamp was not provided.';
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      severity: 'high',
      limitation: reason,
    };
  }
  if (!observation.appState) {
    const reason = 'Structured app-state metadata was not captured.';
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      severity: 'high',
      limitation: reason,
    };
  }
  if (!observation.appState.processRunning) {
    return {
      outcome: 'FAIL',
      reason: 'The owned application process was not running after the probe.',
      severity: 'critical',
      remediation:
        'Inspect protected crash evidence and make malformed-input handling fail safely before repeating the probe.',
    };
  }
  if (!observation.screen) {
    const reason = 'Structured screen-state metadata was not captured.';
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      severity: 'high',
      limitation: reason,
    };
  }
  if (!observation.logs) {
    const reason = 'Structured log metadata was not captured.';
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      severity: 'high',
      limitation: reason,
    };
  }
  if (
    observation.logs.fatalCount > 0 ||
    observation.logs.errorCount > maximumErrorLogs
  ) {
    return {
      outcome: 'FAIL',
      reason: `${observation.logs.errorCount} error and ${observation.logs.fatalCount} fatal entries exceeded the explicit limit ${maximumErrorLogs}; messages were omitted.`,
      severity: observation.logs.fatalCount > 0 ? 'critical' : 'high',
      remediation:
        'Inspect the protected log source and handle the malformed/permission state without unbounded runtime errors.',
    };
  }
  if (!allowedScreenStates.includes(observation.screen.state)) {
    return {
      outcome: 'FAIL',
      reason: `Observed screen state ${observation.screen.state}; the explicit allowed set was ${allowedScreenStates.join(', ')}.`,
      severity: 'high',
      remediation:
        'Return the owned app to an explicitly allowed safe screen state; route is intentionally not inferred.',
    };
  }
  return {
    outcome: 'PASS',
    reason: `Process, structured logs, and declared screen-state evidence satisfied the bounded probe expectation.`,
    severity: 'info',
  };
};

const uniqueEvidence = (
  references: readonly EvidenceReference[],
): EvidenceReference[] => [
  ...new Map(references.map((reference) => [reference.id, reference])).values(),
];

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const redactedUri = (value: string): string => redactDeepLinkUri(value).uri;

const rawQueryAppend = (uri: string, pair: string): string => {
  const fragmentIndex = uri.indexOf('#');
  const body = fragmentIndex >= 0 ? uri.slice(0, fragmentIndex) : uri;
  const fragment = fragmentIndex >= 0 ? uri.slice(fragmentIndex) : '';
  return `${body}${body.includes('?') ? '&' : '?'}${pair}${fragment}`;
};

const buildMalformedUri = (
  baseUri: string,
  probe: MalformedDeepLinkProbe,
): string => {
  if (probe.mutation === 'invalid-percent-encoding') {
    return rawQueryAppend(baseUri, `${probe.parameter}=%ZZ`);
  }
  const url = new URL(baseUri);
  if (probe.mutation === 'empty-value') {
    url.searchParams.append(probe.parameter, '');
  } else if (probe.mutation === 'duplicate-parameter') {
    url.searchParams.append(probe.parameter, 'observer-a');
    url.searchParams.append(probe.parameter, 'observer-b');
  } else if (probe.mutation === 'oversized-value') {
    url.searchParams.append(probe.parameter, 'x'.repeat(256));
  } else {
    url.searchParams.append(probe.parameter, 'observer-unexpected');
  }
  return url.toString();
};

const validateDeepLinkScenario = (
  scenario: MalformedDeepLinkScenario,
): Array<MalformedDeepLinkProbe & { uri: string }> => {
  validateCommon(scenario);
  if (
    scenario.kind !== 'malformed-deep-link' ||
    scenario.risk !== 'app-state' ||
    scenario.ownership !== 'owned'
  ) {
    throw new TypeError(
      'Malformed deep-link scenario must declare owned/app-state risk',
    );
  }
  if (
    scenario.probes.length < 1 ||
    scenario.probes.length > MAX_ACTIVE_DEEP_LINK_PROBES
  ) {
    throw new RangeError(
      `Malformed deep-link probes must contain 1-${MAX_ACTIVE_DEEP_LINK_PROBES} entries`,
    );
  }
  validateProbeIds(scenario.probes);
  if (scenario.allowedScreenStates.length === 0) {
    throw new TypeError('allowedScreenStates must be explicit and non-empty');
  }
  if (
    !Number.isInteger(scenario.maximumErrorLogs) ||
    scenario.maximumErrorLogs < 0 ||
    scenario.maximumErrorLogs > 20
  ) {
    throw new RangeError(
      'maximumErrorLogs must be an integer between 0 and 20',
    );
  }
  if (
    !scenario.baseUri ||
    scenario.baseUri.length > 1_024 ||
    [...scenario.baseUri].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    throw new TypeError('baseUri must be a bounded URI without control bytes');
  }
  let parsed: URL;
  try {
    parsed = new URL(scenario.baseUri);
  } catch {
    throw new TypeError('baseUri must be an absolute URI');
  }
  if (
    FORBIDDEN_URI_PROTOCOLS.has(parsed.protocol.toLowerCase()) ||
    parsed.username ||
    parsed.password
  ) {
    throw new TypeError('baseUri uses a prohibited protocol or credentials');
  }
  const semanticSurface = safeDecode(
    `${parsed.hostname} ${parsed.pathname} ${parsed.hash} ${[
      ...parsed.searchParams.keys(),
    ].join(' ')} ${[...parsed.searchParams.values()].join(' ')}`,
  );
  if (FORBIDDEN_URI_SEMANTICS.test(semanticSurface)) {
    throw new TypeError(
      'Active deep-link probes cannot target login, purchase, account, or credential semantics',
    );
  }
  const generated = scenario.probes.map((probe) => {
    if (
      !SAFE_PARAMETER.test(probe.parameter) ||
      FORBIDDEN_URI_SEMANTICS.test(probe.parameter)
    ) {
      throw new TypeError(`Unsafe deep-link parameter for probe ${probe.id}`);
    }
    const uri = buildMalformedUri(scenario.baseUri, probe);
    if (uri.length > MAX_ACTIVE_URI_CHARACTERS) {
      throw new RangeError(
        `Generated URI for probe ${probe.id} exceeds ${MAX_ACTIVE_URI_CHARACTERS} characters`,
      );
    }
    return { ...probe, uri };
  });
  return generated;
};

const skippedProbe = (input: {
  scenarioId: string;
  appId: string;
  risk: ActiveSecurityRisk;
  probeId: string;
  target: string;
  reason: string;
  ruleId: string;
  title: string;
}): {
  probe: ActiveSecurityProbeResult;
  finding: AssuranceFinding;
} => {
  const evaluation: ProbeEvaluation = {
    outcome: 'NOT_VERIFIED',
    reason: input.reason,
    severity: 'high',
    limitation: input.reason,
  };
  return {
    probe: {
      id: input.probeId,
      appId: input.appId,
      risk: input.risk,
      outcome: 'NOT_VERIFIED',
      target: input.target,
      observation: null,
      evidence: [],
      reason: input.reason,
    },
    finding: findingFor({
      scenarioId: input.scenarioId,
      probeId: input.probeId,
      ruleId: input.ruleId,
      title: input.title,
      evaluation,
      evidence: [],
    }),
  };
};

export async function runMalformedDeepLinkScenario(
  scenario: MalformedDeepLinkScenario,
  executor: MalformedDeepLinkExecutor,
  externalSignal?: AbortSignal,
): Promise<ActiveSecurityScenarioResult> {
  const generated = validateDeepLinkScenario(scenario);
  const bounded = boundedSignal(scenario.timeoutMs, externalSignal);
  const findings: AssuranceFinding[] = [];
  const probes: ActiveSecurityProbeResult[] = [];
  const evidence: EvidenceReference[] = [];
  try {
    let authorization: AuthorizationSuccess | null;
    try {
      const parsed = new URL(scenario.baseUri);
      const safeTarget = new URL(redactedUri(scenario.baseUri));
      authorization = await authorize(
        executor,
        authorizationRequest({
          scenarioId: scenario.scenarioId,
          action: scenario.kind,
          appId: scenario.appId,
          risk: scenario.risk,
          target: {
            kind: 'uri',
            identifier:
              `${parsed.protocol}//${parsed.host}${safeTarget.pathname}`.slice(
                0,
                512,
              ),
          },
        }),
        bounded.signal,
      );
    } catch {
      return deniedResult({
        scenarioId: scenario.scenarioId,
        kind: scenario.kind,
        appId: scenario.appId,
        risk: scenario.risk,
        reason: abortReason(bounded.signal, bounded.timedOut()),
      });
    }
    if (!authorization) {
      return deniedResult({
        scenarioId: scenario.scenarioId,
        kind: scenario.kind,
        appId: scenario.appId,
        risk: scenario.risk,
        reason:
          'Authorization did not prove that the exact app/action/risk was owned and allowlisted.',
      });
    }
    const context = {
      appId: scenario.appId,
      risk: scenario.risk,
      authorizationId: authorization.authorizationId,
    } as const;
    let baseline: ActiveSecurityObservationMetadata;
    try {
      baseline = structuredObservation(
        await invoke(bounded.signal, () =>
          executor.captureObservation({ ...context, signal: bounded.signal }),
        ),
        scenario.appId,
      );
    } catch {
      const reason = abortReason(bounded.signal, bounded.timedOut());
      const skipped = generated.map((probe) =>
        skippedProbe({
          scenarioId: scenario.scenarioId,
          appId: scenario.appId,
          risk: scenario.risk,
          probeId: probe.id,
          target: redactedUri(probe.uri),
          reason,
          ruleId: 'security.active.deep-link-malformed',
          title: 'Owned app safely handles a bounded malformed deep link',
        }),
      );
      findings.push(...skipped.map((entry) => entry.finding));
      probes.push(...skipped.map((entry) => entry.probe));
      return {
        schemaVersion: '1.0',
        analyzer: 'security.active-scenario',
        analyzedAt: new Date().toISOString(),
        scenarioId: scenario.scenarioId,
        kind: scenario.kind,
        appId: scenario.appId,
        risk: scenario.risk,
        authorization: 'authorized',
        outcome: 'NOT_VERIFIED',
        evidence: [],
        findings,
        probes,
        limitations: [reason],
      };
    }
    const baselineEvidence = evidenceFor(
      scenario.scenarioId,
      'baseline',
      'active-security-observation',
      baseline,
    );
    evidence.push(baselineEvidence);
    if (
      !baseline.appId ||
      !baseline.capturedAt ||
      !baseline.appState?.processRunning
    ) {
      const reason =
        'A timestamped baseline bound to the running owned app was not confirmed; no deep link was opened.';
      const skipped = generated.map((probe) =>
        skippedProbe({
          scenarioId: scenario.scenarioId,
          appId: scenario.appId,
          risk: scenario.risk,
          probeId: probe.id,
          target: redactedUri(probe.uri),
          reason,
          ruleId: 'security.active.deep-link-malformed',
          title: 'Owned app safely handles a bounded malformed deep link',
        }),
      );
      findings.push(...skipped.map((entry) => entry.finding));
      probes.push(...skipped.map((entry) => entry.probe));
    } else {
      let stoppedAt = generated.length;
      for (const [index, probe] of generated.entries()) {
        try {
          await invoke(bounded.signal, () =>
            executor.openDeepLink({
              ...context,
              uri: probe.uri,
              signal: bounded.signal,
            }),
          );
          await delay(scenario.settleMs ?? 0, bounded.signal);
          const observation = structuredObservation(
            await invoke(bounded.signal, () =>
              executor.captureObservation({
                ...context,
                signal: bounded.signal,
              }),
            ),
            scenario.appId,
          );
          const reference = evidenceFor(
            scenario.scenarioId,
            probe.id,
            'active-security-deep-link-probe',
            {
              mutation: probe.mutation,
              uriSha256: createHash('sha256').update(probe.uri).digest('hex'),
              observation,
            },
          );
          evidence.push(reference);
          const evaluation = evaluateObservation(
            observation,
            scenario.allowedScreenStates,
            scenario.maximumErrorLogs,
          );
          findings.push(
            findingFor({
              scenarioId: scenario.scenarioId,
              probeId: probe.id,
              ruleId: 'security.active.deep-link-malformed',
              title: 'Owned app safely handles a bounded malformed deep link',
              evaluation,
              evidence: [reference],
            }),
          );
          probes.push({
            id: probe.id,
            appId: scenario.appId,
            risk: scenario.risk,
            outcome: evaluation.outcome,
            target: redactedUri(probe.uri),
            observation,
            evidence: [reference],
            reason: evaluation.reason,
          });
        } catch {
          const reason = abortReason(bounded.signal, bounded.timedOut());
          const skipped = skippedProbe({
            scenarioId: scenario.scenarioId,
            appId: scenario.appId,
            risk: scenario.risk,
            probeId: probe.id,
            target: redactedUri(probe.uri),
            reason,
            ruleId: 'security.active.deep-link-malformed',
            title: 'Owned app safely handles a bounded malformed deep link',
          });
          findings.push(skipped.finding);
          probes.push(skipped.probe);
          stoppedAt = index + 1;
          break;
        }
      }
      for (const probe of generated.slice(stoppedAt)) {
        const reason =
          'Probe was not run after an earlier bounded operation stopped.';
        const skipped = skippedProbe({
          scenarioId: scenario.scenarioId,
          appId: scenario.appId,
          risk: scenario.risk,
          probeId: probe.id,
          target: redactedUri(probe.uri),
          reason,
          ruleId: 'security.active.deep-link-malformed',
          title: 'Owned app safely handles a bounded malformed deep link',
        });
        findings.push(skipped.finding);
        probes.push(skipped.probe);
      }
    }
    return {
      schemaVersion: '1.0',
      analyzer: 'security.active-scenario',
      analyzedAt: new Date().toISOString(),
      scenarioId: scenario.scenarioId,
      kind: scenario.kind,
      appId: scenario.appId,
      risk: scenario.risk,
      authorization: 'authorized',
      outcome: activeOutcome(findings),
      evidence: uniqueEvidence(evidence),
      findings,
      probes,
      limitations: [
        'Only bounded malformed query mutations were dispatched to the explicitly owned and allowlisted app.',
        'No route meaning, login, purchase, account mutation, or network interception behavior was inferred or exercised.',
        'Executor implementations must honor AbortSignal before resolving mutating actions.',
      ],
    };
  } finally {
    bounded.dispose();
  }
}

const validatePermissionScenario = (
  scenario: PermissionTransitionScenario,
): void => {
  validateCommon(scenario);
  if (
    scenario.kind !== 'permission-transition' ||
    scenario.risk !== 'device-state' ||
    scenario.ownership !== 'owned'
  ) {
    throw new TypeError(
      'Permission scenario must declare owned/device-state risk',
    );
  }
  if (
    !SAFE_PERMISSION.test(scenario.permission) ||
    /(?:ACCOUNT|AUTHENTICATE_ACCOUNTS|MANAGE_ACCOUNTS|USE_CREDENTIALS)/u.test(
      scenario.permission,
    )
  ) {
    throw new TypeError(
      'permission must be a bounded Android runtime permission outside account semantics',
    );
  }
  if (
    scenario.probes.length < 1 ||
    scenario.probes.length > MAX_ACTIVE_PERMISSION_PROBES
  ) {
    throw new RangeError(
      `Permission probes must contain 1-${MAX_ACTIVE_PERMISSION_PROBES} entries`,
    );
  }
  validateProbeIds(scenario.probes);
  for (const probe of scenario.probes) {
    if (probe.allowedScreenStates.length === 0) {
      throw new TypeError(
        `Permission probe ${probe.id} must declare allowedScreenStates`,
      );
    }
    if (
      !Number.isInteger(probe.maximumErrorLogs) ||
      probe.maximumErrorLogs < 0 ||
      probe.maximumErrorLogs > 20
    ) {
      throw new RangeError(
        `Permission probe ${probe.id} maximumErrorLogs must be between 0 and 20`,
      );
    }
  }
  if (
    !Number.isInteger(scenario.cleanupTimeoutMs) ||
    scenario.cleanupTimeoutMs < 25 ||
    scenario.cleanupTimeoutMs > MAX_ACTIVE_CLEANUP_TIMEOUT_MS
  ) {
    throw new RangeError(
      `cleanupTimeoutMs must be between 25 and ${MAX_ACTIVE_CLEANUP_TIMEOUT_MS}`,
    );
  }
};

const permissionTarget = (permission: string, granted: boolean): string =>
  `${permission} -> ${granted ? 'granted' : 'revoked'}`;

const recoverAfterPermissionChange = async (
  executor: PermissionTransitionExecutor,
  input: AuthorizedActionInput & {
    permission: string;
    priorProcessId: number | null;
  },
): Promise<PermissionTransitionRecovery | undefined> => {
  if (!executor.recoverAfterPermissionChange) return undefined;
  return await invoke(input.signal, () =>
    executor.recoverAfterPermissionChange!(input),
  );
};

const permissionRecoveryEvaluation = (
  recovery: PermissionTransitionRecovery | undefined,
): ProbeEvaluation | undefined => {
  if (recovery?.status === 'not-verified') {
    const reason =
      'The process stopped after a permission transition, but its Android exit reason was not verified; it was not relaunched.';
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      severity: 'high',
      limitation: reason,
    };
  }
  if (recovery?.status === 'unexpected-exit') {
    return {
      outcome: 'FAIL',
      reason:
        'The owned application stopped with an unexpected exit reason after the permission transition.',
      severity: 'critical',
      remediation:
        'Inspect protected crash or ANR evidence before repeating the explicitly scoped transition.',
    };
  }
  if (recovery?.status === 'relaunch-failed') {
    return {
      outcome: 'FAIL',
      reason:
        'The owned application could not be relaunched after a verified permission-change termination.',
      severity: 'critical',
      remediation:
        'Restore the owned app to a runnable state before repeating the explicitly scoped transition.',
    };
  }
  return undefined;
};

const withPermissionRecoveryLimitation = (
  evaluation: ProbeEvaluation,
  recovery: PermissionTransitionRecovery | undefined,
): ProbeEvaluation =>
  recovery?.status === 'recovered' && evaluation.outcome === 'PASS'
    ? {
        ...evaluation,
        limitation:
          'Android reported a matching permission-change process termination; the exact authorized app was relaunched before this fresh observation.',
      }
    : evaluation;

const cleanupPermission = async (
  scenario: PermissionTransitionScenario,
  executor: PermissionTransitionExecutor,
  authorizationId: string,
  originalState: boolean,
): Promise<{
  cleanup: ActiveSecurityCleanupResult;
  finding: AssuranceFinding;
}> => {
  const bounded = boundedSignal(scenario.cleanupTimeoutMs);
  const context = {
    appId: scenario.appId,
    risk: scenario.risk,
    authorizationId,
  } as const;
  let setCompleted = false;
  let observed: boolean | null = null;
  let recovery: PermissionTransitionRecovery | undefined;
  let status: ActiveSecurityCleanupResult['status'];
  let reason: string;
  let evaluation: ProbeEvaluation;
  let stage = 'the permission restore action';
  try {
    stage = 'the permission restore action';
    const mutation = await invoke(bounded.signal, () =>
      executor.setPermission({
        ...context,
        permission: scenario.permission,
        granted: originalState,
        signal: bounded.signal,
      }),
    );
    setCompleted = true;
    stage = 'post-restore process recovery';
    recovery = await recoverAfterPermissionChange(executor, {
      ...context,
      permission: scenario.permission,
      priorProcessId: mutation?.priorProcessId ?? null,
      signal: bounded.signal,
    });
    try {
      stage = 'post-restore permission verification';
      observed = await invoke(bounded.signal, () =>
        executor.getPermissionState({
          ...context,
          permission: scenario.permission,
          signal: bounded.signal,
        }),
      );
    } catch {
      observed = null;
    }
    const recoveryEvaluation = permissionRecoveryEvaluation(recovery);
    if (recoveryEvaluation) {
      status =
        recoveryEvaluation.outcome === 'NOT_VERIFIED'
          ? 'not-verified'
          : 'failed';
      reason = recoveryEvaluation.reason;
      evaluation = recoveryEvaluation;
    } else if (observed === originalState) {
      status = 'restored';
      reason = 'The original permission state was restored and verified.';
      evaluation = withPermissionRecoveryLimitation(
        {
          outcome: 'PASS',
          reason,
          severity: 'info',
        },
        recovery,
      );
    } else if (observed === null) {
      status = 'not-verified';
      reason =
        'The restore action completed, but the original permission state could not be verified.';
      evaluation = {
        outcome: 'NOT_VERIFIED',
        reason,
        severity: 'high',
        limitation: reason,
      };
    } else {
      status = 'failed';
      reason =
        'The observed permission state did not match the original state.';
      evaluation = {
        outcome: 'FAIL',
        reason,
        severity: 'critical',
        remediation:
          'Restore the owned app permission manually before running any further active scenario.',
      };
    }
  } catch {
    status = 'failed';
    reason = bounded.timedOut()
      ? 'Permission cleanup timed out; the original state may not be restored.'
      : `Permission cleanup failed during ${stage}; the original state may not be restored.`;
    evaluation = {
      outcome: 'FAIL',
      reason,
      severity: 'critical',
      remediation:
        'Restore the owned app permission manually before running any further active scenario.',
    };
  } finally {
    bounded.dispose();
  }
  const reference = evidenceFor(
    scenario.scenarioId,
    'permission-cleanup',
    'active-security-permission-cleanup',
    {
      permission: scenario.permission,
      originalState,
      setCompleted,
      observed,
      status,
      recovery: recovery?.status ?? 'not-supported',
    },
  );
  const cleanup: ActiveSecurityCleanupResult = {
    status,
    attempted: true,
    originalPermissionState: originalState,
    observedPermissionState: observed,
    ...(recovery ? { recovery } : {}),
    evidence: [reference],
    reason,
  };
  return {
    cleanup,
    finding: findingFor({
      scenarioId: scenario.scenarioId,
      probeId: 'permission-cleanup',
      ruleId: 'security.active.permission-cleanup',
      title: 'Original permission state was restored',
      evaluation,
      evidence: [reference],
    }),
  };
};

export async function runPermissionTransitionScenario(
  scenario: PermissionTransitionScenario,
  executor: PermissionTransitionExecutor,
  externalSignal?: AbortSignal,
): Promise<ActiveSecurityScenarioResult> {
  validatePermissionScenario(scenario);
  const bounded = boundedSignal(scenario.timeoutMs, externalSignal);
  const findings: AssuranceFinding[] = [];
  const probes: ActiveSecurityProbeResult[] = [];
  const evidence: EvidenceReference[] = [];
  let cleanup: ActiveSecurityCleanupResult = {
    status: 'not-needed',
    attempted: false,
    originalPermissionState: null,
    observedPermissionState: null,
    evidence: [],
    reason:
      'No permission mutation occurred because the original state was not available.',
  };
  try {
    let authorization: AuthorizationSuccess | null;
    try {
      authorization = await authorize(
        executor,
        authorizationRequest({
          scenarioId: scenario.scenarioId,
          action: scenario.kind,
          appId: scenario.appId,
          risk: scenario.risk,
          target: {
            kind: 'permission',
            identifier: scenario.permission,
          },
        }),
        bounded.signal,
      );
    } catch {
      return deniedResult({
        scenarioId: scenario.scenarioId,
        kind: scenario.kind,
        appId: scenario.appId,
        risk: scenario.risk,
        reason: abortReason(bounded.signal, bounded.timedOut()),
      });
    }
    if (!authorization) {
      return deniedResult({
        scenarioId: scenario.scenarioId,
        kind: scenario.kind,
        appId: scenario.appId,
        risk: scenario.risk,
        reason:
          'Authorization did not prove that the exact app/action/risk was owned and allowlisted.',
      });
    }
    const context = {
      appId: scenario.appId,
      risk: scenario.risk,
      authorizationId: authorization.authorizationId,
    } as const;
    let originalState: boolean | null;
    try {
      originalState = await invoke(bounded.signal, () =>
        executor.getPermissionState({
          ...context,
          permission: scenario.permission,
          signal: bounded.signal,
        }),
      );
    } catch {
      originalState = null;
    }
    cleanup = {
      ...cleanup,
      originalPermissionState: originalState,
    };
    if (originalState === null) {
      const reason =
        'The original permission state was unavailable, so no permission mutation was attempted.';
      const skipped = scenario.probes.map((probe) =>
        skippedProbe({
          scenarioId: scenario.scenarioId,
          appId: scenario.appId,
          risk: scenario.risk,
          probeId: probe.id,
          target: permissionTarget(scenario.permission, probe.granted),
          reason,
          ruleId: 'security.active.permission-transition',
          title: 'Owned app safely handles a permission transition',
        }),
      );
      findings.push(...skipped.map((entry) => entry.finding));
      probes.push(...skipped.map((entry) => entry.probe));
    } else {
      try {
        let baseline: ActiveSecurityObservationMetadata;
        try {
          baseline = structuredObservation(
            await invoke(bounded.signal, () =>
              executor.captureObservation({
                ...context,
                signal: bounded.signal,
              }),
            ),
            scenario.appId,
          );
          const baselineReference = evidenceFor(
            scenario.scenarioId,
            'permission-baseline',
            'active-security-observation',
            baseline,
          );
          evidence.push(baselineReference);
        } catch {
          baseline = {
            appId: null,
            capturedAt: new Date().toISOString(),
            appState: null,
            screen: null,
            logs: null,
          };
        }
        if (
          !baseline.appId ||
          !baseline.capturedAt ||
          !baseline.appState?.processRunning ||
          !baseline.appState.appInForeground
        ) {
          const reason =
            'A timestamped baseline bound to the running foreground owned app was not confirmed; no permission transition was attempted.';
          const skipped = scenario.probes.map((probe) =>
            skippedProbe({
              scenarioId: scenario.scenarioId,
              appId: scenario.appId,
              risk: scenario.risk,
              probeId: probe.id,
              target: permissionTarget(scenario.permission, probe.granted),
              reason,
              ruleId: 'security.active.permission-transition',
              title: 'Owned app safely handles a permission transition',
            }),
          );
          findings.push(...skipped.map((entry) => entry.finding));
          probes.push(...skipped.map((entry) => entry.probe));
        } else {
          let stoppedAt = scenario.probes.length;
          for (const [index, probe] of scenario.probes.entries()) {
            let stage = 'the permission mutation';
            try {
              stage = 'the permission mutation';
              const mutation = await invoke(bounded.signal, () =>
                executor.setPermission({
                  ...context,
                  permission: scenario.permission,
                  granted: probe.granted,
                  signal: bounded.signal,
                }),
              );
              stage = 'permission-change process recovery';
              const recovery = await recoverAfterPermissionChange(executor, {
                ...context,
                permission: scenario.permission,
                priorProcessId: mutation?.priorProcessId ?? null,
                signal: bounded.signal,
              });
              stage = 'the post-mutation settle interval';
              await delay(scenario.settleMs ?? 0, bounded.signal);
              stage = 'post-mutation permission verification';
              const observedPermission = await invoke(bounded.signal, () =>
                executor.getPermissionState({
                  ...context,
                  permission: scenario.permission,
                  signal: bounded.signal,
                }),
              );
              stage = 'post-mutation observation capture';
              let recoveryObservationAttempts = 1;
              let observation = structuredObservation(
                await invoke(bounded.signal, () =>
                  executor.captureObservation({
                    ...context,
                    signal: bounded.signal,
                  }),
                ),
                scenario.appId,
              );
              if (
                recovery?.status === 'recovered' &&
                observation.appState?.processRunning === true &&
                (observation.screen?.state === 'blank' ||
                  observation.screen?.state === 'loading')
              ) {
                stage = 'post-recovery readiness re-observation';
                await delay(POST_RECOVERY_REOBSERVE_DELAY_MS, bounded.signal);
                recoveryObservationAttempts += 1;
                observation = structuredObservation(
                  await invoke(bounded.signal, () =>
                    executor.captureObservation({
                      ...context,
                      signal: bounded.signal,
                    }),
                  ),
                  scenario.appId,
                );
              }
              const reference = evidenceFor(
                scenario.scenarioId,
                probe.id,
                'active-security-permission-probe',
                {
                  permission: scenario.permission,
                  targetState: probe.granted,
                  observedPermission,
                  recovery: recovery?.status ?? 'not-supported',
                  recoveryObservationAttempts:
                    recovery?.status === 'recovered'
                      ? recoveryObservationAttempts
                      : 0,
                  observation,
                },
              );
              evidence.push(reference);
              const recoveryEvaluation = permissionRecoveryEvaluation(recovery);
              let evaluation: ProbeEvaluation;
              if (recoveryEvaluation) {
                evaluation = recoveryEvaluation;
              } else if (observedPermission === null) {
                const reason =
                  'The permission state could not be observed after the transition.';
                evaluation = {
                  outcome: 'NOT_VERIFIED',
                  reason,
                  severity: 'high',
                  limitation: reason,
                };
              } else if (observedPermission !== probe.granted) {
                evaluation = {
                  outcome: 'FAIL',
                  reason:
                    'The observed permission state contradicted the explicitly requested transition.',
                  severity: 'high',
                  remediation:
                    'Verify the permission is runtime-changeable and repeat only on the explicitly owned app.',
                };
              } else {
                evaluation = withPermissionRecoveryLimitation(
                  evaluateObservation(
                    observation,
                    probe.allowedScreenStates,
                    probe.maximumErrorLogs,
                  ),
                  recovery,
                );
              }
              findings.push(
                findingFor({
                  scenarioId: scenario.scenarioId,
                  probeId: probe.id,
                  ruleId: 'security.active.permission-transition',
                  title: 'Owned app safely handles a permission transition',
                  evaluation,
                  evidence: [reference],
                }),
              );
              probes.push({
                id: probe.id,
                appId: scenario.appId,
                risk: scenario.risk,
                outcome: evaluation.outcome,
                target: permissionTarget(scenario.permission, probe.granted),
                observation,
                ...(recovery ? { recovery } : {}),
                ...(recovery?.status === 'recovered'
                  ? { recoveryObservationAttempts }
                  : {}),
                evidence: [reference],
                reason: evaluation.reason,
              });
            } catch {
              const reason = bounded.signal.aborted
                ? abortReason(bounded.signal, bounded.timedOut())
                : `The active-security executor did not complete ${stage}.`;
              const skipped = skippedProbe({
                scenarioId: scenario.scenarioId,
                appId: scenario.appId,
                risk: scenario.risk,
                probeId: probe.id,
                target: permissionTarget(scenario.permission, probe.granted),
                reason,
                ruleId: 'security.active.permission-transition',
                title: 'Owned app safely handles a permission transition',
              });
              findings.push(skipped.finding);
              probes.push(skipped.probe);
              stoppedAt = index + 1;
              break;
            }
          }
          for (const probe of scenario.probes.slice(stoppedAt)) {
            const reason =
              'Probe was not run after an earlier bounded operation stopped.';
            const skipped = skippedProbe({
              scenarioId: scenario.scenarioId,
              appId: scenario.appId,
              risk: scenario.risk,
              probeId: probe.id,
              target: permissionTarget(scenario.permission, probe.granted),
              reason,
              ruleId: 'security.active.permission-transition',
              title: 'Owned app safely handles a permission transition',
            });
            findings.push(skipped.finding);
            probes.push(skipped.probe);
          }
        }
      } finally {
        const restored = await cleanupPermission(
          scenario,
          executor,
          authorization.authorizationId,
          originalState,
        );
        cleanup = restored.cleanup;
        findings.push(restored.finding);
        evidence.push(...restored.cleanup.evidence);
      }
    }
    return {
      schemaVersion: '1.0',
      analyzer: 'security.active-scenario',
      analyzedAt: new Date().toISOString(),
      scenarioId: scenario.scenarioId,
      kind: scenario.kind,
      appId: scenario.appId,
      risk: scenario.risk,
      authorization: 'authorized',
      outcome: activeOutcome(findings),
      evidence: uniqueEvidence(evidence),
      findings,
      probes,
      cleanup,
      limitations: [
        'Only the explicitly named Android runtime permission on the owned and allowlisted app was changed.',
        'The original permission state is restored in a fresh bounded cleanup context even after abort, timeout, or executor failure.',
        ...(probes.some((probe) => probe.recovery?.status === 'recovered') ||
        cleanup.recovery?.status === 'recovered'
          ? [
              'A matching Android permission-change termination required a policy-authorized relaunch; that recovery is recorded per probe or cleanup.',
            ]
          : []),
        'No login, purchase, account mutation, or network interception action was performed.',
        'Executor implementations must honor AbortSignal before resolving mutating actions.',
      ],
    };
  } finally {
    bounded.dispose();
  }
}
