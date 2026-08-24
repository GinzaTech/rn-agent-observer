import { createHash } from 'node:crypto';
import type {
  AppState,
  AssuranceFinding,
  AssuranceOutcome,
  EvidenceAvailability,
  EvidenceReference,
  LogEntry,
  NetworkRequest,
  ScreenState,
  UiIssue,
} from '@rn-agent-observer/schemas';
import { partitionRuntimeErrorLogs } from '../diagnosis/runtime-errors.js';

export type ResiliencePhase = 'before' | 'fault' | 'recovery';

export interface ResilienceScreenEvidence {
  state: ScreenState;
  timestamp: string;
  issueCodes?: UiIssue['code'][];
}

export interface ResilienceCheckpoint {
  capturedAt: string;
  availability?: EvidenceAvailability;
  appState?: AppState;
  screen?: ResilienceScreenEvidence;
  network?: NetworkRequest[];
  logs?: LogEntry[];
  evidence?: EvidenceReference[];
}

interface ResilienceExpectationBase {
  id: string;
  title: string;
}

export type ResilienceExpectation =
  | (ResilienceExpectationBase & {
      type: 'process-running';
      phase: ResiliencePhase;
      expected: boolean;
    })
  | (ResilienceExpectationBase & {
      type: 'foreground';
      phase: ResiliencePhase;
      expected: boolean;
    })
  | (ResilienceExpectationBase & {
      type: 'screen-state';
      phase: ResiliencePhase;
      allowed: ScreenState[];
    })
  | (ResilienceExpectationBase & {
      type: 'no-stuck-loading';
      phase: ResiliencePhase;
    })
  | (ResilienceExpectationBase & {
      type: 'no-runtime-errors';
      phase: ResiliencePhase;
    })
  | (ResilienceExpectationBase & {
      type: 'network-result';
      phase: ResiliencePhase;
      expected: 'success' | 'failure';
      mode: 'all' | 'any';
      minimumSamples: number;
      requestIds?: string[];
    })
  | (ResilienceExpectationBase & {
      type: 'recovery-within';
      fromPhase: ResiliencePhase;
      toPhase: ResiliencePhase;
      maxDurationMs: number;
    });

export interface PassiveResilienceInput {
  scenarioId: string;
  scenarioKind: string;
  checkpoints: Partial<Record<ResiliencePhase, ResilienceCheckpoint>>;
  expectations: ResilienceExpectation[];
  analyzedAt?: string;
}

export interface ResilienceEvaluation {
  expectationId: string;
  type: ResilienceExpectation['type'] | 'expectations';
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  reason: string;
  evidenceIds: string[];
}

export interface PassiveResilienceResult {
  schemaVersion: '1.0';
  analyzer: 'resilience.passive-scenario';
  scenarioId: string;
  scenarioKind: string;
  analyzedAt: string;
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  evidence: EvidenceReference[];
  findings: AssuranceFinding[];
  evaluations: ResilienceEvaluation[];
  limitations: string[];
}

interface EvaluationResult {
  outcome: Exclude<AssuranceOutcome, 'NA'>;
  reason: string;
  evidence: EvidenceReference[];
  severity: AssuranceFinding['severity'];
  limitation?: string;
  remediation?: string;
}

interface AvailableCheckpoint {
  checkpoint: ResilienceCheckpoint;
  evidence: EvidenceReference[];
  degradedReason: string | null;
}

const resultOutcome = (
  findings: readonly AssuranceFinding[],
): PassiveResilienceResult['outcome'] => {
  if (findings.some((finding) => finding.outcome === 'FAIL')) return 'FAIL';
  if (findings.some((finding) => finding.outcome === 'NOT_VERIFIED')) {
    return 'NOT_VERIFIED';
  }
  return 'PASS';
};

const checkpointEvidence = (
  phase: ResiliencePhase,
  checkpoint: ResilienceCheckpoint,
): EvidenceReference[] => {
  if (checkpoint.evidence && checkpoint.evidence.length > 0) {
    return checkpoint.evidence;
  }
  const summary = {
    capturedAt: checkpoint.capturedAt,
    availability: checkpoint.availability,
    appState: checkpoint.appState
      ? {
          processRunning: checkpoint.appState.processRunning,
          appInForeground: checkpoint.appState.appInForeground,
          timestamp: checkpoint.appState.timestamp,
          source: checkpoint.appState.source,
        }
      : null,
    screen: checkpoint.screen ?? null,
    network:
      checkpoint.network?.map((request) => ({
        id: request.id,
        status: request.status ?? null,
        hasError: request.error !== undefined,
        timestamp: request.timestamp,
        source: request.source,
      })) ?? null,
    logs:
      checkpoint.logs?.map((entry) => ({
        level: entry.level,
        source: entry.source,
        timestamp: entry.timestamp,
      })) ?? null,
  };
  const sha256 = createHash('sha256')
    .update(JSON.stringify(summary))
    .digest('hex');
  return [
    {
      id: `resilience-${phase}-${sha256.slice(0, 16)}`,
      kind: 'resilience-checkpoint-summary',
      relation: 'supports',
      sha256,
    },
  ];
};

const checkpointFor = (
  input: PassiveResilienceInput,
  phase: ResiliencePhase,
): AvailableCheckpoint | EvaluationResult => {
  const checkpoint = input.checkpoints[phase];
  if (!checkpoint) {
    const reason = `The ${phase} checkpoint was not supplied.`;
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      evidence: [],
      severity: 'medium',
      limitation: reason,
    };
  }
  const evidence = checkpointEvidence(phase, checkpoint);
  if (!Number.isFinite(Date.parse(checkpoint.capturedAt))) {
    const reason = `The ${phase} checkpoint capturedAt timestamp was invalid.`;
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      evidence,
      severity: 'medium',
      limitation: reason,
    };
  }
  if (checkpoint.availability?.status === 'UNAVAILABLE') {
    const reason = `The ${phase} checkpoint was unavailable: ${checkpoint.availability.reason}`;
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      evidence,
      severity: 'medium',
      limitation: reason,
    };
  }
  return {
    checkpoint,
    evidence,
    degradedReason:
      checkpoint.availability?.status === 'DEGRADED'
        ? checkpoint.availability.reason
        : null,
  };
};

const isEvaluationResult = (
  value: AvailableCheckpoint | EvaluationResult,
): value is EvaluationResult => 'outcome' in value;

const degradePass = (
  result: EvaluationResult,
  degradedReasons: string[],
): EvaluationResult => {
  if (degradedReasons.length === 0) return result;
  const limitation = `Evidence was degraded: ${degradedReasons.join('; ')}`;
  if (result.outcome !== 'PASS') {
    return {
      ...result,
      reason: `${result.reason} ${limitation}`,
      limitation: result.limitation
        ? `${result.limitation} ${limitation}`
        : limitation,
    };
  }
  return {
    ...result,
    outcome: 'NOT_VERIFIED',
    reason: `${result.reason} ${limitation}`,
    limitation,
  };
};

const missingField = (
  phase: ResiliencePhase,
  field: string,
  evidence: EvidenceReference[],
): EvaluationResult => {
  const reason = `The ${phase} checkpoint did not include ${field} evidence.`;
  return {
    outcome: 'NOT_VERIFIED',
    reason,
    evidence,
    severity: 'medium',
    limitation: reason,
  };
};

const evaluateAtCheckpoint = (
  input: PassiveResilienceInput,
  expectation: Exclude<ResilienceExpectation, { type: 'recovery-within' }>,
): EvaluationResult => {
  const available = checkpointFor(input, expectation.phase);
  if (isEvaluationResult(available)) return available;
  const { checkpoint, evidence, degradedReason } = available;
  let result: EvaluationResult;

  if (expectation.type === 'process-running') {
    if (!checkpoint.appState) {
      return missingField(expectation.phase, 'app-state', evidence);
    }
    const matches = checkpoint.appState.processRunning === expectation.expected;
    result = {
      outcome: matches ? 'PASS' : 'FAIL',
      reason: matches
        ? `Observed processRunning=${String(expectation.expected)} at the ${expectation.phase} checkpoint.`
        : `Expected processRunning=${String(expectation.expected)} but observed ${String(checkpoint.appState.processRunning)} at the ${expectation.phase} checkpoint.`,
      evidence,
      severity: matches ? 'info' : expectation.expected ? 'critical' : 'medium',
      ...(!matches
        ? {
            remediation:
              'Inspect the first causal crash/process-death evidence, then repeat the same declared scenario.',
          }
        : {}),
    };
  } else if (expectation.type === 'foreground') {
    if (!checkpoint.appState) {
      return missingField(expectation.phase, 'app-state', evidence);
    }
    const matches =
      checkpoint.appState.appInForeground === expectation.expected;
    result = {
      outcome: matches ? 'PASS' : 'FAIL',
      reason: matches
        ? `Observed appInForeground=${String(expectation.expected)} at the ${expectation.phase} checkpoint.`
        : `Expected appInForeground=${String(expectation.expected)} but observed ${String(checkpoint.appState.appInForeground)} at the ${expectation.phase} checkpoint.`,
      evidence,
      severity: matches ? 'info' : 'high',
      ...(!matches
        ? {
            remediation:
              'Verify lifecycle restoration and foreground transition using the same explicit checkpoints.',
          }
        : {}),
    };
  } else if (expectation.type === 'screen-state') {
    if (expectation.allowed.length === 0) {
      throw new RangeError(
        `Resilience expectation ${expectation.id} must allow at least one screen state`,
      );
    }
    if (!checkpoint.screen) {
      return missingField(expectation.phase, 'screen-state', evidence);
    }
    const matches = expectation.allowed.includes(checkpoint.screen.state);
    result = {
      outcome: matches ? 'PASS' : 'FAIL',
      reason: matches
        ? `Observed declared screen state ${checkpoint.screen.state} at the ${expectation.phase} checkpoint.`
        : `Observed screen state ${checkpoint.screen.state}; the explicit allowed set was ${expectation.allowed.join(', ')}.`,
      evidence,
      severity: matches ? 'info' : 'high',
      ...(!matches
        ? {
            remediation:
              'Restore the expected UI state after the declared fault and recapture the same checkpoint; route is intentionally not inferred.',
          }
        : {}),
    };
  } else if (expectation.type === 'no-stuck-loading') {
    if (!checkpoint.screen) {
      return missingField(expectation.phase, 'screen-state', evidence);
    }
    const stuck =
      checkpoint.screen.issueCodes?.includes('loading-stuck') ?? false;
    if (stuck) {
      result = {
        outcome: 'FAIL',
        reason: `The ${expectation.phase} checkpoint explicitly contained a loading-stuck issue.`,
        evidence,
        severity: 'high',
        remediation:
          'Provide a bounded timeout/error/retry path and repeat the scenario beyond the same stuck threshold.',
      };
    } else if (checkpoint.screen.state === 'loading') {
      const reason = `The ${expectation.phase} checkpoint was still loading without duration evidence proving it was not stuck.`;
      result = {
        outcome: 'NOT_VERIFIED',
        reason,
        evidence,
        severity: 'medium',
        limitation: reason,
      };
    } else {
      result = {
        outcome: 'PASS',
        reason: `The ${expectation.phase} checkpoint was ${checkpoint.screen.state} and had no explicit loading-stuck issue.`,
        evidence,
        severity: 'info',
      };
    }
  } else if (expectation.type === 'no-runtime-errors') {
    if (!checkpoint.logs) {
      return missingField(expectation.phase, 'log', evidence);
    }
    const errorCandidates = checkpoint.logs.filter(
      (entry) => entry.level === 'error' || entry.level === 'fatal',
    );
    const errors = partitionRuntimeErrorLogs(errorCandidates).actionable;
    const fatal = errors.some((entry) => entry.level === 'fatal');
    result = {
      outcome: errors.length === 0 ? 'PASS' : 'FAIL',
      reason:
        errors.length === 0
          ? `No error/fatal log entries were supplied for the ${expectation.phase} checkpoint.`
          : `${errors.length} error/fatal log entries were observed at the ${expectation.phase} checkpoint; messages are not repeated in this result.`,
      evidence,
      severity: errors.length === 0 ? 'info' : fatal ? 'critical' : 'high',
      ...(errors.length > 0
        ? {
            remediation:
              'Inspect the protected log evidence, resolve the first causal error, and repeat the declared scenario.',
          }
        : {}),
    };
  } else {
    result = evaluateNetworkExpectation(expectation, checkpoint, evidence);
  }

  return degradePass(result, degradedReason ? [degradedReason] : []);
};

type NetworkExpectation = Extract<
  ResilienceExpectation,
  { type: 'network-result' }
>;

type KnownNetworkResult = 'success' | 'failure';

const observedNetworkResult = (
  request: NetworkRequest,
): KnownNetworkResult | 'unknown' => {
  if (request.error !== undefined || (request.status ?? 0) >= 400) {
    return 'failure';
  }
  if (
    request.status !== undefined &&
    request.status >= 200 &&
    request.status < 400
  ) {
    return 'success';
  }
  return 'unknown';
};

const evaluateNetworkExpectation = (
  expectation: NetworkExpectation,
  checkpoint: ResilienceCheckpoint,
  evidence: EvidenceReference[],
): EvaluationResult => {
  if (
    !Number.isInteger(expectation.minimumSamples) ||
    expectation.minimumSamples < 1
  ) {
    throw new RangeError(
      `Resilience expectation ${expectation.id} minimumSamples must be a positive integer`,
    );
  }
  if (!checkpoint.network) {
    return missingField(expectation.phase, 'network-request', evidence);
  }
  const requestedIds = expectation.requestIds
    ? new Set(expectation.requestIds)
    : null;
  const requests = requestedIds
    ? checkpoint.network.filter((request) => requestedIds.has(request.id))
    : checkpoint.network;
  const observed = requests.map(observedNetworkResult);
  const matching = observed.filter(
    (result) => result === expectation.expected,
  ).length;
  const contradicting = observed.filter(
    (result) => result !== 'unknown' && result !== expectation.expected,
  ).length;
  const unknown = observed.filter((result) => result === 'unknown').length;
  const known = observed.length - unknown;
  const missingRequested = requestedIds
    ? [...requestedIds].filter(
        (id) => !checkpoint.network?.some((request) => request.id === id),
      ).length
    : 0;
  if (expectation.mode === 'all' && contradicting > 0) {
    return {
      outcome: 'FAIL',
      reason: `${contradicting} of ${observed.length} selected requests contradicted the expected ${expectation.expected} result.`,
      evidence,
      severity: 'high',
      remediation:
        'Inspect the protected request evidence and make the declared recovery/fault behavior deterministic before rerunning.',
    };
  }
  if (known < expectation.minimumSamples) {
    const limitation = `Only ${known} classified requests were observed; ${expectation.minimumSamples} were required.`;
    return {
      outcome: 'NOT_VERIFIED',
      reason: limitation,
      evidence,
      severity: 'medium',
      limitation,
    };
  }
  if (expectation.mode === 'any') {
    if (matching === 0 && (unknown > 0 || missingRequested > 0)) {
      const limitation = `${unknown} requests had no classifiable result and ${missingRequested} explicitly requested IDs were absent.`;
      return {
        outcome: 'NOT_VERIFIED',
        reason: limitation,
        evidence,
        severity: 'medium',
        limitation,
      };
    }
    const passes = matching > 0;
    return {
      outcome: passes ? 'PASS' : 'FAIL',
      reason: passes
        ? `${matching} of ${observed.length} selected requests matched the expected ${expectation.expected} result.`
        : `None of ${observed.length} selected requests matched the expected ${expectation.expected} result.`,
      evidence,
      severity: passes ? 'info' : 'high',
      ...(!passes
        ? {
            remediation:
              'Inspect the protected request evidence and verify the explicitly expected network transition.',
          }
        : {}),
    };
  }
  if (unknown > 0 || missingRequested > 0) {
    const limitation = `${unknown} requests had no classifiable result and ${missingRequested} explicitly requested IDs were absent.`;
    return {
      outcome: 'NOT_VERIFIED',
      reason: limitation,
      evidence,
      severity: 'medium',
      limitation,
    };
  }
  return {
    outcome: 'PASS',
    reason: `All ${observed.length} selected requests matched the expected ${expectation.expected} result.`,
    evidence,
    severity: 'info',
  };
};

const evaluateRecoveryTiming = (
  input: PassiveResilienceInput,
  expectation: Extract<ResilienceExpectation, { type: 'recovery-within' }>,
): EvaluationResult => {
  if (
    !Number.isFinite(expectation.maxDurationMs) ||
    expectation.maxDurationMs <= 0
  ) {
    throw new RangeError(
      `Resilience expectation ${expectation.id} maxDurationMs must be positive`,
    );
  }
  if (expectation.fromPhase === expectation.toPhase) {
    throw new RangeError(
      `Resilience expectation ${expectation.id} must use different timing phases`,
    );
  }
  const from = checkpointFor(input, expectation.fromPhase);
  if (isEvaluationResult(from)) return from;
  const to = checkpointFor(input, expectation.toPhase);
  if (isEvaluationResult(to)) return to;
  const fromTime = Date.parse(from.checkpoint.capturedAt);
  const toTime = Date.parse(to.checkpoint.capturedAt);
  const evidence = [...from.evidence, ...to.evidence];
  if (
    !Number.isFinite(fromTime) ||
    !Number.isFinite(toTime) ||
    toTime < fromTime
  ) {
    const reason = 'Checkpoint timestamps were invalid or not chronological.';
    return {
      outcome: 'NOT_VERIFIED',
      reason,
      evidence,
      severity: 'medium',
      limitation: reason,
    };
  }
  const durationMs = toTime - fromTime;
  const passes = durationMs <= expectation.maxDurationMs;
  return degradePass(
    {
      outcome: passes ? 'PASS' : 'FAIL',
      reason: passes
        ? `Observed ${expectation.fromPhase}-to-${expectation.toPhase} duration ${durationMs}ms within the explicit ${expectation.maxDurationMs}ms limit.`
        : `Observed ${expectation.fromPhase}-to-${expectation.toPhase} duration ${durationMs}ms exceeded the explicit ${expectation.maxDurationMs}ms limit.`,
      evidence,
      severity: passes ? 'info' : 'medium',
      ...(!passes
        ? {
            remediation:
              'Bound the recovery path and repeat the scenario using the same checkpoint definition.',
          }
        : {}),
    },
    [from.degradedReason, to.degradedReason].filter(
      (reason): reason is string => reason !== null,
    ),
  );
};

const findingFor = (
  input: PassiveResilienceInput,
  expectation: ResilienceExpectation,
  evaluation: EvaluationResult,
): AssuranceFinding => ({
  schemaVersion: '1.0',
  id: `resilience.${input.scenarioId}.${expectation.id}`,
  ruleId: `resilience.${expectation.type}`,
  title: expectation.title,
  description: evaluation.reason,
  outcome: evaluation.outcome,
  severity: evaluation.severity,
  confidence: evaluation.outcome === 'NOT_VERIFIED' ? 1 : 0.95,
  category: 'resilience',
  controls: [],
  evidence: evaluation.evidence,
  ...(evaluation.remediation ? { remediation: evaluation.remediation } : {}),
  limitations: evaluation.limitation ? [evaluation.limitation] : [],
});

/**
 * Evaluates declared resilience expectations against already-captured
 * checkpoints. It performs no fault injection and intentionally ignores route;
 * scenario meaning comes only from the caller's explicit expectations.
 */
export function analyzePassiveResilience(
  input: PassiveResilienceInput,
): PassiveResilienceResult {
  if (!input.scenarioId.trim()) throw new TypeError('scenarioId is required');
  if (!input.scenarioKind.trim())
    throw new TypeError('scenarioKind is required');
  const expectationIds = new Set<string>();
  for (const expectation of input.expectations) {
    if (!expectation.id.trim())
      throw new TypeError('expectation id is required');
    if (!expectation.title.trim()) {
      throw new TypeError(
        `Resilience expectation ${expectation.id} title is required`,
      );
    }
    if (expectationIds.has(expectation.id)) {
      throw new TypeError(
        `Duplicate resilience expectation id: ${expectation.id}`,
      );
    }
    expectationIds.add(expectation.id);
  }

  const allEvidence = (['before', 'fault', 'recovery'] as const).flatMap(
    (phase) => {
      const checkpoint = input.checkpoints[phase];
      return checkpoint ? checkpointEvidence(phase, checkpoint) : [];
    },
  );
  const uniqueEvidence = [
    ...new Map(
      allEvidence.map((reference) => [reference.id, reference]),
    ).values(),
  ];
  if (input.expectations.length === 0) {
    const reason =
      'No explicit resilience expectations were supplied; scenario semantics are not inferred.';
    const finding: AssuranceFinding = {
      schemaVersion: '1.0',
      id: `resilience.${input.scenarioId}.expectations`,
      ruleId: 'resilience.expectations',
      title: 'Resilience scenario has explicit expectations',
      description: reason,
      outcome: 'NOT_VERIFIED',
      severity: 'medium',
      confidence: 1,
      category: 'resilience',
      controls: [],
      evidence: uniqueEvidence,
      limitations: [reason],
    };
    return {
      schemaVersion: '1.0',
      analyzer: 'resilience.passive-scenario',
      scenarioId: input.scenarioId,
      scenarioKind: input.scenarioKind,
      analyzedAt: input.analyzedAt ?? new Date().toISOString(),
      outcome: 'NOT_VERIFIED',
      evidence: uniqueEvidence,
      findings: [finding],
      evaluations: [
        {
          expectationId: 'expectations',
          type: 'expectations',
          outcome: 'NOT_VERIFIED',
          reason,
          evidenceIds: uniqueEvidence.map((reference) => reference.id),
        },
      ],
      limitations: [
        reason,
        'This analyzer consumes passive evidence only and never injects faults or changes app/device/network state.',
        'Route and screen meaning are never inferred; only explicit expectation fields are evaluated.',
      ],
    };
  }

  const evaluated = input.expectations.map((expectation) => {
    const evaluation =
      expectation.type === 'recovery-within'
        ? evaluateRecoveryTiming(input, expectation)
        : evaluateAtCheckpoint(input, expectation);
    return {
      finding: findingFor(input, expectation, evaluation),
      evaluation: {
        expectationId: expectation.id,
        type: expectation.type,
        outcome: evaluation.outcome,
        reason: evaluation.reason,
        evidenceIds: evaluation.evidence.map((reference) => reference.id),
      } satisfies ResilienceEvaluation,
    };
  });
  const findings = evaluated.map((entry) => entry.finding);
  return {
    schemaVersion: '1.0',
    analyzer: 'resilience.passive-scenario',
    scenarioId: input.scenarioId,
    scenarioKind: input.scenarioKind,
    analyzedAt: input.analyzedAt ?? new Date().toISOString(),
    outcome: resultOutcome(findings),
    evidence: uniqueEvidence,
    findings,
    evaluations: evaluated.map((entry) => entry.evaluation),
    limitations: [
      'This analyzer consumes passive evidence only and never injects faults or changes app/device/network state.',
      'Route and screen meaning are never inferred; only explicit expectation fields are evaluated.',
      'Network retry/backoff causality is not inferred from request timing; declare and capture dedicated expectations when needed.',
    ],
  };
}
