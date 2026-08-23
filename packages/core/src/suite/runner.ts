import { isDeepStrictEqual } from 'node:util';
import {
  SuiteDefinitionSchema,
  SuiteRunResultSchema,
  type AssuranceFinding,
  type AssuranceOutcome,
  type EvidenceReference,
  type SuiteAssertion,
  type SuiteAssertionResult,
  type SuiteDefinition,
  type SuiteRisk,
  type SuiteRunResult,
  type SuiteStep,
  type SuiteStepResult,
  type TargetFingerprint,
} from '@rn-agent-observer/schemas';

export interface SuiteCommandResult {
  output?: unknown;
  evidence?: EvidenceReference[];
  findings?: AssuranceFinding[];
}

export interface SuiteCommandContext {
  runId: string;
  stepId: string;
  attempt: number;
  risk: SuiteRisk;
  signal: AbortSignal;
}

export interface SuiteCommandExecutor {
  execute(
    command: string,
    input: Readonly<Record<string, unknown>>,
    context: SuiteCommandContext,
  ): Promise<SuiteCommandResult>;
}

export interface SuiteAuthorization {
  allowed: boolean;
  reason?: string;
}

export interface SuiteRunProgress {
  phase: 'steps' | 'cleanup';
  completed: number;
  total: number;
  stepId: string;
}

export interface RunSuiteOptions {
  target: TargetFingerprint;
  capabilities: Iterable<string>;
  executor: SuiteCommandExecutor;
  authorize?: (
    risk: SuiteRisk,
    command: string,
  ) => SuiteAuthorization | Promise<SuiteAuthorization>;
  now?: () => Date;
  createRunId?: () => string;
  sleep?: (durationMs: number) => Promise<void>;
  signal?: AbortSignal;
  onProgress?: (progress: SuiteRunProgress) => void | Promise<void>;
}

interface StepAttemptResult {
  outcome: AssuranceOutcome;
  reason?: string;
  evidence: EvidenceReference[];
  assertions: SuiteAssertionResult[];
  findings: AssuranceFinding[];
}

const defaultSleep = async (durationMs: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const outcomePriority: Record<AssuranceOutcome, number> = {
  PASS: 0,
  NA: 1,
  NOT_VERIFIED: 2,
  FAIL: 3,
};

const aggregateOutcome = (
  outcomes: readonly AssuranceOutcome[],
): AssuranceOutcome => {
  if (outcomes.length === 0) return 'NA';
  return outcomes.reduce((current, candidate) =>
    outcomePriority[candidate] > outcomePriority[current] ? candidate : current,
  );
};

const readPath = (value: unknown, path: string | undefined): unknown => {
  if (!path) return value;
  let current = value;
  for (const segment of path.split('.')) {
    if (Array.isArray(current) && /^\d+$/u.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const matchingEvidence = (
  evidence: readonly EvidenceReference[],
  kinds: readonly string[],
): EvidenceReference[] =>
  kinds.length === 0
    ? [...evidence]
    : evidence.filter((reference) => kinds.includes(reference.kind));

const evaluateAssertion = (
  assertion: SuiteAssertion,
  output: unknown,
  evidence: readonly EvidenceReference[],
): SuiteAssertionResult => {
  const assertionEvidence = matchingEvidence(evidence, assertion.evidenceKinds);
  if (assertion.evidenceKinds.length > 0 && assertionEvidence.length === 0) {
    return {
      id: assertion.id,
      title: assertion.title,
      outcome: assertion.onUnavailable,
      reason: `Required evidence is unavailable: ${assertion.evidenceKinds.join(', ')}`,
      evidence: [],
    };
  }

  const actual = readPath(output, assertion.path);
  if (
    (actual === undefined ||
      (actual === null &&
        (assertion.type === 'metric-budget' ||
          assertion.type === 'visual-diff'))) &&
    assertion.type !== 'exists'
  ) {
    return {
      id: assertion.id,
      title: assertion.title,
      outcome: assertion.onUnavailable,
      reason: assertion.path
        ? `Output path is unavailable: ${assertion.path}`
        : 'Command output is unavailable',
      evidence: assertionEvidence,
    };
  }

  let passed = false;
  if (assertion.type === 'exists') {
    passed = actual !== undefined && actual !== null;
  } else if (assertion.type === 'equals') {
    passed = isDeepStrictEqual(actual, assertion.expected);
  } else if (assertion.type === 'contains') {
    passed =
      (typeof actual === 'string' &&
        typeof assertion.expected === 'string' &&
        actual.includes(assertion.expected)) ||
      (Array.isArray(actual) &&
        actual.some((item) => isDeepStrictEqual(item, assertion.expected)));
  } else if (
    assertion.type === 'metric-budget' ||
    assertion.type === 'visual-diff'
  ) {
    passed =
      typeof actual === 'number' &&
      assertion.threshold !== undefined &&
      actual <= assertion.threshold;
  } else if (assertion.type === 'finding') {
    passed =
      Array.isArray(actual) &&
      actual.some(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          (item as Record<string, unknown>).ruleId === assertion.expected,
      );
  }

  return {
    id: assertion.id,
    title: assertion.title,
    outcome: passed ? 'PASS' : 'FAIL',
    reason: passed
      ? undefined
      : assertion.type === 'metric-budget' || assertion.type === 'visual-diff'
        ? `Observed value exceeded threshold ${String(assertion.threshold)}${assertion.unit ? ` ${assertion.unit}` : ''}`
        : 'Observed output did not satisfy the assertion',
    evidence: assertionEvidence,
  };
};

const executeWithTimeout = async (
  executor: SuiteCommandExecutor,
  step: SuiteStep,
  context: Omit<SuiteCommandContext, 'signal' | 'risk'>,
  externalSignal?: AbortSignal,
): Promise<SuiteCommandResult> => {
  const controller = new AbortController();
  const signal = externalSignal
    ? AbortSignal.any([controller.signal, externalSignal])
    : controller.signal;
  let timeout: NodeJS.Timeout | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      executor.execute(step.action.command, step.action.input, {
        ...context,
        risk: step.risk,
        signal,
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Command timed out after ${step.timeoutMs} ms`));
          controller.abort();
        }, step.timeoutMs);
      }),
      new Promise<never>((_resolve, reject) => {
        if (externalSignal?.aborted) {
          reject(new Error('Suite execution was cancelled'));
          return;
        }
        abortListener = () =>
          reject(new Error('Suite execution was cancelled'));
        externalSignal?.addEventListener('abort', abortListener, {
          once: true,
        });
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abortListener) {
      externalSignal?.removeEventListener('abort', abortListener);
    }
  }
};

const runStep = async (
  step: SuiteStep,
  runId: string,
  capabilities: ReadonlySet<string>,
  options: RunSuiteOptions,
): Promise<{ result: SuiteStepResult; findings: AssuranceFinding[] }> => {
  const now = options.now ?? (() => new Date());
  const started = now();
  if (options.signal?.aborted) {
    const finished = now();
    return {
      result: {
        id: step.id,
        title: step.title,
        outcome: 'NOT_VERIFIED',
        attempts: 0,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: Math.max(0, finished.getTime() - started.getTime()),
        reason: 'Suite execution was cancelled',
        evidence: [],
        assertions: [],
      },
      findings: [],
    };
  }
  const missingCapabilities = step.requiredCapabilities.filter(
    (capability) => !capabilities.has(capability),
  );
  if (missingCapabilities.length > 0) {
    const finished = now();
    return {
      result: {
        id: step.id,
        title: step.title,
        outcome: 'NOT_VERIFIED',
        attempts: 0,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: Math.max(0, finished.getTime() - started.getTime()),
        reason: `Missing capabilities: ${missingCapabilities.join(', ')}`,
        evidence: [],
        assertions: [],
      },
      findings: [],
    };
  }

  const authorization = options.authorize
    ? await options.authorize(step.risk, step.action.command)
    : {
        allowed: step.risk === 'read',
        reason:
          step.risk === 'read'
            ? undefined
            : `Risk ${step.risk} requires explicit authorization`,
      };
  if (!authorization.allowed) {
    const finished = now();
    return {
      result: {
        id: step.id,
        title: step.title,
        outcome: 'NOT_VERIFIED',
        attempts: 0,
        startedAt: started.toISOString(),
        finishedAt: finished.toISOString(),
        durationMs: Math.max(0, finished.getTime() - started.getTime()),
        reason: authorization.reason ?? 'Action was not authorized',
        evidence: [],
        assertions: [],
      },
      findings: [],
    };
  }

  let finalAttempt: StepAttemptResult | undefined;
  let attempts = 0;
  for (let attempt = 1; attempt <= step.retry.maxAttempts; attempt += 1) {
    attempts = attempt;
    try {
      const commandResult = await executeWithTimeout(
        options.executor,
        step,
        {
          runId,
          stepId: step.id,
          attempt,
        },
        options.signal,
      );
      const evidence = commandResult.evidence ?? [];
      const assertions = step.assertions.map((assertion) =>
        evaluateAssertion(assertion, commandResult.output, evidence),
      );
      const outcome =
        assertions.length === 0
          ? 'PASS'
          : aggregateOutcome(assertions.map((assertion) => assertion.outcome));
      finalAttempt = {
        outcome,
        ...(outcome === 'PASS'
          ? {}
          : { reason: 'One or more assertions were not satisfied' }),
        evidence,
        assertions,
        findings: commandResult.findings ?? [],
      };
    } catch (error) {
      finalAttempt = {
        outcome: options.signal?.aborted ? 'NOT_VERIFIED' : 'FAIL',
        reason: error instanceof Error ? error.message : String(error),
        evidence: [],
        assertions: [],
        findings: [],
      };
    }

    if (finalAttempt.outcome === 'PASS' || attempt === step.retry.maxAttempts) {
      break;
    }
    if (options.signal?.aborted) break;
    if (step.retry.backoffMs > 0) {
      await (options.sleep ?? defaultSleep)(step.retry.backoffMs);
    }
  }

  const finished = now();
  const resolvedAttempt = finalAttempt ?? {
    outcome: 'NOT_VERIFIED' as const,
    reason: 'Step did not execute',
    evidence: [],
    assertions: [],
    findings: [],
  };
  return {
    result: {
      id: step.id,
      title: step.title,
      outcome: resolvedAttempt.outcome,
      attempts,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      ...(resolvedAttempt.reason ? { reason: resolvedAttempt.reason } : {}),
      evidence: resolvedAttempt.evidence,
      assertions: resolvedAttempt.assertions,
    },
    findings: resolvedAttempt.findings,
  };
};

export const runSuite = async (
  definition: SuiteDefinition,
  options: RunSuiteOptions,
): Promise<SuiteRunResult> => {
  const suite = SuiteDefinitionSchema.parse(definition);
  const now = options.now ?? (() => new Date());
  const started = now();
  const runId =
    options.createRunId?.() ??
    `run-${started.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
  const capabilities = new Set(options.capabilities);
  const limitations: string[] = [];

  if (!suite.requirements.platforms.includes(options.target.platform)) {
    limitations.push(
      `Target platform ${options.target.platform} is outside suite requirements`,
    );
  }
  if (
    suite.requirements.enhancedInstrumentation &&
    !capabilities.has('instrumentation')
  ) {
    limitations.push('Suite requires enhanced RN Observer instrumentation');
  }
  const missingSuiteCapabilities = suite.requirements.capabilities.filter(
    (capability) => !capabilities.has(capability),
  );
  if (missingSuiteCapabilities.length > 0) {
    limitations.push(
      `Missing suite capabilities: ${missingSuiteCapabilities.join(', ')}`,
    );
  }

  const stepResults: SuiteStepResult[] = [];
  const cleanupResults: SuiteStepResult[] = [];
  const findings: AssuranceFinding[] = [];
  if (limitations.length === 0) {
    for (const [index, step] of suite.steps.entries()) {
      await options.onProgress?.({
        phase: 'steps',
        completed: index,
        total: suite.steps.length,
        stepId: step.id,
      });
      const execution = await runStep(step, runId, capabilities, options);
      stepResults.push(execution.result);
      findings.push(...execution.findings);
      await options.onProgress?.({
        phase: 'steps',
        completed: index + 1,
        total: suite.steps.length,
        stepId: step.id,
      });
      if (options.signal?.aborted) {
        limitations.push(
          index + 1 < suite.steps.length
            ? 'Suite execution was cancelled before all steps ran'
            : 'Suite execution was cancelled',
        );
        break;
      }
    }
    const cleanupOptions: RunSuiteOptions = { ...options };
    delete cleanupOptions.signal;
    for (const [index, step] of suite.cleanup.entries()) {
      await options.onProgress?.({
        phase: 'cleanup',
        completed: index,
        total: suite.cleanup.length,
        stepId: step.id,
      });
      const execution = await runStep(
        step,
        runId,
        capabilities,
        cleanupOptions,
      );
      cleanupResults.push(execution.result);
      findings.push(...execution.findings);
      await options.onProgress?.({
        phase: 'cleanup',
        completed: index + 1,
        total: suite.cleanup.length,
        stepId: step.id,
      });
    }
  }

  const finished = now();
  const outcome =
    limitations.length > 0
      ? 'NOT_VERIFIED'
      : aggregateOutcome([
          ...stepResults.map((step) => step.outcome),
          ...cleanupResults.map((step) => step.outcome),
          ...findings.map((finding) => finding.outcome),
        ]);

  return SuiteRunResultSchema.parse({
    schemaVersion: '1.0',
    id: runId,
    suiteId: suite.metadata.id,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    outcome,
    target: options.target,
    capabilities: [...capabilities].sort(),
    steps: stepResults,
    cleanup: cleanupResults,
    findings,
    limitations,
  });
};
