import {
  constants,
  closeSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { TextDecoder } from 'node:util';
import type { Artifact, Session } from '@rn-agent-observer/schemas';
import {
  MAX_SECRET_SCAN_BYTES,
  scanSecrets,
} from '../security/secret-scanner.js';

export const SESSION_SHARE_BUNDLE_SCHEMA =
  'rn-agent-observer/session-evidence-bundle' as const;
export const SESSION_SHARE_BUNDLE_VERSION = 1 as const;

export const DEFAULT_SHARE_BUNDLE_LIMITS = Object.freeze({
  maxEntries: 1_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalArtifactBytes: 256 * 1024 * 1024,
  maxEmbeddedTextBytes: 256 * 1024,
  maxBundleBytes: 16 * 1024 * 1024,
});

const HARD_SHARE_BUNDLE_LIMITS = Object.freeze({
  maxEntries: 10_000,
  maxEntryBytes: 1024 * 1024 * 1024,
  maxTotalArtifactBytes: 2 * 1024 * 1024 * 1024,
  maxEmbeddedTextBytes: MAX_SECRET_SCAN_BYTES,
  maxBundleBytes: 64 * 1024 * 1024,
});

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_MIME_PATTERN = /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/u;
const SAFE_ENTRY_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DATA_URL_BASE64_PATTERN = /;base64,[A-Za-z0-9+/_-]*={0,2}/iu;
const BASE64_LINE_PATTERN = /^[A-Za-z0-9+/_-]{8,}={0,2}$/u;
const ARTIFACT_KINDS = new Set<Artifact['kind']>([
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
  'runner-result',
  'runner-comparison',
  'share-bundle',
]);
const TEXT_EXTENSIONS = new Set([
  '.csv',
  '.html',
  '.json',
  '.log',
  '.md',
  '.ndjson',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

export type ShareBundleOutcome = 'PASS' | 'NOT_VERIFIED';
export type ShareBundleEntryInclusion =
  'metadata-only' | 'embedded-text' | 'excluded';

export interface ShareBundleLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalArtifactBytes: number;
  readonly maxEmbeddedTextBytes: number;
  readonly maxBundleBytes: number;
}

export interface ShareBundleEntry {
  readonly name: string;
  readonly artifactId: string;
  readonly kind: Artifact['kind'];
  readonly createdAt: string;
  readonly mimeType?: string;
  readonly inclusion: ShareBundleEntryInclusion;
  readonly verification: 'VERIFIED' | 'NOT_VERIFIED';
  readonly reason?: string;
  readonly bytes: number | null;
  readonly sha256: string | null;
  readonly content?: string;
}

export interface SessionShareBundleEnvelope {
  readonly schema: typeof SESSION_SHARE_BUNDLE_SCHEMA;
  readonly version: typeof SESSION_SHARE_BUNDLE_VERSION;
  readonly createdAt: string;
  readonly session: {
    readonly id: string;
    readonly startedAt: string;
    readonly stoppedAt?: string;
    readonly status: Session['status'];
    readonly eventCount: number;
    readonly artifactCount: number;
  };
  readonly policy: {
    readonly binaryEmbedding: 'disabled';
    readonly textEmbedding: 'disabled' | 'bounded-secret-scanned';
    readonly limits: ShareBundleLimits;
  };
  readonly outcome: ShareBundleOutcome;
  readonly omittedArtifactCount: number;
  readonly entries: readonly ShareBundleEntry[];
}

export interface ExportSessionShareBundleOptions {
  readonly artifactRoot: string;
  readonly outputPath: string;
  readonly includeTextArtifacts?: boolean;
  readonly limits?: Partial<ShareBundleLimits>;
  readonly now?: () => string;
}

export interface ExportSessionShareBundleResult {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly outcome: ShareBundleOutcome;
  readonly entryCount: number;
  readonly embeddedTextCount: number;
  readonly metadataOnlyCount: number;
  readonly excludedCount: number;
  readonly omittedArtifactCount: number;
}

export interface VerifySessionShareBundleOptions {
  readonly expectedSha256?: string;
  readonly limits?: Partial<ShareBundleLimits>;
}

export interface VerifySessionShareBundleResult {
  readonly valid: true;
  readonly sha256: string;
  readonly bytes: number;
  readonly schema: typeof SESSION_SHARE_BUNDLE_SCHEMA;
  readonly version: typeof SESSION_SHARE_BUNDLE_VERSION;
  readonly sessionId: string;
  readonly outcome: ShareBundleOutcome;
  readonly entryCount: number;
  readonly embeddedTextCount: number;
  readonly metadataOnlyCount: number;
  readonly excludedCount: number;
  readonly notVerifiedCount: number;
  readonly omittedArtifactCount: number;
}

export class SessionShareBundleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionShareBundleError';
  }
}

interface ArtifactReadResult {
  readonly bytes: number;
  readonly sha256: string;
  readonly text?: string;
}

interface SafeArtifactLocation {
  readonly path: string;
  readonly name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function limit(
  value: number | undefined,
  fallback: number,
  hardMaximum: number,
  name: string,
): number {
  const candidate = value ?? fallback;
  if (
    !Number.isSafeInteger(candidate) ||
    candidate <= 0 ||
    candidate > hardMaximum
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_LIMIT_INVALID',
      `${name} must be an integer between 1 and ${hardMaximum}`,
    );
  }
  return candidate;
}

function normalizeLimits(
  options: Partial<ShareBundleLimits> = {},
): ShareBundleLimits {
  return {
    maxEntries: limit(
      options.maxEntries,
      DEFAULT_SHARE_BUNDLE_LIMITS.maxEntries,
      HARD_SHARE_BUNDLE_LIMITS.maxEntries,
      'maxEntries',
    ),
    maxEntryBytes: limit(
      options.maxEntryBytes,
      DEFAULT_SHARE_BUNDLE_LIMITS.maxEntryBytes,
      HARD_SHARE_BUNDLE_LIMITS.maxEntryBytes,
      'maxEntryBytes',
    ),
    maxTotalArtifactBytes: limit(
      options.maxTotalArtifactBytes,
      DEFAULT_SHARE_BUNDLE_LIMITS.maxTotalArtifactBytes,
      HARD_SHARE_BUNDLE_LIMITS.maxTotalArtifactBytes,
      'maxTotalArtifactBytes',
    ),
    maxEmbeddedTextBytes: limit(
      options.maxEmbeddedTextBytes,
      DEFAULT_SHARE_BUNDLE_LIMITS.maxEmbeddedTextBytes,
      HARD_SHARE_BUNDLE_LIMITS.maxEmbeddedTextBytes,
      'maxEmbeddedTextBytes',
    ),
    maxBundleBytes: limit(
      options.maxBundleBytes,
      DEFAULT_SHARE_BUNDLE_LIMITS.maxBundleBytes,
      HARD_SHARE_BUNDLE_LIMITS.maxBundleBytes,
      'maxBundleBytes',
    ),
  };
}

function assertTimestamp(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(value) || Number.isNaN(Date.parse(value))) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${field} must be an ISO timestamp`,
    );
  }
}

function safeIdentifier(value: string, field: string): string {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${field} must be a portable identifier`,
    );
  }
  return value;
}

function safeArtifactReference(value: string): string {
  return SAFE_IDENTIFIER_PATTERN.test(value)
    ? value
    : `artifact-${sha256(value).slice(0, 24)}`;
}

export function isSafeBundleEntryName(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 512 ||
    value.includes('\0') ||
    value.includes('\\') ||
    value.startsWith('/') ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => SAFE_ENTRY_SEGMENT_PATTERN.test(segment));
}

/**
 * Bundle files are not a transport for opaque blobs.  A data URL is always
 * excluded, and a line that is itself an encoded payload is excluded as well.
 * This deliberately errs on the side of metadata-only sharing.
 */
function hasBase64Payload(text: string): boolean {
  if (DATA_URL_BASE64_PATTERN.test(text)) return true;
  return text.split(/\r?\n/u).some((line) => {
    const candidate = line.trim();
    return (
      BASE64_LINE_PATTERN.test(candidate) &&
      candidate.length % 4 === 0 &&
      Buffer.from(candidate, 'base64').byteLength > 0
    );
  });
}

function completedSafeSecretScan(
  text: string,
  source: string,
  maxBytes: number,
):
  | 'PASS'
  | 'SECRET_DETECTED'
  | 'SECRET_SCAN_INCOMPLETE'
  | 'BASE64_PAYLOAD_DETECTED' {
  if (hasBase64Payload(text)) return 'BASE64_PAYLOAD_DETECTED';
  try {
    const scan = scanSecrets(text, {
      source,
      fingerprintKey: 'rn-agent-observer/session-share-bundle/v1',
      maxBytes,
    });
    if (scan.outcome === 'NOT_VERIFIED') return 'SECRET_SCAN_INCOMPLETE';
    return scan.matches.length > 0 ? 'SECRET_DETECTED' : 'PASS';
  } catch {
    // Do not convert a scanner failure into permission to share the content.
    return 'SECRET_SCAN_INCOMPLETE';
  }
}

function isContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return !(
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  );
}

function safeArtifactLocation(
  lexicalRoot: string,
  realRoot: string,
  artifactPath: string,
): SafeArtifactLocation {
  const candidate = isAbsolute(artifactPath)
    ? resolve(artifactPath)
    : resolve(lexicalRoot, artifactPath);
  if (!isContained(lexicalRoot, candidate)) {
    throw new SessionShareBundleError(
      'ARTIFACT_PATH_ESCAPE',
      'Artifact path escapes artifactRoot',
    );
  }
  const relativeName = relative(lexicalRoot, candidate).replaceAll('\\', '/');
  if (!isSafeBundleEntryName(relativeName)) {
    throw new SessionShareBundleError(
      'ARTIFACT_NAME_UNSAFE',
      'Artifact entry name is not portable',
    );
  }

  let current = lexicalRoot;
  for (const segment of relativeName.split('/')) {
    current = join(current, segment);
    const information = lstatSync(current);
    if (information.isSymbolicLink()) {
      throw new SessionShareBundleError(
        'ARTIFACT_SYMLINK_EXCLUDED',
        'Symlink artifacts and symlink path components are excluded',
      );
    }
  }
  const realCandidate = realpathSync.native(candidate);
  if (!isContained(realRoot, realCandidate)) {
    throw new SessionShareBundleError(
      'ARTIFACT_REALPATH_ESCAPE',
      'Artifact real path escapes artifactRoot',
    );
  }
  return { path: candidate, name: relativeName };
}

function textArtifact(artifact: Artifact, path: string): boolean {
  const mimeType = artifact.mimeType?.toLowerCase();
  if (
    mimeType?.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/x-ndjson'
  ) {
    return true;
  }
  return TEXT_EXTENSIONS.has(extname(path).toLowerCase());
}

function readAndHashArtifact(
  path: string,
  maximumBytes: number,
  textCaptureLimit?: number,
): ArtifactReadResult {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const file = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(file);
    if (!before.isFile()) {
      throw new SessionShareBundleError(
        'ARTIFACT_NOT_FILE',
        'Artifact is not a regular file',
      );
    }
    if (before.size > maximumBytes) {
      throw new SessionShareBundleError(
        'ARTIFACT_READ_LIMIT',
        'Artifact exceeds its bounded read allowance',
      );
    }
    const captureText =
      textCaptureLimit !== undefined && before.size <= textCaptureLimit;
    const digest = createHash('sha256');
    const chunks: Buffer[] = [];
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const bytesRead = readSync(
        file,
        buffer,
        0,
        Math.min(buffer.byteLength, before.size - offset),
        offset,
      );
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      if (captureText) chunks.push(Buffer.from(chunk));
      offset += bytesRead;
    }
    const after = fstatSync(file);
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new SessionShareBundleError(
        'ARTIFACT_CHANGED_DURING_READ',
        'Artifact changed while the bundle was being created',
      );
    }
    const text = captureText
      ? new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))
      : undefined;
    if (text?.includes('\0')) {
      throw new SessionShareBundleError(
        'ARTIFACT_TEXT_INVALID',
        'Text artifact contains NUL characters',
      );
    }
    return {
      bytes: before.size,
      sha256: digest.digest('hex'),
      ...(text === undefined ? {} : { text }),
    };
  } finally {
    closeSync(file);
  }
}

function excludedEntry(
  artifact: Artifact,
  name: string,
  reason: string,
): ShareBundleEntry {
  return {
    name,
    artifactId: safeArtifactReference(artifact.id),
    kind: artifact.kind,
    createdAt: artifact.createdAt,
    ...(artifact.mimeType && SAFE_MIME_PATTERN.test(artifact.mimeType)
      ? { mimeType: artifact.mimeType }
      : {}),
    inclusion: 'excluded',
    verification: 'NOT_VERIFIED',
    reason,
    bytes: null,
    sha256: null,
  };
}

function fallbackEntryName(artifact: Artifact, index: number): string {
  return `excluded/${safeArtifactReference(artifact.id)}-${index + 1}.entry`;
}

function entryForArtifact(input: {
  readonly artifact: Artifact;
  readonly index: number;
  readonly lexicalRoot: string;
  readonly realRoot: string;
  readonly includeTextArtifacts: boolean;
  readonly limits: ShareBundleLimits;
  readonly remainingBytes: number;
}): ShareBundleEntry {
  const fallbackName = fallbackEntryName(input.artifact, input.index);
  let location: SafeArtifactLocation;
  try {
    location = safeArtifactLocation(
      input.lexicalRoot,
      input.realRoot,
      input.artifact.path,
    );
  } catch (error) {
    const reason =
      error instanceof SessionShareBundleError
        ? error.code
        : 'ARTIFACT_MISSING_OR_UNREADABLE';
    return excludedEntry(input.artifact, fallbackName, reason);
  }

  let size: number;
  try {
    const information = statSync(location.path);
    if (!information.isFile()) {
      return excludedEntry(input.artifact, location.name, 'ARTIFACT_NOT_FILE');
    }
    size = information.size;
  } catch {
    return excludedEntry(
      input.artifact,
      location.name,
      'ARTIFACT_MISSING_OR_UNREADABLE',
    );
  }
  if (size > input.limits.maxEntryBytes) {
    return excludedEntry(input.artifact, location.name, 'ARTIFACT_ENTRY_LIMIT');
  }
  if (size > input.remainingBytes) {
    return excludedEntry(input.artifact, location.name, 'ARTIFACT_TOTAL_LIMIT');
  }

  const isText = textArtifact(input.artifact, location.path);
  const wantsText = input.includeTextArtifacts && isText;
  let read: ArtifactReadResult;
  try {
    read = readAndHashArtifact(
      location.path,
      Math.min(input.limits.maxEntryBytes, input.remainingBytes),
      wantsText ? input.limits.maxEmbeddedTextBytes : undefined,
    );
  } catch (error) {
    const reason =
      error instanceof SessionShareBundleError
        ? error.code
        : 'ARTIFACT_READ_FAILED';
    return excludedEntry(input.artifact, location.name, reason);
  }

  const base = {
    name: location.name,
    artifactId: safeArtifactReference(input.artifact.id),
    kind: input.artifact.kind,
    createdAt: input.artifact.createdAt,
    ...(input.artifact.mimeType &&
    SAFE_MIME_PATTERN.test(input.artifact.mimeType)
      ? { mimeType: input.artifact.mimeType }
      : {}),
    bytes: read.bytes,
    sha256: read.sha256,
  };
  if (!wantsText) {
    return {
      ...base,
      inclusion: 'metadata-only',
      verification: 'VERIFIED',
      reason: isText ? 'TEXT_EMBEDDING_DISABLED' : 'BINARY_EMBEDDING_DISABLED',
    };
  }
  if (read.text === undefined) {
    return {
      ...base,
      inclusion: 'metadata-only',
      verification: 'NOT_VERIFIED',
      reason: 'SECRET_SCAN_INCOMPLETE',
    };
  }

  const scanStatus = completedSafeSecretScan(
    read.text,
    `bundle:${location.name}`,
    input.limits.maxEmbeddedTextBytes,
  );
  if (scanStatus !== 'PASS') {
    return {
      ...base,
      inclusion: 'metadata-only',
      verification: 'NOT_VERIFIED',
      reason: scanStatus,
    };
  }
  return {
    ...base,
    inclusion: 'embedded-text',
    verification: 'VERIFIED',
    content: read.text,
  };
}

/**
 * JSON object insertion order must not become part of the portable bundle
 * format.  Parsing an exported bundle necessarily reconstructs some objects
 * in a different order, so use one recursively sorted representation for both
 * emission and verification.
 */
function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value)) return value;

  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort((first, second) =>
    first < second ? -1 : first > second ? 1 : 0,
  )) {
    canonical[key] = canonicalJsonValue(value[key]);
  }
  return canonical;
}

function serializeBundle(envelope: SessionShareBundleEnvelope): Buffer {
  return Buffer.from(
    `${JSON.stringify(canonicalJsonValue(envelope), null, 2)}\n`,
    'utf8',
  );
}

function resultCounts(entries: readonly ShareBundleEntry[]): {
  embeddedTextCount: number;
  metadataOnlyCount: number;
  excludedCount: number;
  notVerifiedCount: number;
} {
  return {
    embeddedTextCount: entries.filter(
      (entry) => entry.inclusion === 'embedded-text',
    ).length,
    metadataOnlyCount: entries.filter(
      (entry) => entry.inclusion === 'metadata-only',
    ).length,
    excludedCount: entries.filter((entry) => entry.inclusion === 'excluded')
      .length,
    notVerifiedCount: entries.filter(
      (entry) => entry.verification === 'NOT_VERIFIED',
    ).length,
  };
}

function writeExclusivePrivate(path: string, data: Buffer): void {
  let file: number | undefined;
  let created = false;
  try {
    file = openSync(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    created = true;
    try {
      fchmodSync(file, 0o600);
    } catch {
      // Some Windows filesystems do not implement POSIX modes.
    }
    writeFileSync(file, data);
    closeSync(file);
    file = undefined;
  } catch (error) {
    if (file !== undefined) closeSync(file);
    if (created) {
      try {
        unlinkSync(path);
      } catch {
        // Best effort cleanup of only the partial file created by this call.
      }
    }
    if (isRecord(error) && 'code' in error && error.code === 'EEXIST') {
      throw new SessionShareBundleError(
        'BUNDLE_OUTPUT_EXISTS',
        'Bundle output already exists and will not be overwritten',
      );
    }
    throw error;
  }
}

export function exportSessionShareBundle(
  session: Session,
  options: ExportSessionShareBundleOptions,
): ExportSessionShareBundleResult {
  const limits = normalizeLimits(options.limits);
  if (!options.outputPath.toLowerCase().endsWith('.rnobs')) {
    throw new SessionShareBundleError(
      'BUNDLE_EXTENSION_INVALID',
      'Bundle output must use the .rnobs extension',
    );
  }
  const createdAt = options.now?.() ?? new Date().toISOString();
  assertTimestamp(createdAt, 'createdAt');
  assertTimestamp(session.startedAt, 'session.startedAt');
  if (session.stoppedAt)
    assertTimestamp(session.stoppedAt, 'session.stoppedAt');
  const sessionId = safeIdentifier(session.id, 'session.id');
  const lexicalRoot = resolve(options.artifactRoot);
  let realRoot: string;
  try {
    realRoot = realpathSync.native(lexicalRoot);
  } catch {
    throw new SessionShareBundleError(
      'ARTIFACT_ROOT_INVALID',
      'artifactRoot must already exist',
    );
  }
  if (!statSync(realRoot).isDirectory()) {
    throw new SessionShareBundleError(
      'ARTIFACT_ROOT_INVALID',
      'artifactRoot must be a directory',
    );
  }

  const artifacts = [...session.artifacts].sort((first, second) =>
    first.id < second.id ? -1 : first.id > second.id ? 1 : 0,
  );
  const selected = artifacts.slice(0, limits.maxEntries);
  const omittedArtifactCount = artifacts.length - selected.length;
  const entries: ShareBundleEntry[] = [];
  const usedNames = new Set<string>();
  let accountedBytes = 0;
  for (const [index, artifact] of selected.entries()) {
    assertTimestamp(artifact.createdAt, `artifact[${index}].createdAt`);
    let entry = entryForArtifact({
      artifact,
      index,
      lexicalRoot,
      realRoot,
      includeTextArtifacts: options.includeTextArtifacts ?? false,
      limits,
      remainingBytes: Math.max(
        0,
        limits.maxTotalArtifactBytes - accountedBytes,
      ),
    });
    if (usedNames.has(entry.name)) {
      entry = excludedEntry(
        artifact,
        fallbackEntryName(artifact, index),
        'ARTIFACT_ENTRY_NAME_DUPLICATE',
      );
    }
    usedNames.add(entry.name);
    if (entry.bytes !== null) accountedBytes += entry.bytes;
    entries.push(entry);
  }
  const counts = resultCounts(entries);
  const outcome: ShareBundleOutcome =
    counts.notVerifiedCount > 0 || omittedArtifactCount > 0
      ? 'NOT_VERIFIED'
      : 'PASS';
  const envelope: SessionShareBundleEnvelope = {
    schema: SESSION_SHARE_BUNDLE_SCHEMA,
    version: SESSION_SHARE_BUNDLE_VERSION,
    createdAt,
    session: {
      id: sessionId,
      startedAt: session.startedAt,
      ...(session.stoppedAt === undefined
        ? {}
        : { stoppedAt: session.stoppedAt }),
      status: session.status,
      eventCount: session.timeline.length,
      artifactCount: session.artifacts.length,
    },
    policy: {
      binaryEmbedding: 'disabled',
      textEmbedding: options.includeTextArtifacts
        ? 'bounded-secret-scanned'
        : 'disabled',
      limits,
    },
    outcome,
    omittedArtifactCount,
    entries,
  };
  const serialized = serializeBundle(envelope);
  if (serialized.byteLength > limits.maxBundleBytes) {
    throw new SessionShareBundleError(
      'BUNDLE_SIZE_LIMIT',
      `Bundle is ${serialized.byteLength} bytes; limit is ${limits.maxBundleBytes}`,
    );
  }
  const outputPath = resolve(options.outputPath);
  writeExclusivePrivate(outputPath, serialized);
  return {
    path: outputPath,
    sha256: sha256(serialized),
    bytes: serialized.byteLength,
    outcome,
    entryCount: entries.length,
    embeddedTextCount: counts.embeddedTextCount,
    metadataOnlyCount: counts.metadataOnlyCount,
    excludedCount: counts.excludedCount,
    omittedArtifactCount,
  };
}

function assertKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unexpected) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path} contains unsupported field ${unexpected}`,
    );
  }
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  path: string,
): string {
  const found = value[key];
  if (typeof found !== 'string' || found.length === 0) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path}.${key} must be a non-empty string`,
    );
  }
  return found;
}

function requiredInteger(
  value: Record<string, unknown>,
  key: string,
  path: string,
): number {
  const found = value[key];
  if (!Number.isSafeInteger(found) || typeof found !== 'number' || found < 0) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path}.${key} must be a non-negative integer`,
    );
  }
  return found;
}

function parseLimits(value: unknown): ShareBundleLimits {
  if (!isRecord(value)) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      'policy.limits must be an object',
    );
  }
  assertKeys(
    value,
    [
      'maxEntries',
      'maxEntryBytes',
      'maxTotalArtifactBytes',
      'maxEmbeddedTextBytes',
      'maxBundleBytes',
    ],
    'policy.limits',
  );
  return normalizeLimits({
    maxEntries: requiredInteger(value, 'maxEntries', 'policy.limits'),
    maxEntryBytes: requiredInteger(value, 'maxEntryBytes', 'policy.limits'),
    maxTotalArtifactBytes: requiredInteger(
      value,
      'maxTotalArtifactBytes',
      'policy.limits',
    ),
    maxEmbeddedTextBytes: requiredInteger(
      value,
      'maxEmbeddedTextBytes',
      'policy.limits',
    ),
    maxBundleBytes: requiredInteger(value, 'maxBundleBytes', 'policy.limits'),
  });
}

function parseEntry(
  value: unknown,
  index: number,
  verifierLimits: ShareBundleLimits,
): ShareBundleEntry {
  const path = `entries[${index}]`;
  if (!isRecord(value)) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path} must be an object`,
    );
  }
  assertKeys(
    value,
    [
      'name',
      'artifactId',
      'kind',
      'createdAt',
      'mimeType',
      'inclusion',
      'verification',
      'reason',
      'bytes',
      'sha256',
      'content',
    ],
    path,
  );
  const name = requiredString(value, 'name', path);
  if (!isSafeBundleEntryName(name)) {
    throw new SessionShareBundleError(
      'BUNDLE_ENTRY_NAME_UNSAFE',
      `${path}.name is not a safe relative entry name`,
    );
  }
  const artifactId = safeIdentifier(
    requiredString(value, 'artifactId', path),
    `${path}.artifactId`,
  );
  const kindValue = requiredString(value, 'kind', path);
  if (!ARTIFACT_KINDS.has(kindValue as Artifact['kind'])) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path}.kind is invalid`,
    );
  }
  const kind = kindValue as Artifact['kind'];
  const createdAt = requiredString(value, 'createdAt', path);
  assertTimestamp(createdAt, `${path}.createdAt`);
  const mimeType = value.mimeType;
  if (
    mimeType !== undefined &&
    (typeof mimeType !== 'string' || !SAFE_MIME_PATTERN.test(mimeType))
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path}.mimeType is invalid`,
    );
  }
  const inclusion = value.inclusion;
  if (
    inclusion !== 'metadata-only' &&
    inclusion !== 'embedded-text' &&
    inclusion !== 'excluded'
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path}.inclusion is invalid`,
    );
  }
  const verification = value.verification;
  if (verification !== 'VERIFIED' && verification !== 'NOT_VERIFIED') {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path}.verification is invalid`,
    );
  }
  const reason = value.reason;
  if (reason !== undefined && typeof reason !== 'string') {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path}.reason is invalid`,
    );
  }

  if (inclusion === 'excluded') {
    if (
      verification !== 'NOT_VERIFIED' ||
      value.bytes !== null ||
      value.sha256 !== null ||
      value.content !== undefined ||
      typeof reason !== 'string'
    ) {
      throw new SessionShareBundleError(
        'BUNDLE_FORMAT_INVALID',
        `${path} has inconsistent excluded fields`,
      );
    }
    return {
      name,
      artifactId,
      kind,
      createdAt,
      ...(typeof mimeType === 'string' ? { mimeType } : {}),
      inclusion,
      verification,
      reason,
      bytes: null,
      sha256: null,
    };
  }

  const bytes = requiredInteger(value, 'bytes', path);
  if (
    bytes > verifierLimits.maxEntryBytes ||
    typeof value.sha256 !== 'string' ||
    !HASH_PATTERN.test(value.sha256)
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_ENTRY_LIMIT_OR_HASH',
      `${path} exceeds limits or has an invalid hash`,
    );
  }
  const entryHash = value.sha256;
  if (inclusion === 'embedded-text') {
    if (
      verification !== 'VERIFIED' ||
      typeof value.content !== 'string' ||
      reason !== undefined
    ) {
      throw new SessionShareBundleError(
        'BUNDLE_FORMAT_INVALID',
        `${path} has inconsistent embedded text fields`,
      );
    }
    const contentBytes = Buffer.from(value.content, 'utf8');
    if (
      contentBytes.byteLength !== bytes ||
      contentBytes.byteLength > verifierLimits.maxEmbeddedTextBytes ||
      sha256(contentBytes) !== entryHash
    ) {
      throw new SessionShareBundleError(
        'BUNDLE_ENTRY_HASH_MISMATCH',
        `${path} embedded content does not match size/hash`,
      );
    }
    if (
      completedSafeSecretScan(
        value.content,
        `bundle:${name}`,
        verifierLimits.maxEmbeddedTextBytes,
      ) !== 'PASS'
    ) {
      throw new SessionShareBundleError(
        'BUNDLE_EMBEDDED_TEXT_UNSAFE',
        `${path} contains secret-like or base64 payload content`,
      );
    }
    return {
      name,
      artifactId,
      kind,
      createdAt,
      ...(typeof mimeType === 'string' ? { mimeType } : {}),
      inclusion,
      verification,
      bytes,
      sha256: entryHash,
      content: value.content,
    };
  }
  if (value.content !== undefined || typeof reason !== 'string') {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      `${path} has inconsistent metadata-only fields`,
    );
  }
  return {
    name,
    artifactId,
    kind,
    createdAt,
    ...(typeof mimeType === 'string' ? { mimeType } : {}),
    inclusion,
    verification,
    reason,
    bytes,
    sha256: entryHash,
  };
}

function parseEnvelope(
  value: unknown,
  verifierLimits: ShareBundleLimits,
): SessionShareBundleEnvelope {
  if (!isRecord(value)) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      'Bundle must be a JSON object',
    );
  }
  assertKeys(
    value,
    [
      'schema',
      'version',
      'createdAt',
      'session',
      'policy',
      'outcome',
      'omittedArtifactCount',
      'entries',
    ],
    'bundle',
  );
  if (
    value.schema !== SESSION_SHARE_BUNDLE_SCHEMA ||
    value.version !== SESSION_SHARE_BUNDLE_VERSION
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_VERSION_UNSUPPORTED',
      'Bundle schema or version is unsupported',
    );
  }
  const createdAt = requiredString(value, 'createdAt', 'bundle');
  assertTimestamp(createdAt, 'bundle.createdAt');
  if (!isRecord(value.session)) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      'bundle.session must be an object',
    );
  }
  assertKeys(
    value.session,
    ['id', 'startedAt', 'stoppedAt', 'status', 'eventCount', 'artifactCount'],
    'bundle.session',
  );
  const sessionId = safeIdentifier(
    requiredString(value.session, 'id', 'bundle.session'),
    'bundle.session.id',
  );
  const startedAt = requiredString(
    value.session,
    'startedAt',
    'bundle.session',
  );
  assertTimestamp(startedAt, 'bundle.session.startedAt');
  const stoppedAt = value.session.stoppedAt;
  if (stoppedAt !== undefined) {
    if (typeof stoppedAt !== 'string') {
      throw new SessionShareBundleError(
        'BUNDLE_FORMAT_INVALID',
        'bundle.session.stoppedAt must be a string',
      );
    }
    assertTimestamp(stoppedAt, 'bundle.session.stoppedAt');
  }
  const status = value.session.status;
  if (status !== 'active' && status !== 'complete' && status !== 'failed') {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      'bundle.session.status is invalid',
    );
  }
  const eventCount = requiredInteger(
    value.session,
    'eventCount',
    'bundle.session',
  );
  const artifactCount = requiredInteger(
    value.session,
    'artifactCount',
    'bundle.session',
  );
  if (!isRecord(value.policy)) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      'bundle.policy must be an object',
    );
  }
  assertKeys(
    value.policy,
    ['binaryEmbedding', 'textEmbedding', 'limits'],
    'bundle.policy',
  );
  if (
    value.policy.binaryEmbedding !== 'disabled' ||
    (value.policy.textEmbedding !== 'disabled' &&
      value.policy.textEmbedding !== 'bounded-secret-scanned')
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_POLICY_UNSUPPORTED',
      'Bundle embedding policy is unsupported',
    );
  }
  const bundleLimits = parseLimits(value.policy.limits);
  const effectiveEntryLimits: ShareBundleLimits = {
    maxEntries: Math.min(verifierLimits.maxEntries, bundleLimits.maxEntries),
    maxEntryBytes: Math.min(
      verifierLimits.maxEntryBytes,
      bundleLimits.maxEntryBytes,
    ),
    maxTotalArtifactBytes: Math.min(
      verifierLimits.maxTotalArtifactBytes,
      bundleLimits.maxTotalArtifactBytes,
    ),
    maxEmbeddedTextBytes: Math.min(
      verifierLimits.maxEmbeddedTextBytes,
      bundleLimits.maxEmbeddedTextBytes,
    ),
    maxBundleBytes: Math.min(
      verifierLimits.maxBundleBytes,
      bundleLimits.maxBundleBytes,
    ),
  };
  const outcome = value.outcome;
  if (outcome !== 'PASS' && outcome !== 'NOT_VERIFIED') {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      'bundle.outcome is invalid',
    );
  }
  const omittedArtifactCount = requiredInteger(
    value,
    'omittedArtifactCount',
    'bundle',
  );
  if (!Array.isArray(value.entries)) {
    throw new SessionShareBundleError(
      'BUNDLE_FORMAT_INVALID',
      'bundle.entries must be an array',
    );
  }
  if (
    value.entries.length > verifierLimits.maxEntries ||
    value.entries.length > bundleLimits.maxEntries
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_ENTRY_LIMIT',
      'Bundle contains too many entries',
    );
  }
  const entries = value.entries.map((entry, index) =>
    parseEntry(entry, index, effectiveEntryLimits),
  );
  const names = new Set<string>();
  let totalBytes = 0;
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new SessionShareBundleError(
        'BUNDLE_ENTRY_DUPLICATE',
        `Bundle contains duplicate entry ${entry.name}`,
      );
    }
    names.add(entry.name);
    if (entry.bytes !== null) totalBytes += entry.bytes;
  }
  if (
    totalBytes > verifierLimits.maxTotalArtifactBytes ||
    totalBytes > bundleLimits.maxTotalArtifactBytes
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_TOTAL_LIMIT',
      'Bundle declared artifact bytes exceed the configured limit',
    );
  }
  const counts = resultCounts(entries);
  if (
    value.policy.textEmbedding === 'disabled' &&
    counts.embeddedTextCount > 0
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_POLICY_INCONSISTENT',
      'Bundle embeds text while its policy disables text embedding',
    );
  }
  if (entries.length + omittedArtifactCount !== artifactCount) {
    throw new SessionShareBundleError(
      'BUNDLE_ARTIFACT_COUNT_INCONSISTENT',
      'Bundle entry and omitted counts do not match session artifactCount',
    );
  }
  const expectedOutcome =
    counts.notVerifiedCount > 0 || omittedArtifactCount > 0
      ? 'NOT_VERIFIED'
      : 'PASS';
  if (outcome !== expectedOutcome) {
    throw new SessionShareBundleError(
      'BUNDLE_OUTCOME_INCONSISTENT',
      'Bundle outcome does not match entry verification state',
    );
  }
  return {
    schema: SESSION_SHARE_BUNDLE_SCHEMA,
    version: SESSION_SHARE_BUNDLE_VERSION,
    createdAt,
    session: {
      id: sessionId,
      startedAt,
      ...(typeof stoppedAt === 'string' ? { stoppedAt } : {}),
      status,
      eventCount,
      artifactCount,
    },
    policy: {
      binaryEmbedding: 'disabled',
      textEmbedding: value.policy.textEmbedding,
      limits: bundleLimits,
    },
    outcome,
    omittedArtifactCount,
    entries,
  };
}

function safeHashMatch(expected: string, actual: string): boolean {
  return HASH_PATTERN.test(expected) && expected === actual;
}

export function verifySessionShareBundle(
  input: Buffer | string,
  options: VerifySessionShareBundleOptions = {},
): VerifySessionShareBundleResult {
  const limits = normalizeLimits(options.limits);
  const serialized = Buffer.isBuffer(input)
    ? input
    : Buffer.from(input, 'utf8');
  if (serialized.byteLength > limits.maxBundleBytes) {
    throw new SessionShareBundleError(
      'BUNDLE_SIZE_LIMIT',
      'Bundle exceeds verifier byte limit',
    );
  }
  const bundleHash = sha256(serialized);
  if (
    options.expectedSha256 !== undefined &&
    !safeHashMatch(options.expectedSha256, bundleHash)
  ) {
    throw new SessionShareBundleError(
      'BUNDLE_HASH_MISMATCH',
      'Whole-file SHA-256 does not match expected value',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(serialized),
    ) as unknown;
  } catch {
    throw new SessionShareBundleError(
      'BUNDLE_JSON_INVALID',
      'Bundle is not valid UTF-8 JSON',
    );
  }
  const envelope = parseEnvelope(parsed, limits);
  if (serialized.byteLength > envelope.policy.limits.maxBundleBytes) {
    throw new SessionShareBundleError(
      'BUNDLE_SIZE_LIMIT',
      'Bundle exceeds its declared byte limit',
    );
  }
  const canonical = serializeBundle(envelope);
  if (!canonical.equals(serialized)) {
    throw new SessionShareBundleError(
      'BUNDLE_CANONICAL_FORMAT_INVALID',
      'Bundle does not use the canonical deterministic encoding',
    );
  }
  const counts = resultCounts(envelope.entries);
  return {
    valid: true,
    sha256: bundleHash,
    bytes: serialized.byteLength,
    schema: envelope.schema,
    version: envelope.version,
    sessionId: envelope.session.id,
    outcome: envelope.outcome,
    entryCount: envelope.entries.length,
    embeddedTextCount: counts.embeddedTextCount,
    metadataOnlyCount: counts.metadataOnlyCount,
    excludedCount: counts.excludedCount,
    notVerifiedCount: counts.notVerifiedCount,
    omittedArtifactCount: envelope.omittedArtifactCount,
  };
}

export function readAndVerifySessionShareBundle(
  path: string,
  options: VerifySessionShareBundleOptions = {},
): VerifySessionShareBundleResult {
  const limits = normalizeLimits(options.limits);
  try {
    const information = lstatSync(path);
    if (information.isSymbolicLink() || !information.isFile()) {
      throw new SessionShareBundleError(
        'BUNDLE_INPUT_UNSAFE',
        'Bundle input must be a regular non-symlink file',
      );
    }
  } catch (error) {
    if (error instanceof SessionShareBundleError) throw error;
    throw new SessionShareBundleError(
      'BUNDLE_INPUT_MISSING',
      'Bundle input does not exist',
    );
  }
  let file: number;
  try {
    file = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch {
    throw new SessionShareBundleError(
      'BUNDLE_INPUT_MISSING',
      'Bundle input is missing or cannot be opened safely',
    );
  }
  let serialized: Buffer;
  try {
    const before = fstatSync(file);
    if (!before.isFile()) {
      throw new SessionShareBundleError(
        'BUNDLE_INPUT_UNSAFE',
        'Bundle input must be a regular non-symlink file',
      );
    }
    if (before.size > limits.maxBundleBytes) {
      throw new SessionShareBundleError(
        'BUNDLE_SIZE_LIMIT',
        'Bundle exceeds verifier byte limit',
      );
    }
    serialized = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < before.size) {
      const bytesRead = readSync(
        file,
        serialized,
        offset,
        before.size - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = fstatSync(file);
    if (
      offset !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new SessionShareBundleError(
        'BUNDLE_INPUT_CHANGED',
        'Bundle changed while it was being read',
      );
    }
  } finally {
    closeSync(file);
  }
  return verifySessionShareBundle(serialized, {
    ...(options.expectedSha256 === undefined
      ? {}
      : { expectedSha256: options.expectedSha256 }),
    limits,
  });
}

/** Only a basename is exposed for UI labels; verification never extracts. */
export function shareBundleDisplayName(path: string): string {
  return basename(path);
}
