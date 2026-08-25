import { createHash, createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import {
  ExternalRunnerComparisonSchema,
  ExternalRunnerResultSchema,
  type ExternalRunnerComparison,
  type ExternalRunnerCaseOutcome,
  type ExternalRunnerName,
  type ExternalRunnerResult,
} from '@rn-agent-observer/schemas';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { resolveContainedReadFile } from '../filesystem/path-authority.js';

export const MAX_JUNIT_BYTES = 8 * 1024 * 1024;
export const MAX_JUNIT_CASES = 20_000;
export const MAX_NORMALIZED_RUNNER_RESULT_BYTES = 8 * 1024 * 1024;

export type {
  ExternalRunnerComparison,
  ExternalRunnerName,
  ExternalRunnerResult,
};

interface ParsedCase {
  idHash: string;
  outcome: ExternalRunnerCaseOutcome;
  durationMs?: number;
}

export interface ExternalRunnerImportOptions {
  caseHashSecret?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

const caseOutcome = (
  value: Record<string, unknown>,
): ExternalRunnerCaseOutcome => {
  if (asArray(value.error).length > 0) return 'ERROR';
  if (asArray(value.failure).length > 0) return 'FAIL';
  if (asArray(value.skipped).length > 0) return 'SKIPPED';
  return 'PASS';
};

const durationMs = (value: unknown): number | undefined => {
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000);
};

const validateCaseHashSecret = (secret: string | undefined): void => {
  if (secret === undefined) return;
  if (secret.length < 16 || secret.length > 4096) {
    throw new RangeError(
      'RN_OBSERVER_RUNNER_HASH_SECRET must contain 16 to 4096 characters',
    );
  }
};

const caseIdentityHash = (
  identity: string,
  secret: string | undefined,
): string =>
  secret === undefined
    ? `sha256:${createHash('sha256').update(identity).digest('hex')}`
    : `hmac-sha256:${createHmac('sha256', secret)
        .update(identity)
        .digest('hex')}`;

const parseCase = (
  value: Record<string, unknown>,
  caseHashSecret: string | undefined,
): ParsedCase => {
  const identity = `${String(value.classname ?? '')}\0${String(value.name ?? '')}`;
  const duration = durationMs(value.time);
  return {
    idHash: caseIdentityHash(identity, caseHashSecret),
    outcome: caseOutcome(value),
    ...(duration === undefined ? {} : { durationMs: duration }),
  };
};

const collectCases = (
  value: unknown,
  cases: ParsedCase[],
  state: { truncated: boolean },
  caseHashSecret: string | undefined,
  depth = 0,
): void => {
  if (state.truncated || depth > 64) {
    state.truncated = true;
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value)
      collectCases(entry, cases, state, caseHashSecret, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'testcase') {
      for (const candidate of asArray(entry)) {
        if (!isRecord(candidate)) continue;
        if (cases.length >= MAX_JUNIT_CASES) {
          state.truncated = true;
          return;
        }
        cases.push(parseCase(candidate, caseHashSecret));
      }
      continue;
    }
    collectCases(entry, cases, state, caseHashSecret, depth + 1);
  }
};

export const parseJunitRunnerResult = (
  source: string,
  runner: ExternalRunnerName,
  importedAt = new Date().toISOString(),
  options: ExternalRunnerImportOptions = {},
): ExternalRunnerResult => {
  validateCaseHashSecret(options.caseHashSecret);
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > MAX_JUNIT_BYTES) {
    throw new RangeError(`JUnit input exceeds ${MAX_JUNIT_BYTES} byte limit`);
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(source)) {
    throw new TypeError(
      'JUnit input must not contain DTD or entity declarations',
    );
  }
  const validation = XMLValidator.validate(source);
  if (validation !== true) {
    throw new TypeError(`JUnit XML is invalid: ${validation.err.msg}`);
  }
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    trimValues: true,
    isArray: (name) =>
      ['testsuite', 'testcase', 'failure', 'error', 'skipped'].includes(name),
  }).parse(source) as unknown;
  const cases: ParsedCase[] = [];
  const state = { truncated: false };
  collectCases(parsed, cases, state, options.caseHashSecret);

  const counts = {
    total: cases.length,
    passed: cases.filter((entry) => entry.outcome === 'PASS').length,
    failed: cases.filter((entry) => entry.outcome === 'FAIL').length,
    errors: cases.filter((entry) => entry.outcome === 'ERROR').length,
    skipped: cases.filter((entry) => entry.outcome === 'SKIPPED').length,
  };
  const limitations: string[] = [];
  let outcome: ExternalRunnerResult['outcome'];
  if (counts.failed > 0 || counts.errors > 0) {
    outcome = 'FAIL';
  } else if (state.truncated) {
    outcome = 'NOT_VERIFIED';
    limitations.push(
      `JUnit input exceeded the ${MAX_JUNIT_CASES} case normalization limit`,
    );
  } else if (counts.total === 0) {
    outcome = 'NOT_VERIFIED';
    limitations.push('JUnit input contained no observable test cases');
  } else if (counts.passed === 0) {
    outcome = 'NOT_VERIFIED';
    limitations.push('JUnit input contained no passing or failing test case');
  } else {
    outcome = 'PASS';
  }
  const totalDuration = cases.reduce(
    (sum, entry) => sum + (entry.durationMs ?? 0),
    0,
  );

  return ExternalRunnerResultSchema.parse({
    schemaVersion: '1.0',
    format: 'junit',
    runner,
    importedAt,
    source: {
      sha256: createHash('sha256').update(source).digest('hex'),
      bytes,
    },
    caseIdentityScheme:
      options.caseHashSecret === undefined ? 'sha256' : 'hmac-sha256',
    outcome,
    counts,
    ...(cases.some((entry) => entry.durationMs !== undefined)
      ? { durationMs: totalDuration }
      : {}),
    cases,
    truncated: state.truncated,
    limitations,
  });
};

export const importJunitRunnerResult = async (
  projectRoot: string,
  requestedPath: string,
  runner: ExternalRunnerName,
  options: ExternalRunnerImportOptions = {},
): Promise<ExternalRunnerResult> => {
  const path = resolveContainedReadFile(
    projectRoot,
    requestedPath,
    'JUnit report path',
  );
  const information = await stat(path);
  if (information.size > MAX_JUNIT_BYTES) {
    throw new RangeError(`JUnit input exceeds ${MAX_JUNIT_BYTES} byte limit`);
  }
  return parseJunitRunnerResult(
    await readFile(path, 'utf8'),
    runner,
    new Date().toISOString(),
    options,
  );
};

export const loadExternalRunnerResult = async (
  projectRoot: string,
  requestedPath: string,
): Promise<ExternalRunnerResult> => {
  const path = resolveContainedReadFile(
    projectRoot,
    requestedPath,
    'normalized runner result path',
  );
  const information = await stat(path);
  if (information.size > MAX_NORMALIZED_RUNNER_RESULT_BYTES) {
    throw new RangeError(
      `Normalized runner result exceeds ${MAX_NORMALIZED_RUNNER_RESULT_BYTES} byte limit`,
    );
  }
  return ExternalRunnerResultSchema.parse(
    JSON.parse(await readFile(path, 'utf8')) as unknown,
  );
};

const outcomeRank: Record<ExternalRunnerCaseOutcome, number> = {
  PASS: 0,
  SKIPPED: 1,
  FAIL: 2,
  ERROR: 3,
};

const caseMap = (
  result: ExternalRunnerResult,
): {
  cases: Map<string, ExternalRunnerCaseOutcome>;
  duplicateHashes: number;
} => {
  const cases = new Map<string, ExternalRunnerCaseOutcome>();
  let duplicateHashes = 0;
  for (const candidate of result.cases) {
    const existing = cases.get(candidate.idHash);
    if (existing !== undefined) {
      duplicateHashes += 1;
      if (outcomeRank[candidate.outcome] <= outcomeRank[existing]) continue;
    }
    cases.set(candidate.idHash, candidate.outcome);
  }
  return { cases, duplicateHashes };
};

const isFailure = (outcome: ExternalRunnerCaseOutcome): boolean =>
  outcome === 'FAIL' || outcome === 'ERROR';

const summarizeResult = (result: ExternalRunnerResult) => ({
  sourceSha256: result.source.sha256,
  outcome: result.outcome,
  counts: result.counts,
  ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
  truncated: result.truncated,
  caseIdentityScheme: result.caseIdentityScheme,
});

/**
 * Compares two privacy-reduced runner results. Only stable case hashes and
 * aggregate counts are returned; test names and failure bodies never enter the
 * normalized inputs or the comparison artifact.
 */
export const compareExternalRunnerResults = (
  baseline: ExternalRunnerResult,
  current: ExternalRunnerResult,
  comparedAt = new Date().toISOString(),
): ExternalRunnerComparison => {
  const baselineMap = caseMap(baseline);
  const currentMap = caseMap(current);
  const newFailures: string[] = [];
  const recovered: string[] = [];
  const persistentFailures: string[] = [];
  let addedCases = 0;
  let removedCases = 0;
  let outcomeChanges = 0;

  for (const [idHash, currentOutcome] of currentMap.cases) {
    const baselineOutcome = baselineMap.cases.get(idHash);
    if (baselineOutcome === undefined) {
      addedCases += 1;
      if (isFailure(currentOutcome)) newFailures.push(idHash);
      continue;
    }
    if (baselineOutcome !== currentOutcome) outcomeChanges += 1;
    if (isFailure(currentOutcome)) {
      if (isFailure(baselineOutcome)) persistentFailures.push(idHash);
      else newFailures.push(idHash);
    } else if (isFailure(baselineOutcome) && currentOutcome === 'PASS') {
      recovered.push(idHash);
    }
  }
  for (const idHash of baselineMap.cases.keys()) {
    if (!currentMap.cases.has(idHash)) removedCases += 1;
  }

  const limitations = [
    ...baseline.limitations.map((value) => `Baseline: ${value}`),
    ...current.limitations.map((value) => `Current: ${value}`),
  ];
  if (baseline.runner !== current.runner) {
    limitations.push('Runner identities differ between baseline and current');
  }
  if (baseline.caseIdentityScheme !== current.caseIdentityScheme) {
    limitations.push(
      'Case identity hash schemes differ between baseline and current',
    );
  }
  if (baselineMap.duplicateHashes > 0) {
    limitations.push(
      `Baseline contains ${baselineMap.duplicateHashes} duplicate case hash occurrence(s)`,
    );
  }
  if (currentMap.duplicateHashes > 0) {
    limitations.push(
      `Current contains ${currentMap.duplicateHashes} duplicate case hash occurrence(s)`,
    );
  }
  if (removedCases > 0) {
    limitations.push(
      `${removedCases} baseline case(s) are absent from the current result`,
    );
  }
  if (
    (baseline.durationMs === undefined) !==
    (current.durationMs === undefined)
  ) {
    limitations.push('Duration is unavailable on one side of the comparison');
  }

  let outcome: ExternalRunnerComparison['outcome'];
  if (current.counts.failed > 0 || current.counts.errors > 0) {
    outcome = 'FAIL';
  } else if (
    baseline.outcome === 'NOT_VERIFIED' ||
    current.outcome === 'NOT_VERIFIED' ||
    baseline.truncated ||
    current.truncated ||
    baseline.runner !== current.runner ||
    baseline.caseIdentityScheme !== current.caseIdentityScheme ||
    baselineMap.duplicateHashes > 0 ||
    currentMap.duplicateHashes > 0 ||
    removedCases > 0
  ) {
    outcome = 'NOT_VERIFIED';
  } else {
    outcome = 'PASS';
  }

  const countDelta = (key: keyof ExternalRunnerResult['counts']): number =>
    current.counts[key] - baseline.counts[key];
  const sorted = (values: string[]): string[] => values.sort();
  return ExternalRunnerComparisonSchema.parse({
    schemaVersion: '1.0',
    comparedAt,
    runners: { baseline: baseline.runner, current: current.runner },
    caseIdentitySchemes: {
      baseline: baseline.caseIdentityScheme,
      current: current.caseIdentityScheme,
    },
    outcome,
    baseline: summarizeResult(baseline),
    current: summarizeResult(current),
    delta: {
      total: countDelta('total'),
      passed: countDelta('passed'),
      failed: countDelta('failed'),
      errors: countDelta('errors'),
      skipped: countDelta('skipped'),
      ...(baseline.durationMs === undefined || current.durationMs === undefined
        ? {}
        : { durationMs: current.durationMs - baseline.durationMs }),
    },
    changes: {
      newFailures: sorted(newFailures),
      recovered: sorted(recovered),
      persistentFailures: sorted(persistentFailures),
      addedCases,
      removedCases,
      outcomeChanges,
    },
    limitations: [...new Set(limitations)],
  });
};

export const compareExternalRunnerResultFiles = async (
  projectRoot: string,
  baselinePath: string,
  currentPath: string,
): Promise<ExternalRunnerComparison> =>
  compareExternalRunnerResults(
    await loadExternalRunnerResult(projectRoot, baselinePath),
    await loadExternalRunnerResult(projectRoot, currentPath),
  );
