import { createHash } from 'node:crypto';
import {
  TargetFingerprintSchema,
  type AssuranceFinding,
  type EvidenceReference,
  type TargetFingerprint,
} from '@rn-agent-observer/schemas';

/**
 * A deliberately small, evidence-only coverage model. It models declared
 * route/action identifiers rather than source files or visible text, so it
 * can be shared safely between community projects and target providers.
 */
export const COVERAGE_SCHEMA_VERSION = '1.0' as const;
export const MAX_COVERAGE_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_COVERAGE_ROUTES = 1_000;
export const MAX_COVERAGE_ACTIONS_PER_ROUTE = 1_000;
export const MAX_COVERAGE_ACTIONS = 10_000;
export const MAX_COVERAGE_CHECKPOINTS = 10_000;
export const MAX_COVERAGE_INTERACTIONS_PER_CHECKPOINT = 1_000;
export const MAX_COVERAGE_INTERACTIONS = 50_000;
export const MAX_COVERAGE_EVIDENCE_DIGESTS = 500;
export const MAX_COVERAGE_MERGE_RUNS = 100;

const MAX_SEMANTIC_ID_LENGTH = 128;
const MAX_CORRELATION_ID_LENGTH = 1_024;
const MAX_TARGET_VALUE_LENGTH = 256;
const MAX_THRESHOLD_OBSERVABLE_ITEMS = 20_000;
const MAX_THRESHOLD_EVIDENCE = 100_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SEMANTIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u;

export type CoverageStatus = 'covered' | 'uncovered' | 'not-observable';

export interface CoverageThreshold {
  /** Required fraction of observable declared entries that must be covered. */
  readonly minimumCoverageRatio: number;
  /** Prevents tiny inventories from accidentally becoming a release signal. */
  readonly minimumObservableItems: number;
  /** Number of usable, target-scoped checkpoint/interaction observations. */
  readonly minimumEvidence: number;
}

export interface DeclaredCoverageAction {
  readonly id: string;
  readonly observable: boolean;
}

export interface DeclaredCoverageRoute {
  readonly id: string;
  readonly observable: boolean;
  readonly actions: readonly DeclaredCoverageAction[];
}

export interface ActionCoverageInventory {
  readonly routes: readonly DeclaredCoverageRoute[];
}

/**
 * `routeId` is intentionally required, but may be null when the provider
 * cannot establish it. A null route never falls back to another observation.
 */
export interface ObservedCoverageInteraction {
  readonly routeId: string | null;
  readonly actionId: string | null;
  readonly correlationId?: string | null;
}

export interface ObservedCoverageCheckpoint {
  readonly routeId: string | null;
  readonly interactions: readonly ObservedCoverageInteraction[];
  readonly correlationId?: string | null;
}

export interface ActionCoverageInput {
  readonly target: TargetFingerprint;
  readonly inventory: ActionCoverageInventory;
  readonly checkpoints: readonly ObservedCoverageCheckpoint[];
  readonly threshold?: CoverageThreshold;
}

export interface CoverageActionResult {
  readonly routeId: string;
  readonly actionId: string;
  readonly status: CoverageStatus;
}

export interface CoverageRouteResult {
  readonly routeId: string;
  readonly status: CoverageStatus;
  readonly actions: readonly CoverageActionResult[];
}

export interface CoverageCounts {
  readonly total: number;
  readonly observable: number;
  readonly covered: number;
  readonly uncovered: number;
  readonly notObservable: number;
}

export interface CoverageRatios {
  readonly routes: number | null;
  readonly actions: number | null;
  readonly overall: number | null;
}

export interface SanitizedCoverageEvidence {
  readonly kind: 'checkpoint' | 'interaction';
  /** SHA-256 of a canonical event summary; raw observation data is discarded. */
  readonly eventHash: string;
  /** SHA-256 of the raw correlation value, if one was supplied. */
  readonly correlationHash?: string;
}

export interface CoverageObservationCounts {
  readonly inputCheckpoints: number;
  readonly usableEvidence: number;
  readonly observedCheckpoints: number;
  readonly observedInteractions: number;
  readonly ignoredNullRoutes: number;
  readonly ignoredUnknownRoutes: number;
  readonly ignoredNullActions: number;
  readonly ignoredUnknownActions: number;
  readonly ignoredNotObservable: number;
}

export interface ActionCoverageResult {
  readonly schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
  readonly analyzer: 'coverage.route-action';
  readonly target: TargetFingerprint;
  readonly outcome: 'PASS' | 'FAIL' | 'NOT_VERIFIED';
  readonly routes: readonly CoverageRouteResult[];
  readonly counts: {
    readonly routes: CoverageCounts;
    readonly actions: CoverageCounts;
    readonly overall: CoverageCounts;
  };
  readonly ratios: CoverageRatios;
  readonly observations: CoverageObservationCounts;
  readonly evidence: readonly EvidenceReference[];
  readonly evidenceDigests: readonly SanitizedCoverageEvidence[];
  readonly evidenceDigestTruncated: number;
  readonly findings: readonly AssuranceFinding[];
  readonly limitations: readonly string[];
  readonly threshold?: CoverageThreshold;
}

export interface ActionCoverageMergeOptions {
  /**
   * Required if constituent runs did not use one identical explicit threshold.
   * Passing it makes the merged release criterion visible to the caller.
   */
  readonly threshold?: CoverageThreshold;
}

export interface ActionCoverageMergeResult {
  readonly schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
  readonly analyzer: 'coverage.route-action-merge';
  readonly outcome: 'PASS' | 'FAIL' | 'NOT_VERIFIED';
  readonly runCount: number;
  readonly target: TargetFingerprint | null;
  readonly result: ActionCoverageResult | null;
  readonly limitations: readonly string[];
}

export type CoverageDeltaKind =
  | 'new-coverage'
  | 'regression'
  | 'unchanged'
  | 'not-comparable';

export interface CoverageDeltaEntry {
  readonly routeId: string;
  readonly actionId?: string;
  readonly before: CoverageStatus;
  readonly after: CoverageStatus;
  readonly change: CoverageDeltaKind;
}

export interface ActionCoverageDelta {
  readonly schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
  readonly analyzer: 'coverage.route-action-delta';
  readonly outcome: 'PASS' | 'NOT_VERIFIED';
  readonly target: TargetFingerprint | null;
  readonly routes: readonly CoverageDeltaEntry[];
  readonly actions: readonly CoverageDeltaEntry[];
  readonly counts: {
    readonly newCoverage: number;
    readonly regressions: number;
    readonly unchanged: number;
    readonly notComparable: number;
  };
  readonly limitations: readonly string[];
}

interface ParsedCoverageAction {
  id: string;
  observable: boolean;
}

interface ParsedCoverageRoute {
  id: string;
  observable: boolean;
  actions: ParsedCoverageAction[];
}

interface ParsedCoverageInteraction {
  routeId: string | null;
  actionId: string | null;
  correlationId?: string | null;
}

interface ParsedCoverageCheckpoint {
  routeId: string | null;
  interactions: ParsedCoverageInteraction[];
  correlationId?: string | null;
}

interface ParsedCoverageInput {
  target: TargetFingerprint;
  inventory: { routes: ParsedCoverageRoute[] };
  checkpoints: ParsedCoverageCheckpoint[];
  threshold?: CoverageThreshold;
}

interface MutableActionState {
  id: string;
  observable: boolean;
  covered: boolean;
}

interface MutableRouteState {
  id: string;
  observable: boolean;
  covered: boolean;
  actions: MutableActionState[];
}

interface MutableObservationCounts {
  inputCheckpoints: number;
  usableEvidence: number;
  observedCheckpoints: number;
  observedInteractions: number;
  ignoredNullRoutes: number;
  ignoredUnknownRoutes: number;
  ignoredNullActions: number;
  ignoredUnknownActions: number;
  ignoredNotObservable: number;
}

interface ResultBuildOptions {
  target: TargetFingerprint;
  states: MutableRouteState[];
  observations: MutableObservationCounts;
  evidenceDigests: SanitizedCoverageEvidence[];
  evidenceDigestTruncated: number;
  threshold?: CoverageThreshold;
  additionalLimitations?: readonly string[];
}

interface MergeSafeResult {
  target: TargetFingerprint;
  states: MutableRouteState[];
  observations: MutableObservationCounts;
  threshold?: CoverageThreshold;
  outcome: ActionCoverageResult['outcome'];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const jsonByteLength = (value: unknown, path: string): number => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError(`${path} must be JSON serializable`);
  }
  if (serialized === undefined) {
    throw new TypeError(`${path} must be JSON serializable`);
  }
  return Buffer.byteLength(serialized, 'utf8');
};

const assertExactKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${path} contains unsupported keys`);
  }
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new TypeError(`${path} is missing required keys`);
  }
};

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  return value;
};

const asArray = (
  value: unknown,
  path: string,
  maximum: number,
): unknown[] => {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  if (value.length > maximum) {
    throw new RangeError(`${path} exceeds its maximum item count`);
  }
  return value;
};

const isAbsolutePath = (value: string): boolean =>
  ABSOLUTE_PATH_PATTERN.test(value);

const semanticId = (value: unknown, path: string): string => {
  if (typeof value !== 'string') {
    throw new TypeError(`${path} must be a string`);
  }
  if (
    value.length === 0 ||
    value.length > MAX_SEMANTIC_ID_LENGTH ||
    value.trim() !== value ||
    !SEMANTIC_ID_PATTERN.test(value) ||
    value.includes('..') ||
    isAbsolutePath(value)
  ) {
    throw new TypeError(`${path} must be a safe semantic identifier`);
  }
  return value;
};

const nullableSemanticId = (value: unknown, path: string): string | null =>
  value === null ? null : semanticId(value, path);

const optionalCorrelationId = (
  value: unknown,
  path: string,
): string | null | undefined => {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CORRELATION_ID_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${path} must be a bounded correlation identifier`);
  }
  return value;
};

const safeTarget = (value: unknown): TargetFingerprint => {
  const record = asRecord(value, 'target');
  const targetKeys = [
    'platform',
    'deviceId',
    'appId',
    'appVersion',
    'buildId',
    'sourceRevision',
    'operatingSystem',
    'architecture',
    'reactNativeVersion',
    'expoVersion',
    'hermesVersion',
    'deviceClass',
  ] as const;
  assertExactKeys(record, targetKeys, ['platform', 'deviceId', 'appId'], 'target');
  let parsed: TargetFingerprint;
  try {
    parsed = TargetFingerprintSchema.parse(record);
  } catch {
    throw new TypeError('target must conform to the target fingerprint schema');
  }
  for (const value of Object.values(parsed)) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      value.length > MAX_TARGET_VALUE_LENGTH ||
      value.trim() !== value ||
      /[\u0000-\u001f\u007f]/u.test(value) ||
      isAbsolutePath(value)
    ) {
      throw new TypeError('target contains an unsafe value');
    }
  }
  return parsed;
};

const threshold = (value: unknown, path: string): CoverageThreshold => {
  const record = asRecord(value, path);
  assertExactKeys(
    record,
    ['minimumCoverageRatio', 'minimumObservableItems', 'minimumEvidence'],
    ['minimumCoverageRatio', 'minimumObservableItems', 'minimumEvidence'],
    path,
  );
  const minimumCoverageRatio = record.minimumCoverageRatio;
  const minimumObservableItems = record.minimumObservableItems;
  const minimumEvidence = record.minimumEvidence;
  if (
    typeof minimumCoverageRatio !== 'number' ||
    !Number.isFinite(minimumCoverageRatio) ||
    minimumCoverageRatio <= 0 ||
    minimumCoverageRatio > 1
  ) {
    throw new RangeError(
      `${path}.minimumCoverageRatio must be a finite number greater than 0 and at most 1`,
    );
  }
  if (
    typeof minimumObservableItems !== 'number' ||
    !Number.isInteger(minimumObservableItems) ||
    minimumObservableItems < 1 ||
    minimumObservableItems > MAX_THRESHOLD_OBSERVABLE_ITEMS
  ) {
    throw new RangeError(
      `${path}.minimumObservableItems is out of supported bounds`,
    );
  }
  if (
    typeof minimumEvidence !== 'number' ||
    !Number.isInteger(minimumEvidence) ||
    minimumEvidence < 1 ||
    minimumEvidence > MAX_THRESHOLD_EVIDENCE
  ) {
    throw new RangeError(`${path}.minimumEvidence is out of supported bounds`);
  }
  return {
    minimumCoverageRatio,
    minimumObservableItems,
    minimumEvidence,
  };
};

const parsedRoute = (value: unknown, path: string): ParsedCoverageRoute => {
  const record = asRecord(value, path);
  assertExactKeys(record, ['id', 'observable', 'actions'], ['id', 'observable', 'actions'], path);
  if (typeof record.observable !== 'boolean') {
    throw new TypeError(`${path}.observable must be a boolean`);
  }
  const rawActions = asArray(
    record.actions,
    `${path}.actions`,
    MAX_COVERAGE_ACTIONS_PER_ROUTE,
  );
  const actions = rawActions.map((entry, index) => {
    const action = asRecord(entry, `${path}.actions[${index}]`);
    assertExactKeys(
      action,
      ['id', 'observable'],
      ['id', 'observable'],
      `${path}.actions[${index}]`,
    );
    if (typeof action.observable !== 'boolean') {
      throw new TypeError(`${path}.actions[${index}].observable must be a boolean`);
    }
    return {
      id: semanticId(action.id, `${path}.actions[${index}].id`),
      observable: action.observable,
    };
  });
  return {
    id: semanticId(record.id, `${path}.id`),
    observable: record.observable,
    actions,
  };
};

const parsedInteraction = (
  value: unknown,
  path: string,
): ParsedCoverageInteraction => {
  const record = asRecord(value, path);
  assertExactKeys(
    record,
    ['routeId', 'actionId', 'correlationId'],
    ['routeId', 'actionId'],
    path,
  );
  const correlationId = optionalCorrelationId(
    record.correlationId,
    `${path}.correlationId`,
  );
  return {
    routeId: nullableSemanticId(record.routeId, `${path}.routeId`),
    actionId: nullableSemanticId(record.actionId, `${path}.actionId`),
    ...(correlationId === undefined ? {} : { correlationId }),
  };
};

const parsedCheckpoint = (
  value: unknown,
  path: string,
): ParsedCoverageCheckpoint => {
  const record = asRecord(value, path);
  assertExactKeys(
    record,
    ['routeId', 'interactions', 'correlationId'],
    ['routeId', 'interactions'],
    path,
  );
  const rawInteractions = asArray(
    record.interactions,
    `${path}.interactions`,
    MAX_COVERAGE_INTERACTIONS_PER_CHECKPOINT,
  );
  const correlationId = optionalCorrelationId(
    record.correlationId,
    `${path}.correlationId`,
  );
  return {
    routeId: nullableSemanticId(record.routeId, `${path}.routeId`),
    interactions: rawInteractions.map((entry, index) =>
      parsedInteraction(entry, `${path}.interactions[${index}]`),
    ),
    ...(correlationId === undefined ? {} : { correlationId }),
  };
};

/**
 * Parses untrusted provider data. The schema is intentionally closed: text,
 * payload, source, sourcePath, screenshots and arbitrary metadata are not
 * accepted by this coverage protocol.
 */
export const parseActionCoverageInput = (
  value: unknown,
): ActionCoverageInput => {
  if (jsonByteLength(value, 'coverage input') > MAX_COVERAGE_INPUT_BYTES) {
    throw new RangeError('coverage input exceeds its maximum byte size');
  }
  const record = asRecord(value, 'coverage input');
  assertExactKeys(
    record,
    ['target', 'inventory', 'checkpoints', 'threshold'],
    ['target', 'inventory', 'checkpoints'],
    'coverage input',
  );
  const rawInventory = asRecord(record.inventory, 'inventory');
  assertExactKeys(rawInventory, ['routes'], ['routes'], 'inventory');
  const rawRoutes = asArray(
    rawInventory.routes,
    'inventory.routes',
    MAX_COVERAGE_ROUTES,
  );
  const routes = rawRoutes.map((entry, index) =>
    parsedRoute(entry, `inventory.routes[${index}]`),
  );
  const routeIds = new Set<string>();
  const actionIds = new Set<string>();
  let actionCount = 0;
  for (const route of routes) {
    if (routeIds.has(route.id)) {
      throw new TypeError('inventory contains duplicate route identifiers');
    }
    routeIds.add(route.id);
    for (const action of route.actions) {
      actionCount += 1;
      if (actionCount > MAX_COVERAGE_ACTIONS) {
        throw new RangeError('inventory exceeds its maximum action count');
      }
      if (actionIds.has(action.id)) {
        throw new TypeError('inventory contains duplicate semantic action identifiers');
      }
      actionIds.add(action.id);
    }
  }
  const rawCheckpoints = asArray(
    record.checkpoints,
    'checkpoints',
    MAX_COVERAGE_CHECKPOINTS,
  );
  let interactionCount = 0;
  const checkpoints = rawCheckpoints.map((entry, index) => {
    const checkpoint = parsedCheckpoint(entry, `checkpoints[${index}]`);
    interactionCount += checkpoint.interactions.length;
    if (interactionCount > MAX_COVERAGE_INTERACTIONS) {
      throw new RangeError('checkpoints exceed their maximum interaction count');
    }
    return checkpoint;
  });
  const parsed: ParsedCoverageInput = {
    target: safeTarget(record.target),
    inventory: { routes },
    checkpoints,
    ...(record.threshold === undefined
      ? {}
      : { threshold: threshold(record.threshold, 'threshold') }),
  };
  return parsed;
};

const emptyObservationCounts = (
  inputCheckpoints: number,
): MutableObservationCounts => ({
  inputCheckpoints,
  usableEvidence: 0,
  observedCheckpoints: 0,
  observedInteractions: 0,
  ignoredNullRoutes: 0,
  ignoredUnknownRoutes: 0,
  ignoredNullActions: 0,
  ignoredUnknownActions: 0,
  ignoredNotObservable: 0,
});

const statesFor = (
  inventory: { readonly routes: readonly ParsedCoverageRoute[] },
): MutableRouteState[] =>
  inventory.routes.map((route) => ({
    id: route.id,
    observable: route.observable,
    covered: false,
    actions: route.actions.map((action) => ({
      id: action.id,
      observable: route.observable && action.observable,
      covered: false,
    })),
  }));

const digestFor = (input: {
  kind: SanitizedCoverageEvidence['kind'];
  index: number;
  nestedIndex?: number;
  routeId: string;
  actionId?: string | null;
  correlationId?: string | null;
}): SanitizedCoverageEvidence => {
  const correlationHash =
    input.correlationId === undefined || input.correlationId === null
      ? undefined
      : sha256(input.correlationId);
  const canonical = JSON.stringify({
    kind: input.kind,
    index: input.index,
    ...(input.nestedIndex === undefined
      ? {}
      : { nestedIndex: input.nestedIndex }),
    routeId: input.routeId,
    ...(input.actionId === undefined || input.actionId === null
      ? {}
      : { actionId: input.actionId }),
    ...(correlationHash === undefined ? {} : { correlationHash }),
  });
  return {
    kind: input.kind,
    eventHash: sha256(canonical),
    ...(correlationHash === undefined ? {} : { correlationHash }),
  };
};

const pushDigest = (
  digests: SanitizedCoverageEvidence[],
  digest: SanitizedCoverageEvidence,
): number => {
  if (digests.length >= MAX_COVERAGE_EVIDENCE_DIGESTS) return 1;
  digests.push(digest);
  return 0;
};

const statusFor = (observable: boolean, covered: boolean): CoverageStatus =>
  !observable ? 'not-observable' : covered ? 'covered' : 'uncovered';

const countStatuses = (
  statuses: readonly CoverageStatus[],
): CoverageCounts => {
  const covered = statuses.filter((status) => status === 'covered').length;
  const uncovered = statuses.filter((status) => status === 'uncovered').length;
  const notObservable = statuses.filter(
    (status) => status === 'not-observable',
  ).length;
  return {
    total: statuses.length,
    observable: covered + uncovered,
    covered,
    uncovered,
    notObservable,
  };
};

const ratioFor = (counts: CoverageCounts): number | null =>
  counts.observable === 0 ? null : counts.covered / counts.observable;

const aggregateEvidence = (
  states: readonly MutableRouteState[],
  observations: MutableObservationCounts,
  evidenceDigests: readonly SanitizedCoverageEvidence[],
  evidenceDigestTruncated: number,
): EvidenceReference[] => {
  if (observations.usableEvidence === 0) return [];
  const summary = {
    routes: states.map((route) => ({
      id: route.id,
      observable: route.observable,
      covered: route.covered,
      actions: route.actions.map((action) => ({
        id: action.id,
        observable: action.observable,
        covered: action.covered,
      })),
    })),
    observations,
    evidenceDigests,
    evidenceDigestTruncated,
  };
  const digest = sha256(JSON.stringify(summary));
  return [
    {
      id: `coverage-summary-${digest.slice(0, 16)}`,
      kind: 'route-action-coverage-summary',
      relation: 'supports',
      sha256: digest,
    },
  ];
};

const sameThreshold = (
  left: CoverageThreshold | undefined,
  right: CoverageThreshold | undefined,
): boolean =>
  left?.minimumCoverageRatio === right?.minimumCoverageRatio &&
  left?.minimumObservableItems === right?.minimumObservableItems &&
  left?.minimumEvidence === right?.minimumEvidence;

const resultFromStates = (options: ResultBuildOptions): ActionCoverageResult => {
  const selectedThreshold = options.threshold;
  const routes = options.states.map<CoverageRouteResult>((route) => ({
    routeId: route.id,
    status: statusFor(route.observable, route.covered),
    actions: route.actions.map<CoverageActionResult>((action) => ({
      routeId: route.id,
      actionId: action.id,
      status: statusFor(action.observable, action.covered),
    })),
  }));
  const routeStatuses = routes.map((route) => route.status);
  const actionStatuses = routes.flatMap((route) =>
    route.actions.map((action) => action.status),
  );
  const routeCounts = countStatuses(routeStatuses);
  const actionCounts = countStatuses(actionStatuses);
  const overallCounts = countStatuses([...routeStatuses, ...actionStatuses]);
  const ratios: CoverageRatios = {
    routes: ratioFor(routeCounts),
    actions: ratioFor(actionCounts),
    overall: ratioFor(overallCounts),
  };
  const limitations = [
    'Coverage is limited to declared semantic route/action identifiers and supplied checkpoint/interactions; it does not infer route identity from text, source, coordinates, or null/unknown values.',
    'A covered item means matching target-scoped evidence was observed, not that every behavior, state, or implementation path was tested.',
    ...(options.additionalLimitations ?? []),
  ];
  if (routeCounts.total === 0 || actionCounts.total === 0) {
    limitations.push(
      'A non-empty declared route inventory and semantic action inventory are required.',
    );
  }
  if (options.observations.inputCheckpoints === 0) {
    limitations.push('No evidence checkpoints were supplied.');
  }
  if (selectedThreshold === undefined) {
    limitations.push(
      'No explicit coverage threshold was supplied, so this result cannot pass.',
    );
  }
  if (overallCounts.observable === 0) {
    limitations.push('No declared route or action was observable.');
  }
  if (
    selectedThreshold !== undefined &&
    overallCounts.observable < selectedThreshold.minimumObservableItems
  ) {
    limitations.push(
      `Only ${overallCounts.observable}/${selectedThreshold.minimumObservableItems} required observable entries were declared.`,
    );
  }
  if (
    selectedThreshold !== undefined &&
    options.observations.usableEvidence < selectedThreshold.minimumEvidence
  ) {
    limitations.push(
      `Only ${options.observations.usableEvidence}/${selectedThreshold.minimumEvidence} required usable evidence observations were available.`,
    );
  }
  const evidence = aggregateEvidence(
    options.states,
    options.observations,
    options.evidenceDigests,
    options.evidenceDigestTruncated,
  );
  const canEvaluate =
    routeCounts.total > 0 &&
    actionCounts.total > 0 &&
    options.observations.inputCheckpoints > 0 &&
    selectedThreshold !== undefined &&
    overallCounts.observable >= selectedThreshold.minimumObservableItems &&
    options.observations.usableEvidence >= selectedThreshold.minimumEvidence &&
    ratios.overall !== null;
  const outcome: ActionCoverageResult['outcome'] = !canEvaluate
    ? 'NOT_VERIFIED'
    : (ratios.overall ?? 0) >= selectedThreshold.minimumCoverageRatio
      ? 'PASS'
      : 'FAIL';
  const finding: AssuranceFinding = {
    schemaVersion: '1.0',
    id: 'functional.route-action-coverage',
    ruleId: 'functional.route-action-coverage',
    title:
      outcome === 'PASS'
        ? 'Declared route/action coverage met its threshold'
        : outcome === 'FAIL'
          ? 'Declared route/action coverage missed its threshold'
          : 'Declared route/action coverage was not verified',
    description:
      ratios.overall === null
        ? 'No observable declared coverage entries were available for a coverage ratio.'
        : `Observed coverage ratio=${ratios.overall.toFixed(4)} across ${overallCounts.observable} observable declared route/action entries.`,
    outcome,
    severity: outcome === 'FAIL' ? 'medium' : 'info',
    confidence: outcome === 'NOT_VERIFIED' ? 1 : 0.95,
    category: 'functional',
    controls: [],
    evidence,
    ...(outcome === 'FAIL'
      ? {
          remediation:
            'Add target-scoped checkpoints/interactions for uncovered declared semantic IDs, then repeat the same coverage run.',
        }
      : {}),
    limitations: outcome === 'NOT_VERIFIED' ? limitations : [],
  };
  return {
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    analyzer: 'coverage.route-action',
    target: options.target,
    outcome,
    routes,
    counts: {
      routes: routeCounts,
      actions: actionCounts,
      overall: overallCounts,
    },
    ratios,
    observations: options.observations,
    evidence,
    evidenceDigests: options.evidenceDigests,
    evidenceDigestTruncated: options.evidenceDigestTruncated,
    findings: [finding],
    limitations,
    ...(selectedThreshold === undefined ? {} : { threshold: selectedThreshold }),
  };
};

/**
 * Calculates route/action coverage solely from explicit route/action values.
 * In particular, an action under a null or unknown route is discarded rather
 * than being assigned to a route with a matching action ID.
 */
export const analyzeActionCoverage = (
  input: unknown,
): ActionCoverageResult => {
  const parsed = parseActionCoverageInput(input) as ParsedCoverageInput;
  const states = statesFor(parsed.inventory);
  const routes = new Map(states.map((route) => [route.id, route]));
  const observations = emptyObservationCounts(parsed.checkpoints.length);
  const evidenceDigests: SanitizedCoverageEvidence[] = [];
  let evidenceDigestTruncated = 0;
  for (const [checkpointIndex, checkpoint] of parsed.checkpoints.entries()) {
    let checkpointRoute: MutableRouteState | undefined;
    if (checkpoint.routeId === null) {
      observations.ignoredNullRoutes += 1;
    } else {
      checkpointRoute = routes.get(checkpoint.routeId);
      if (!checkpointRoute) {
        observations.ignoredUnknownRoutes += 1;
      } else if (!checkpointRoute.observable) {
        observations.ignoredNotObservable += 1;
        checkpointRoute = undefined;
      } else {
        checkpointRoute.covered = true;
        observations.usableEvidence += 1;
        observations.observedCheckpoints += 1;
        evidenceDigestTruncated += pushDigest(
          evidenceDigests,
          digestFor({
            kind: 'checkpoint',
            index: checkpointIndex,
            routeId: checkpointRoute.id,
            ...(checkpoint.correlationId === undefined
              ? {}
              : { correlationId: checkpoint.correlationId }),
          }),
        );
      }
    }
    for (const [interactionIndex, interaction] of checkpoint.interactions.entries()) {
      if (interaction.routeId === null) {
        observations.ignoredNullRoutes += 1;
        continue;
      }
      const interactionRoute = routes.get(interaction.routeId);
      if (!interactionRoute) {
        observations.ignoredUnknownRoutes += 1;
        continue;
      }
      if (!interactionRoute.observable) {
        observations.ignoredNotObservable += 1;
        continue;
      }
      // The interaction declares its own route. Do not use checkpointRoute as
      // a fallback; this prevents accidental attribution across navigation.
      interactionRoute.covered = true;
      observations.usableEvidence += 1;
      observations.observedInteractions += 1;
      const action =
        interaction.actionId === null
          ? undefined
          : interactionRoute.actions.find(
              (candidate) => candidate.id === interaction.actionId,
            );
      if (interaction.actionId === null) {
        observations.ignoredNullActions += 1;
      } else if (!action) {
        observations.ignoredUnknownActions += 1;
      } else if (!action.observable) {
        observations.ignoredNotObservable += 1;
      } else {
        action.covered = true;
      }
      evidenceDigestTruncated += pushDigest(
        evidenceDigests,
        digestFor({
          kind: 'interaction',
          index: checkpointIndex,
          nestedIndex: interactionIndex,
          routeId: interactionRoute.id,
          ...(action === undefined ? {} : { actionId: action.id }),
          ...(interaction.correlationId === undefined
            ? {}
            : { correlationId: interaction.correlationId }),
        }),
      );
    }
    // Keep the variable intentionally scoped: a checkpoint's route cannot be
    // used to infer a nested interaction's route.
    void checkpointRoute;
  }
  return resultFromStates({
    target: parsed.target,
    states,
    observations,
    evidenceDigests,
    evidenceDigestTruncated,
    ...(parsed.threshold === undefined ? {} : { threshold: parsed.threshold }),
  });
};

const exactTargetFields: readonly (keyof TargetFingerprint)[] = [
  'platform',
  'deviceId',
  'appId',
  'appVersion',
  'buildId',
  'sourceRevision',
  'operatingSystem',
  'architecture',
  'reactNativeVersion',
  'expoVersion',
  'hermesVersion',
  'deviceClass',
];

/**
 * Conservative by design: a merge/delta is allowed only for exactly matching
 * target fingerprints. It is better to return NOT_VERIFIED than blend device,
 * runtime, or build evidence.
 */
export const coverageTargetsCompatible = (
  left: TargetFingerprint,
  right: TargetFingerprint,
): boolean =>
  exactTargetFields.every((field) => left[field] === right[field]);

const coverageStatus = (value: unknown, path: string): CoverageStatus => {
  if (
    value !== 'covered' &&
    value !== 'uncovered' &&
    value !== 'not-observable'
  ) {
    throw new TypeError(`${path} has an unsupported coverage status`);
  }
  return value;
};

const nonNegativeCount = (value: unknown, path: string): number => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_THRESHOLD_EVIDENCE
  ) {
    throw new RangeError(`${path} must be a bounded non-negative integer`);
  }
  return value;
};

const resultStates = (value: unknown): MergeSafeResult => {
  const record = asRecord(value, 'coverage result');
  const analyzer = record.analyzer;
  if (analyzer !== 'coverage.route-action') {
    throw new TypeError('coverage result has an unsupported analyzer');
  }
  const outcome = record.outcome;
  if (outcome !== 'PASS' && outcome !== 'FAIL' && outcome !== 'NOT_VERIFIED') {
    throw new TypeError('coverage result has an unsupported outcome');
  }
  const rawRoutes = asArray(record.routes, 'coverage result.routes', MAX_COVERAGE_ROUTES);
  const routeIds = new Set<string>();
  const actionIds = new Set<string>();
  let actions = 0;
  const states = rawRoutes.map((entry, routeIndex) => {
    const route = asRecord(entry, `coverage result.routes[${routeIndex}]`);
    const id = semanticId(route.routeId, `coverage result.routes[${routeIndex}].routeId`);
    if (routeIds.has(id)) {
      throw new TypeError('coverage result contains duplicate route identifiers');
    }
    routeIds.add(id);
    const routeStatus = coverageStatus(
      route.status,
      `coverage result.routes[${routeIndex}].status`,
    );
    const rawActions = asArray(
      route.actions,
      `coverage result.routes[${routeIndex}].actions`,
      MAX_COVERAGE_ACTIONS_PER_ROUTE,
    );
    return {
      id,
      observable: routeStatus !== 'not-observable',
      covered: routeStatus === 'covered',
      actions: rawActions.map((actionEntry, actionIndex) => {
        actions += 1;
        if (actions > MAX_COVERAGE_ACTIONS) {
          throw new RangeError('coverage result exceeds its maximum action count');
        }
        const action = asRecord(
          actionEntry,
          `coverage result.routes[${routeIndex}].actions[${actionIndex}]`,
        );
        const actionId = semanticId(
          action.actionId,
          `coverage result.routes[${routeIndex}].actions[${actionIndex}].actionId`,
        );
        if (action.routeId !== id) {
          throw new TypeError('coverage result action route identifiers must match their parent route');
        }
        if (actionIds.has(actionId)) {
          throw new TypeError('coverage result contains duplicate semantic action identifiers');
        }
        actionIds.add(actionId);
        const actionStatus = coverageStatus(
          action.status,
          `coverage result.routes[${routeIndex}].actions[${actionIndex}].status`,
        );
        if (routeStatus === 'not-observable' && actionStatus !== 'not-observable') {
          throw new TypeError('an unobservable route cannot contain an observable action');
        }
        return {
          id: actionId,
          observable: actionStatus !== 'not-observable',
          covered: actionStatus === 'covered',
        };
      }),
    };
  });
  const rawObservations = asRecord(record.observations, 'coverage result.observations');
  const observations: MutableObservationCounts = {
    inputCheckpoints: nonNegativeCount(
      rawObservations.inputCheckpoints,
      'coverage result.observations.inputCheckpoints',
    ),
    usableEvidence: nonNegativeCount(
      rawObservations.usableEvidence,
      'coverage result.observations.usableEvidence',
    ),
    observedCheckpoints: nonNegativeCount(
      rawObservations.observedCheckpoints,
      'coverage result.observations.observedCheckpoints',
    ),
    observedInteractions: nonNegativeCount(
      rawObservations.observedInteractions,
      'coverage result.observations.observedInteractions',
    ),
    ignoredNullRoutes: nonNegativeCount(
      rawObservations.ignoredNullRoutes,
      'coverage result.observations.ignoredNullRoutes',
    ),
    ignoredUnknownRoutes: nonNegativeCount(
      rawObservations.ignoredUnknownRoutes,
      'coverage result.observations.ignoredUnknownRoutes',
    ),
    ignoredNullActions: nonNegativeCount(
      rawObservations.ignoredNullActions,
      'coverage result.observations.ignoredNullActions',
    ),
    ignoredUnknownActions: nonNegativeCount(
      rawObservations.ignoredUnknownActions,
      'coverage result.observations.ignoredUnknownActions',
    ),
    ignoredNotObservable: nonNegativeCount(
      rawObservations.ignoredNotObservable,
      'coverage result.observations.ignoredNotObservable',
    ),
  };
  return {
    target: safeTarget(record.target),
    states,
    observations,
    outcome,
    ...(record.threshold === undefined
      ? {}
      : { threshold: threshold(record.threshold, 'coverage result.threshold') }),
  };
};

const sameInventory = (
  left: readonly MutableRouteState[],
  right: readonly MutableRouteState[],
): boolean =>
  left.length === right.length &&
  left.every((route, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      route.id === candidate.id &&
      route.observable === candidate.observable &&
      route.actions.length === candidate.actions.length &&
      route.actions.every((action, actionIndex) => {
        const next = candidate.actions[actionIndex];
        return (
          next !== undefined &&
          action.id === next.id &&
          action.observable === next.observable
        );
      })
    );
  });

const cloneStates = (
  states: readonly MutableRouteState[],
): MutableRouteState[] =>
  states.map((route) => ({
    id: route.id,
    observable: route.observable,
    covered: route.covered,
    actions: route.actions.map((action) => ({ ...action })),
  }));

const addObservationCounts = (
  left: MutableObservationCounts,
  right: MutableObservationCounts,
): MutableObservationCounts => ({
  inputCheckpoints: left.inputCheckpoints + right.inputCheckpoints,
  usableEvidence: left.usableEvidence + right.usableEvidence,
  observedCheckpoints: left.observedCheckpoints + right.observedCheckpoints,
  observedInteractions: left.observedInteractions + right.observedInteractions,
  ignoredNullRoutes: left.ignoredNullRoutes + right.ignoredNullRoutes,
  ignoredUnknownRoutes: left.ignoredUnknownRoutes + right.ignoredUnknownRoutes,
  ignoredNullActions: left.ignoredNullActions + right.ignoredNullActions,
  ignoredUnknownActions: left.ignoredUnknownActions + right.ignoredUnknownActions,
  ignoredNotObservable: left.ignoredNotObservable + right.ignoredNotObservable,
});

/**
 * Unions coverage from compatible runs. A target mismatch is a normal
 * NOT_VERIFIED result rather than a thrown error, so CI can report why a
 * cross-device/community aggregation was intentionally refused.
 */
export const mergeActionCoverageRuns = (
  runs: readonly ActionCoverageResult[],
  options: ActionCoverageMergeOptions = {},
): ActionCoverageMergeResult => {
  if (runs.length === 0 || runs.length > MAX_COVERAGE_MERGE_RUNS) {
    throw new RangeError(
      `runs must contain from 1 to ${MAX_COVERAGE_MERGE_RUNS} coverage results`,
    );
  }
  const parsedRuns = runs.map((run) => resultStates(run));
  const first = parsedRuns[0];
  if (!first) throw new Error('coverage merge invariant: no first run');
  if (
    parsedRuns.some(
      (run) => !coverageTargetsCompatible(first.target, run.target),
    )
  ) {
    return {
      schemaVersion: COVERAGE_SCHEMA_VERSION,
      analyzer: 'coverage.route-action-merge',
      outcome: 'NOT_VERIFIED',
      runCount: runs.length,
      target: null,
      result: null,
      limitations: [
        'Coverage runs have incompatible target fingerprints and were not merged.',
      ],
    };
  }
  if (parsedRuns.some((run) => !sameInventory(first.states, run.states))) {
    return {
      schemaVersion: COVERAGE_SCHEMA_VERSION,
      analyzer: 'coverage.route-action-merge',
      outcome: 'NOT_VERIFIED',
      runCount: runs.length,
      target: first.target,
      result: null,
      limitations: [
        'Coverage runs have different declared route/action inventories and were not merged.',
      ],
    };
  }
  const requestedThreshold =
    options.threshold === undefined
      ? undefined
      : threshold(options.threshold, 'merge threshold');
  const inheritedThreshold = parsedRuns.every((run) =>
    sameThreshold(first.threshold, run.threshold),
  )
    ? first.threshold
    : undefined;
  const selectedThreshold = requestedThreshold ?? inheritedThreshold;
  const states = cloneStates(first.states);
  let observations = emptyObservationCounts(0);
  for (const run of parsedRuns) {
    observations = addObservationCounts(observations, run.observations);
    for (const [routeIndex, route] of run.states.entries()) {
      const targetRoute = states[routeIndex];
      if (!targetRoute) continue;
      targetRoute.covered ||= route.covered;
      for (const [actionIndex, action] of route.actions.entries()) {
        const targetAction = targetRoute.actions[actionIndex];
        if (targetAction) targetAction.covered ||= action.covered;
      }
    }
  }
  const result = resultFromStates({
    target: first.target,
    states,
    observations,
    evidenceDigests: [],
    evidenceDigestTruncated: observations.usableEvidence,
    ...(selectedThreshold === undefined ? {} : { threshold: selectedThreshold }),
    additionalLimitations:
      requestedThreshold === undefined && inheritedThreshold === undefined
        ? [
            'Merged runs used different or missing thresholds; provide an explicit merge threshold to make this result eligible to pass.',
          ]
        : [`Coverage was merged from ${runs.length} compatible runs.`],
  });
  return {
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    analyzer: 'coverage.route-action-merge',
    outcome: result.outcome,
    runCount: runs.length,
    target: first.target,
    result,
    limitations:
      result.outcome === 'NOT_VERIFIED'
        ? result.limitations
        : [`Coverage was merged from ${runs.length} compatible runs.`],
  };
};

const deltaKind = (
  before: CoverageStatus,
  after: CoverageStatus,
): CoverageDeltaKind => {
  if (before === 'not-observable' || after === 'not-observable') {
    return 'not-comparable';
  }
  if (before === 'uncovered' && after === 'covered') return 'new-coverage';
  if (before === 'covered' && after === 'uncovered') return 'regression';
  return 'unchanged';
};

const deltaCounts = (
  entries: readonly CoverageDeltaEntry[],
): ActionCoverageDelta['counts'] => ({
  newCoverage: entries.filter((entry) => entry.change === 'new-coverage')
    .length,
  regressions: entries.filter((entry) => entry.change === 'regression').length,
  unchanged: entries.filter((entry) => entry.change === 'unchanged').length,
  notComparable: entries.filter((entry) => entry.change === 'not-comparable')
    .length,
});

/**
 * Produces a status-only before/after delta. It does not invent deltas for
 * incompatible targets, changed inventories, or insufficient-evidence runs.
 */
export const deltaActionCoverage = (
  beforeResult: ActionCoverageResult,
  afterResult: ActionCoverageResult,
): ActionCoverageDelta => {
  const before = resultStates(beforeResult);
  const after = resultStates(afterResult);
  const unavailable = (limitation: string): ActionCoverageDelta => ({
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    analyzer: 'coverage.route-action-delta',
    outcome: 'NOT_VERIFIED',
    target: null,
    routes: [],
    actions: [],
    counts: {
      newCoverage: 0,
      regressions: 0,
      unchanged: 0,
      notComparable: 0,
    },
    limitations: [limitation],
  });
  if (!coverageTargetsCompatible(before.target, after.target)) {
    return unavailable(
      'Before and after coverage results have incompatible target fingerprints.',
    );
  }
  if (!sameInventory(before.states, after.states)) {
    return unavailable(
      'Before and after coverage results have different declared route/action inventories.',
    );
  }
  if (before.outcome === 'NOT_VERIFIED' || after.outcome === 'NOT_VERIFIED') {
    return unavailable(
      'Before and after coverage must both be verified before a coverage delta is reported.',
    );
  }
  const routes = before.states.flatMap<CoverageDeltaEntry>((route, routeIndex) => {
    const next = after.states[routeIndex];
    if (!next) return [];
    const beforeStatus = statusFor(route.observable, route.covered);
    const afterStatus = statusFor(next.observable, next.covered);
    return [
      {
        routeId: route.id,
        before: beforeStatus,
        after: afterStatus,
        change: deltaKind(beforeStatus, afterStatus),
      },
    ];
  });
  const actions = before.states.flatMap<CoverageDeltaEntry>((route, routeIndex) => {
    const nextRoute = after.states[routeIndex];
    if (!nextRoute) return [];
    return route.actions.flatMap<CoverageDeltaEntry>((action, actionIndex) => {
      const next = nextRoute.actions[actionIndex];
      if (!next) return [];
      const beforeStatus = statusFor(action.observable, action.covered);
      const afterStatus = statusFor(next.observable, next.covered);
      return [
        {
          routeId: route.id,
          actionId: action.id,
          before: beforeStatus,
          after: afterStatus,
          change: deltaKind(beforeStatus, afterStatus),
        },
      ];
    });
  });
  const counts = deltaCounts([...routes, ...actions]);
  return {
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    analyzer: 'coverage.route-action-delta',
    outcome: 'PASS',
    target: before.target,
    routes,
    actions,
    counts,
    limitations: [
      'The delta compares only explicit declared semantic route/action status; it does not identify source-level change causes.',
    ],
  };
};
