import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  AssuranceFindingSchema,
  EvidenceEnvelopeSchema,
  SessionSchema,
  TargetFingerprintSchema,
  type Artifact,
  type AssuranceFinding,
  type EvidenceEnvelope,
  type Session,
  type TargetFingerprint,
} from '@rn-agent-observer/schemas';
import { scanSecrets } from '../security/secret-scanner.js';

export const DEFAULT_DASHBOARD_METADATA_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_DASHBOARD_METADATA_BYTES = 8 * 1024 * 1024;
export const MAX_DASHBOARD_RUNS = 100;

export const DASHBOARD_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "connect-src 'none'",
  "font-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "img-src 'none'",
  "manifest-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
  "style-src 'none'",
  "worker-src 'none'",
  'sandbox',
].join('; ');

const EVENT_TYPES = [
  'a11y_audit',
  'app_data',
  'app_interaction',
  'app_state',
  'assertion',
  'back',
  'comparison',
  'coverage_analysis',
  'deep_link',
  'device_network',
  'devtools_export',
  'devtools_profile',
  'diagnosis',
  'launch',
  'logs',
  'metro_network',
  'observation',
  'performance',
  'permission_changed',
  'permissions',
  'recording_started',
  'recording_stopped',
  'reload',
  'replay',
  'replay_export',
  'routes',
  'runtime_ui_capture_failed',
  'runtime_ui_model',
  'screen_understanding',
  'security_active_scenario',
  'session_share_bundle',
  'screenshot',
  'session_context',
  'snapshot',
  'swipe',
  'tap',
  'trace_started',
  'trace_stopped',
  'type_text',
  'ui_tree',
] as const;

type SafeEventType = (typeof EVENT_TYPES)[number] | 'other';
const EVENT_TYPE_SET = new Set<string>(EVENT_TYPES);

const ARTIFACT_KINDS = [
  'screenshot',
  'recording',
  'trace',
  'log',
  'network',
  'summary',
  'ui-tree',
  'ui-understanding',
  'runtime-ui-model',
  'devtools-export',
  'profile',
  'evidence-graph',
  'suite-report',
  'security-report',
  'coverage-report',
  'share-bundle',
] as const satisfies readonly Artifact['kind'][];

const OUTCOMES = ['PASS', 'FAIL', 'NA', 'NOT_VERIFIED'] as const;
const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
const CATEGORIES = [
  'functional',
  'visual',
  'performance',
  'network',
  'accessibility',
  'security',
  'resilience',
  'privacy',
] as const;
const AVAILABILITIES = ['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'] as const;
const CLASSIFICATIONS = [
  'public',
  'internal',
  'sensitive',
  'restricted',
] as const;

const SAFE_METRIC_UNITS = {
  ui_fps: 'fps',
  frame_time_ms: 'ms',
  worst_frame_ms: 'ms',
  dropped_frames: 'frames',
  frame_sample_count: 'frames',
  display_refresh_hz: 'Hz',
  memory_mb: 'MB',
  cpu_percent: '%',
  js_fps: 'fps',
  js_blocking_ms: 'ms',
} as const;

export type DashboardMetricId = keyof typeof SAFE_METRIC_UNITS;
export type DashboardStatistic =
  'value' | 'median' | 'p95' | 'mean' | 'min' | 'max';

export interface DashboardMetricInput {
  metric: string;
  unit: string;
  statistic?: DashboardStatistic;
  value: number | null;
  available: boolean;
  timestamp: string;
}

export interface DashboardRunInput {
  session: Session;
  target?: TargetFingerprint;
  evidence?: readonly EvidenceEnvelope[];
  findings?: readonly AssuranceFinding[];
  metrics?: readonly DashboardMetricInput[];
}

export interface DashboardMetricSummary {
  metric: DashboardMetricId;
  unit: string;
  statistic: DashboardStatistic;
  value: number | null;
  available: boolean;
  timestamp: string;
}

export type DashboardTrendEligibility =
  'ELIGIBLE' | 'MISSING_TARGET' | 'MIXED_TARGETS';

export interface DashboardTargetSummary {
  fingerprint: string;
  comparisonFingerprint: string;
}

export interface DashboardRunSummary {
  schemaVersion: '1.0';
  runRef: string;
  startedAt: string;
  stoppedAt?: string;
  durationMs: number | null;
  status: Session['status'];
  eventCount: number;
  eventTypes: Array<{ type: SafeEventType; count: number }>;
  artifactCount: number;
  artifactKinds: Array<{ kind: Artifact['kind']; count: number }>;
  evidenceCount: number;
  evidenceAvailability: Record<(typeof AVAILABILITIES)[number], number>;
  evidenceClassification: Record<(typeof CLASSIFICATIONS)[number], number>;
  findingCount: number;
  findingOutcomes: Record<(typeof OUTCOMES)[number], number>;
  findingSeverities: Record<(typeof SEVERITIES)[number], number>;
  findingCategories: Record<(typeof CATEGORIES)[number], number>;
  trendEligibility: DashboardTrendEligibility;
  target?: DashboardTargetSummary;
  metrics: DashboardMetricSummary[];
  omittedMetricCount: number;
}

export interface DashboardTrendPoint {
  runRef: string;
  timestamp: string;
  value: number;
}

export interface DashboardTrendSeries {
  metric: DashboardMetricId;
  unit: string;
  statistic: DashboardStatistic;
  points: DashboardTrendPoint[];
  absoluteChange: number;
  percentChange: number | null;
  direction: 'higher' | 'lower' | 'flat';
}

export type DashboardTrendStatus =
  | 'COMPATIBLE'
  | 'INSUFFICIENT_DATA'
  | 'NOT_VERIFIED'
  | 'INCOMPATIBLE_FINGERPRINTS';

export interface DashboardTrendSummary {
  status: DashboardTrendStatus;
  comparisonFingerprint?: string;
  series: DashboardTrendSeries[];
}

export interface DashboardReport {
  schemaVersion: '1.0';
  generatedAt: string;
  runs: DashboardRunSummary[];
  trend: DashboardTrendSummary;
  limitations: readonly [
    'Evidence payloads, timeline data, finding text, source paths, project roots, and artifact paths are omitted',
    'Artifact binaries and encoded binary content are never embedded',
    'Trends are descriptive and are produced only for compatible target fingerprints',
  ];
}

export interface LoadDashboardRunMetadataOptions {
  root: string;
  relativePath: string;
  maxBytes?: number;
}

export interface WriteOfflineDashboardOptions {
  root: string;
  relativePath?: string;
  report: DashboardReport;
}

const REPORT_LIMITATIONS = [
  'Evidence payloads, timeline data, finding text, source paths, project roots, and artifact paths are omitted',
  'Artifact binaries and encoded binary content are never embedded',
  'Trends are descriptive and are produced only for compatible target fingerprints',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const normalizedTimestamp = (value: string, label: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be an ISO date-time`);
  }
  return date.toISOString();
};

const countRecord = <T extends string>(
  values: readonly T[],
): Record<T, number> =>
  Object.fromEntries(values.map((value) => [value, 0])) as Record<T, number>;

const compatibilityFields: readonly (keyof TargetFingerprint)[] = [
  'platform',
  'deviceId',
  'appId',
  'operatingSystem',
  'architecture',
  'reactNativeVersion',
  'expoVersion',
  'hermesVersion',
  'deviceClass',
];

// App/build/source revisions intentionally remain outside the compatibility key so
// a trend can describe change across builds. They are still part of the exact
// target digest, while device/runtime fields must match before aggregation.
const exactFingerprintFields: readonly (keyof TargetFingerprint)[] = [
  ...compatibilityFields,
  'appVersion',
  'buildId',
  'sourceRevision',
];

const targetFingerprint = (
  target: TargetFingerprint,
  fields: readonly (keyof TargetFingerprint)[],
): string =>
  `sha256:${digest(
    JSON.stringify(fields.map((field) => [field, target[field] ?? null])),
  )}`;

const safeMetric = (
  raw: DashboardMetricInput,
): DashboardMetricSummary | undefined => {
  if (!(raw.metric in SAFE_METRIC_UNITS)) return undefined;
  const metric = raw.metric as DashboardMetricId;
  if (raw.unit !== SAFE_METRIC_UNITS[metric]) {
    throw new TypeError(`${metric} uses an unsupported unit`);
  }
  const statistic = raw.statistic ?? 'value';
  if (!['value', 'median', 'p95', 'mean', 'min', 'max'].includes(statistic)) {
    throw new TypeError('Dashboard metric uses an unsupported statistic');
  }
  if (
    raw.available
      ? raw.value === null || !Number.isFinite(raw.value)
      : raw.value !== null
  ) {
    throw new TypeError(
      `${metric} must have a finite value exactly when it is available`,
    );
  }
  return {
    metric,
    unit: SAFE_METRIC_UNITS[metric],
    statistic,
    value: raw.value,
    available: raw.available,
    timestamp: normalizedTimestamp(raw.timestamp, `${metric}.timestamp`),
  };
};

const parseDashboardRunInput = (value: unknown): DashboardRunInput => {
  if (!isRecord(value))
    throw new TypeError('Dashboard run metadata must be an object');
  const session = SessionSchema.parse(value.session);
  if (session.timeline.length > 10_000 || session.artifacts.length > 10_000) {
    throw new RangeError(
      'Dashboard session metadata exceeds the 10,000-item limit',
    );
  }
  const evidenceRaw = value.evidence ?? [];
  const findingsRaw = value.findings ?? [];
  const metricsRaw = value.metrics ?? [];
  if (!Array.isArray(evidenceRaw) || evidenceRaw.length > 5_000) {
    throw new RangeError('Dashboard evidence must contain at most 5,000 items');
  }
  if (!Array.isArray(findingsRaw) || findingsRaw.length > 5_000) {
    throw new RangeError('Dashboard findings must contain at most 5,000 items');
  }
  if (!Array.isArray(metricsRaw) || metricsRaw.length > 500) {
    throw new RangeError('Dashboard metrics must contain at most 500 items');
  }
  const metrics: DashboardMetricInput[] = metricsRaw.map((metric, index) => {
    if (!isRecord(metric)) {
      throw new TypeError(`Dashboard metric ${index} must be an object`);
    }
    if (
      typeof metric.metric !== 'string' ||
      typeof metric.unit !== 'string' ||
      typeof metric.available !== 'boolean' ||
      typeof metric.timestamp !== 'string' ||
      !(
        metric.value === null ||
        (typeof metric.value === 'number' && Number.isFinite(metric.value))
      ) ||
      !(
        metric.statistic === undefined ||
        (typeof metric.statistic === 'string' &&
          ['value', 'median', 'p95', 'mean', 'min', 'max'].includes(
            metric.statistic,
          ))
      )
    ) {
      throw new TypeError(`Dashboard metric ${index} is invalid`);
    }
    return {
      metric: metric.metric,
      unit: metric.unit,
      value: metric.value,
      available: metric.available,
      timestamp: metric.timestamp,
      ...(metric.statistic
        ? { statistic: metric.statistic as DashboardStatistic }
        : {}),
    };
  });
  return {
    session,
    ...(value.target === undefined
      ? {}
      : { target: TargetFingerprintSchema.parse(value.target) }),
    evidence: evidenceRaw.map((item) => EvidenceEnvelopeSchema.parse(item)),
    findings: findingsRaw.map((item) => AssuranceFindingSchema.parse(item)),
    metrics,
  };
};

export const summarizeDashboardRun = (
  value: DashboardRunInput,
): DashboardRunSummary => {
  const input = parseDashboardRunInput(value);
  const eventCounts = new Map<SafeEventType, number>();
  for (const event of input.session.timeline) {
    const type: SafeEventType = EVENT_TYPE_SET.has(event.type)
      ? (event.type as SafeEventType)
      : 'other';
    eventCounts.set(type, (eventCounts.get(type) ?? 0) + 1);
  }

  const artifactCounts = new Map<Artifact['kind'], number>();
  for (const artifact of input.session.artifacts) {
    artifactCounts.set(
      artifact.kind,
      (artifactCounts.get(artifact.kind) ?? 0) + 1,
    );
  }

  const evidenceAvailability = countRecord(AVAILABILITIES);
  const evidenceClassification = countRecord(CLASSIFICATIONS);
  for (const envelope of input.evidence ?? []) {
    evidenceAvailability[envelope.availability.status] += 1;
    evidenceClassification[envelope.classification] += 1;
  }

  const findingOutcomes = countRecord(OUTCOMES);
  const findingSeverities = countRecord(SEVERITIES);
  const findingCategories = countRecord(CATEGORIES);
  for (const finding of input.findings ?? []) {
    findingOutcomes[finding.outcome] += 1;
    findingSeverities[finding.severity] += 1;
    findingCategories[finding.category] += 1;
  }

  const targets = [
    ...(input.target ? [input.target] : []),
    ...(input.evidence ?? []).map((envelope) => envelope.target),
  ];
  const comparisonFingerprints = new Set(
    targets.map((target) => targetFingerprint(target, compatibilityFields)),
  );
  const trendEligibility: DashboardTrendEligibility =
    targets.length === 0
      ? 'MISSING_TARGET'
      : comparisonFingerprints.size === 1
        ? 'ELIGIBLE'
        : 'MIXED_TARGETS';
  const selectedTarget = targets[0];
  const target =
    trendEligibility === 'ELIGIBLE' && selectedTarget
      ? {
          fingerprint: targetFingerprint(
            selectedTarget,
            exactFingerprintFields,
          ),
          comparisonFingerprint: targetFingerprint(
            selectedTarget,
            compatibilityFields,
          ),
        }
      : undefined;

  let omittedMetricCount = 0;
  const metricMap = new Map<string, DashboardMetricSummary>();
  for (const metric of input.metrics ?? []) {
    const safe = safeMetric(metric);
    if (!safe) {
      omittedMetricCount += 1;
      continue;
    }
    const key = `${safe.metric}\u0000${safe.unit}\u0000${safe.statistic}`;
    const existing = metricMap.get(key);
    if (!existing || existing.timestamp <= safe.timestamp)
      metricMap.set(key, safe);
  }
  const metrics = [...metricMap.values()].sort((left, right) =>
    `${left.metric}\u0000${left.statistic}`.localeCompare(
      `${right.metric}\u0000${right.statistic}`,
    ),
  );

  const startedAt = normalizedTimestamp(
    input.session.startedAt,
    'session.startedAt',
  );
  const stoppedAt = input.session.stoppedAt
    ? normalizedTimestamp(input.session.stoppedAt, 'session.stoppedAt')
    : undefined;
  const durationMs = stoppedAt
    ? new Date(stoppedAt).getTime() - new Date(startedAt).getTime()
    : null;
  if (durationMs !== null && durationMs < 0) {
    throw new TypeError('Session stop time cannot precede its start time');
  }

  return {
    schemaVersion: '1.0',
    runRef: `run-${digest(input.session.id).slice(0, 16)}`,
    startedAt,
    ...(stoppedAt ? { stoppedAt } : {}),
    durationMs,
    status: input.session.status,
    eventCount: input.session.timeline.length,
    eventTypes: [...eventCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => left.type.localeCompare(right.type)),
    artifactCount: input.session.artifacts.length,
    artifactKinds: ARTIFACT_KINDS.filter((kind) =>
      artifactCounts.has(kind),
    ).map((kind) => ({ kind, count: artifactCounts.get(kind) ?? 0 })),
    evidenceCount: input.evidence?.length ?? 0,
    evidenceAvailability,
    evidenceClassification,
    findingCount: input.findings?.length ?? 0,
    findingOutcomes,
    findingSeverities,
    findingCategories,
    trendEligibility,
    ...(target ? { target } : {}),
    metrics,
    omittedMetricCount,
  };
};

const isContained = (root: string, candidate: string): boolean => {
  const path = relative(root, candidate);
  return (
    path === '' ||
    (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
  );
};

const assertRelativePath = (path: string, expectedExtension: string): void => {
  if (
    !path ||
    path.length > 1_024 ||
    path.includes('\0') ||
    isAbsolute(path) ||
    extname(path).toLowerCase() !== expectedExtension
  ) {
    throw new TypeError(
      `Path must be a relative ${expectedExtension} path within the configured root`,
    );
  }
};

const resolveContainedExistingFile = async (
  root: string,
  relativePath: string,
): Promise<string> => {
  assertRelativePath(relativePath, '.json');
  const resolvedRoot = await realpath(resolve(root));
  const lexicalPath = resolve(resolvedRoot, relativePath);
  if (!isContained(resolvedRoot, lexicalPath)) {
    throw new RangeError('Dashboard metadata path escapes the configured root');
  }
  const resolvedPath = await realpath(lexicalPath);
  if (!isContained(resolvedRoot, resolvedPath)) {
    throw new RangeError(
      'Dashboard metadata path resolves outside the configured root',
    );
  }
  const metadata = await stat(resolvedPath);
  if (!metadata.isFile()) {
    throw new TypeError(
      'Dashboard metadata path must resolve to a regular file',
    );
  }
  return resolvedPath;
};

export const loadDashboardRunMetadata = async (
  options: LoadDashboardRunMetadataOptions,
): Promise<DashboardRunSummary> => {
  const maxBytes = Math.min(
    Math.max(1, options.maxBytes ?? DEFAULT_DASHBOARD_METADATA_MAX_BYTES),
    MAX_DASHBOARD_METADATA_BYTES,
  );
  const path = await resolveContainedExistingFile(
    options.root,
    options.relativePath,
  );
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (metadata.size > maxBytes) {
      throw new RangeError(
        `Dashboard metadata exceeds the ${maxBytes}-byte safety limit`,
      );
    }
    const source = await handle.readFile({ encoding: 'utf8' });
    if (Buffer.byteLength(source, 'utf8') > maxBytes || source.includes('\0')) {
      throw new RangeError('Dashboard metadata is not bounded UTF-8 JSON');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(source) as unknown;
    } catch (error) {
      throw new TypeError(
        `Dashboard metadata JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    return summarizeDashboardRun(parseDashboardRunInput(parsed));
  } finally {
    await handle.close();
  }
};

const trendFor = (
  runs: readonly DashboardRunSummary[],
): DashboardTrendSummary => {
  if (runs.length < 2) {
    return { status: 'INSUFFICIENT_DATA', series: [] };
  }
  if (runs.some((run) => run.status !== 'complete')) {
    return { status: 'NOT_VERIFIED', series: [] };
  }
  if (runs.some((run) => run.trendEligibility === 'MIXED_TARGETS')) {
    return { status: 'INCOMPATIBLE_FINGERPRINTS', series: [] };
  }
  if (
    runs.some(
      (run) => run.trendEligibility !== 'ELIGIBLE' || run.target === undefined,
    )
  ) {
    return { status: 'NOT_VERIFIED', series: [] };
  }
  const fingerprints = new Set(
    runs.map((run) => run.target?.comparisonFingerprint),
  );
  if (fingerprints.size !== 1) {
    return { status: 'INCOMPATIBLE_FINGERPRINTS', series: [] };
  }
  const comparisonFingerprint = runs[0]?.target?.comparisonFingerprint;
  if (!comparisonFingerprint) {
    return { status: 'NOT_VERIFIED', series: [] };
  }

  const grouped = new Map<string, DashboardTrendSeries>();
  for (const run of runs) {
    for (const metric of run.metrics) {
      if (!metric.available || metric.value === null) continue;
      const key = `${metric.metric}\u0000${metric.unit}\u0000${metric.statistic}`;
      const existing = grouped.get(key);
      const point = {
        runRef: run.runRef,
        timestamp: metric.timestamp,
        value: metric.value,
      };
      if (existing) existing.points.push(point);
      else {
        grouped.set(key, {
          metric: metric.metric,
          unit: metric.unit,
          statistic: metric.statistic,
          points: [point],
          absoluteChange: 0,
          percentChange: null,
          direction: 'flat',
        });
      }
    }
  }

  const series = [...grouped.values()]
    .filter((item) => item.points.length >= 2)
    .map((item) => {
      item.points.sort((left, right) =>
        left.timestamp.localeCompare(right.timestamp),
      );
      const first = item.points[0]?.value ?? 0;
      const last = item.points.at(-1)?.value ?? first;
      const absoluteChange = last - first;
      const tolerance = Math.max(Math.abs(first) * 1e-9, 1e-9);
      return {
        ...item,
        absoluteChange,
        percentChange:
          first === 0 ? null : (absoluteChange / Math.abs(first)) * 100,
        direction:
          Math.abs(absoluteChange) <= tolerance
            ? ('flat' as const)
            : absoluteChange > 0
              ? ('higher' as const)
              : ('lower' as const),
      };
    })
    .sort((left, right) => left.metric.localeCompare(right.metric));

  return {
    status: 'COMPATIBLE',
    comparisonFingerprint,
    series,
  };
};

export const buildDashboardReport = (
  values: readonly (DashboardRunInput | DashboardRunSummary)[],
  options: { generatedAt?: string } = {},
): DashboardReport => {
  if (values.length > MAX_DASHBOARD_RUNS) {
    throw new RangeError(
      `Dashboard reports support at most ${MAX_DASHBOARD_RUNS} runs`,
    );
  }
  const runs = values
    .map((value) =>
      'runRef' in value
        ? validateRunSummary(value)
        : summarizeDashboardRun(value),
    )
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  return {
    schemaVersion: '1.0',
    generatedAt: normalizedTimestamp(
      options.generatedAt ?? new Date().toISOString(),
      'report.generatedAt',
    ),
    runs,
    trend: trendFor(runs),
    limitations: REPORT_LIMITATIONS,
  };
};

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RUN_REF_PATTERN = /^run-[a-f0-9]{16}$/u;

const validateCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
};

const validateRunSummary = (
  value: DashboardRunSummary,
): DashboardRunSummary => {
  if (
    value.schemaVersion !== '1.0' ||
    !RUN_REF_PATTERN.test(value.runRef) ||
    !['active', 'complete', 'failed'].includes(value.status) ||
    !['ELIGIBLE', 'MISSING_TARGET', 'MIXED_TARGETS'].includes(
      value.trendEligibility,
    )
  ) {
    throw new TypeError(
      'Dashboard run summary contains an unsafe identity or enum',
    );
  }
  normalizedTimestamp(value.startedAt, 'run.startedAt');
  if (value.stoppedAt) normalizedTimestamp(value.stoppedAt, 'run.stoppedAt');
  for (const [label, count] of [
    ['eventCount', value.eventCount],
    ['artifactCount', value.artifactCount],
    ['evidenceCount', value.evidenceCount],
    ['findingCount', value.findingCount],
    ['omittedMetricCount', value.omittedMetricCount],
  ] as const) {
    validateCount(count, label);
  }
  if (
    value.durationMs !== null &&
    (!Number.isFinite(value.durationMs) || value.durationMs < 0)
  ) {
    throw new TypeError(
      'durationMs must be a non-negative finite number or null',
    );
  }
  if (
    value.target &&
    (!HASH_PATTERN.test(value.target.fingerprint) ||
      !HASH_PATTERN.test(value.target.comparisonFingerprint))
  ) {
    throw new TypeError(
      'Dashboard target fingerprints must be SHA-256 digests',
    );
  }
  const seenEventTypes = new Set<SafeEventType>();
  const eventTypes = value.eventTypes.map((item) => {
    if (![...EVENT_TYPES, 'other'].includes(item.type)) {
      throw new TypeError('Dashboard event type is not allowlisted');
    }
    if (seenEventTypes.has(item.type)) {
      throw new TypeError('Dashboard event types must be unique per run');
    }
    seenEventTypes.add(item.type);
    validateCount(item.count, `eventTypes.${item.type}`);
    return { type: item.type, count: item.count };
  });
  const seenArtifactKinds = new Set<Artifact['kind']>();
  const artifactKinds = value.artifactKinds.map((item) => {
    if (!ARTIFACT_KINDS.includes(item.kind)) {
      throw new TypeError('Dashboard artifact kind is not allowlisted');
    }
    if (seenArtifactKinds.has(item.kind)) {
      throw new TypeError('Dashboard artifact kinds must be unique per run');
    }
    seenArtifactKinds.add(item.kind);
    validateCount(item.count, `artifactKinds.${item.kind}`);
    return { kind: item.kind, count: item.count };
  });
  const seenMetrics = new Set<string>();
  const metrics = value.metrics.map((metric) => {
    const safe = safeMetric(metric);
    if (!safe) throw new TypeError('Dashboard metric is not allowlisted');
    const key = `${safe.metric}\u0000${safe.unit}\u0000${safe.statistic}`;
    if (seenMetrics.has(key)) {
      throw new TypeError(
        'Dashboard metrics must be unique per run and statistic',
      );
    }
    seenMetrics.add(key);
    return safe;
  });
  const safeCounts = <T extends string>(
    counts: Record<T, number>,
    allowed: readonly T[],
    label: string,
  ): Record<T, number> => {
    const output = countRecord(allowed);
    for (const key of allowed) {
      const count = counts[key];
      validateCount(count, `${label}.${key}`);
      output[key] = count;
    }
    return output;
  };
  const evidenceAvailability = safeCounts(
    value.evidenceAvailability,
    AVAILABILITIES,
    'evidenceAvailability',
  );
  const evidenceClassification = safeCounts(
    value.evidenceClassification,
    CLASSIFICATIONS,
    'evidenceClassification',
  );
  const findingOutcomes = safeCounts(
    value.findingOutcomes,
    OUTCOMES,
    'findingOutcomes',
  );
  const findingSeverities = safeCounts(
    value.findingSeverities,
    SEVERITIES,
    'findingSeverities',
  );
  const findingCategories = safeCounts(
    value.findingCategories,
    CATEGORIES,
    'findingCategories',
  );
  const sum = (values: readonly number[]): number =>
    values.reduce((total, count) => total + count, 0);
  if (
    sum(eventTypes.map((item) => item.count)) !== value.eventCount ||
    sum(artifactKinds.map((item) => item.count)) !== value.artifactCount ||
    sum(Object.values(evidenceAvailability)) !== value.evidenceCount ||
    sum(Object.values(evidenceClassification)) !== value.evidenceCount ||
    sum(Object.values(findingOutcomes)) !== value.findingCount ||
    sum(Object.values(findingSeverities)) !== value.findingCount ||
    sum(Object.values(findingCategories)) !== value.findingCount
  ) {
    throw new TypeError(
      'Dashboard aggregate counts are internally inconsistent',
    );
  }
  return {
    schemaVersion: '1.0',
    runRef: value.runRef,
    startedAt: normalizedTimestamp(value.startedAt, 'run.startedAt'),
    ...(value.stoppedAt
      ? { stoppedAt: normalizedTimestamp(value.stoppedAt, 'run.stoppedAt') }
      : {}),
    durationMs: value.durationMs,
    status: value.status,
    eventCount: value.eventCount,
    eventTypes,
    artifactCount: value.artifactCount,
    artifactKinds,
    evidenceCount: value.evidenceCount,
    evidenceAvailability,
    evidenceClassification,
    findingCount: value.findingCount,
    findingOutcomes,
    findingSeverities,
    findingCategories,
    trendEligibility: value.trendEligibility,
    ...(value.trendEligibility === 'ELIGIBLE' && value.target
      ? {
          target: {
            fingerprint: value.target.fingerprint,
            comparisonFingerprint: value.target.comparisonFingerprint,
          },
        }
      : {}),
    metrics,
    omittedMetricCount: value.omittedMetricCount,
  };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const countList = <T extends string>(counts: Record<T, number>): string =>
  Object.entries<number>(counts)
    .filter(([, count]) => count > 0)
    .map(
      ([label, count]) =>
        `<li><code>${escapeHtml(label)}</code>: ${String(count)}</li>`,
    )
    .join('') || '<li>None</li>';

const trendDescription: Record<DashboardTrendStatus, string> = {
  COMPATIBLE: 'Runs share a compatible target fingerprint.',
  INSUFFICIENT_DATA: 'At least two runs are required for a trend.',
  NOT_VERIFIED:
    'One or more runs are incomplete or have no verified target fingerprint.',
  INCOMPATIBLE_FINGERPRINTS:
    'Runs use incompatible or internally mixed target fingerprints; no trend was calculated.',
};

export const renderOfflineDashboard = (report: DashboardReport): string => {
  const safeReport = buildDashboardReport(report.runs, {
    generatedAt: report.generatedAt,
  });
  const trendRows = safeReport.trend.series
    .map(
      (series) => `<tr>
<td><code>${escapeHtml(series.metric)}</code></td>
<td>${escapeHtml(series.statistic)}</td>
<td>${escapeHtml(series.unit)}</td>
<td>${String(series.points.length)}</td>
<td>${String(series.absoluteChange)}</td>
<td>${series.percentChange === null ? 'Unavailable' : `${series.percentChange.toFixed(2)}%`}</td>
<td>${escapeHtml(series.direction)}</td>
</tr>`,
    )
    .join('');
  const runSections = safeReport.runs
    .map(
      (run) => `<section>
<h2>${escapeHtml(run.runRef)}</h2>
<dl>
<dt>Status</dt><dd>${escapeHtml(run.status)}</dd>
<dt>Started</dt><dd><time datetime="${escapeHtml(run.startedAt)}">${escapeHtml(run.startedAt)}</time></dd>
<dt>Stopped</dt><dd>${run.stoppedAt ? `<time datetime="${escapeHtml(run.stoppedAt)}">${escapeHtml(run.stoppedAt)}</time>` : 'Not stopped'}</dd>
<dt>Duration</dt><dd>${run.durationMs === null ? 'Unavailable' : `${String(run.durationMs)} ms`}</dd>
<dt>Target status</dt><dd>${escapeHtml(run.trendEligibility)}</dd>
<dt>Target digest</dt><dd>${run.target ? `<code>${escapeHtml(run.target.fingerprint)}</code>` : 'Omitted'}</dd>
</dl>
<h3>Counts</h3>
<ul>
<li>Events: ${String(run.eventCount)}</li>
<li>Artifacts: ${String(run.artifactCount)}</li>
<li>Evidence envelopes: ${String(run.evidenceCount)}</li>
<li>Findings: ${String(run.findingCount)}</li>
<li>Unknown metrics omitted: ${String(run.omittedMetricCount)}</li>
</ul>
<h3>Event types</h3><ul>${run.eventTypes.map((item) => `<li><code>${escapeHtml(item.type)}</code>: ${String(item.count)}</li>`).join('') || '<li>None</li>'}</ul>
<h3>Artifact kinds</h3><ul>${run.artifactKinds.map((item) => `<li><code>${escapeHtml(item.kind)}</code>: ${String(item.count)}</li>`).join('') || '<li>None</li>'}</ul>
<h3>Evidence availability</h3><ul>${countList(run.evidenceAvailability)}</ul>
<h3>Evidence classification</h3><ul>${countList(run.evidenceClassification)}</ul>
<h3>Finding outcomes</h3><ul>${countList(run.findingOutcomes)}</ul>
<h3>Finding severity</h3><ul>${countList(run.findingSeverities)}</ul>
<h3>Finding categories</h3><ul>${countList(run.findingCategories)}</ul>
</section>`,
    )
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(DASHBOARD_CONTENT_SECURITY_POLICY)}">
<title>RN Agent Observer local report</title>
</head>
<body>
<header>
<h1>RN Agent Observer local report</h1>
<p>Generated <time datetime="${escapeHtml(safeReport.generatedAt)}">${escapeHtml(safeReport.generatedAt)}</time>.</p>
<p>This offline report contains aggregate metadata only. Payloads, filesystem paths, source text, and binary artifacts are omitted.</p>
</header>
<main>
<section>
<h2>Trend</h2>
<p>Status: <strong>${escapeHtml(safeReport.trend.status)}</strong>. ${escapeHtml(trendDescription[safeReport.trend.status])}</p>
${safeReport.trend.comparisonFingerprint ? `<p>Comparison fingerprint: <code>${escapeHtml(safeReport.trend.comparisonFingerprint)}</code></p>` : ''}
<table>
<caption>Compatible metric series</caption>
<thead><tr><th>Metric</th><th>Statistic</th><th>Unit</th><th>Points</th><th>Absolute change</th><th>Percent change</th><th>Direction</th></tr></thead>
<tbody>${trendRows || '<tr><td colspan="7">No compatible metric series</td></tr>'}</tbody>
</table>
</section>
${runSections || '<section><h2>No runs</h2><p>No session metadata was supplied.</p></section>'}
<section>
<h2>Limitations</h2>
<ul>${REPORT_LIMITATIONS.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('')}</ul>
</section>
</main>
</body>
</html>
`;
  if (
    /(?:<script\b|<iframe\b|<object\b|<embed\b|<img\b|<audio\b|<video\b|data:|file:\/\/|base64)/iu.test(
      html,
    )
  ) {
    throw new Error(
      'Dashboard HTML contains a forbidden active or embedded resource',
    );
  }
  const secretScan = scanSecrets(html, {
    source: 'generated-dashboard.html',
    fingerprintKey: 'rn-agent-observer-dashboard-output',
  });
  if (secretScan.matches.length > 0 || secretScan.outcome === 'NOT_VERIFIED') {
    throw new Error(
      'Dashboard HTML did not pass the bounded secret-output scan',
    );
  }
  return html;
};

const nearestExistingAncestor = async (path: string): Promise<string> => {
  let candidate = path;
  for (;;) {
    try {
      await lstat(candidate);
      return candidate;
    } catch (error) {
      if (!isRecord(error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
};

export const writeOfflineDashboard = async (
  options: WriteOfflineDashboardOptions,
): Promise<{ path: string; bytes: number; sha256: string }> => {
  const relativePath = options.relativePath ?? 'dashboard/index.html';
  assertRelativePath(relativePath, '.html');
  await mkdir(resolve(options.root), { recursive: true });
  const resolvedRoot = await realpath(resolve(options.root));
  const outputPath = resolve(resolvedRoot, relativePath);
  if (!isContained(resolvedRoot, outputPath)) {
    throw new RangeError('Dashboard output path escapes the configured root');
  }
  const parent = dirname(outputPath);
  const existingAncestor = await nearestExistingAncestor(parent);
  const resolvedAncestor = await realpath(existingAncestor);
  if (!isContained(resolvedRoot, resolvedAncestor)) {
    throw new RangeError(
      'Dashboard output ancestor resolves outside the configured root',
    );
  }
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (!isContained(resolvedRoot, resolvedParent)) {
    throw new RangeError(
      'Dashboard output parent resolves outside the configured root',
    );
  }
  const html = renderOfflineDashboard(options.report);
  await writeFile(outputPath, html, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return {
    path: outputPath,
    bytes: Buffer.byteLength(html, 'utf8'),
    sha256: digest(html),
  };
};
