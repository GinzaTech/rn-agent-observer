import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const OBSERVER_CONFIG_FILENAME = '.rn-observer.json';
export const OBSERVER_CONFIG_VERSION = 1 as const;
export const OBSERVER_CONFIG_SCHEMA_URL =
  'https://raw.githubusercontent.com/GinzaTech/rn-agent-observer/main/schemas/rn-observer.schema.json';

export const QUALITY_PACKS = [
  'smoke',
  'visual',
  'performance',
  'network',
  'accessibility',
  'security',
  'resilience',
] as const;

export type QualityPack = (typeof QUALITY_PACKS)[number];
export type ObserverMode = 'zero-instrumentation' | 'enhanced';
export type SecurityMode = 'read-only' | 'authorized-active';
export type ActionRisk =
  | 'read'
  | 'app-state'
  | 'device-state'
  | 'persistent-permission'
  | 'network-interception';

export interface ObserverProjectConfig {
  $schema?: string;
  schemaVersion: typeof OBSERVER_CONFIG_VERSION;
  target: {
    platform: 'android';
    mode: ObserverMode;
    appId?: string;
    deviceId?: string;
    metroUrl: string;
  };
  packs: QualityPack[];
  budgets: {
    uiFpsMin?: number;
    jsBlockingMaxMs?: number;
    networkP95MaxMs?: number;
    memoryGrowthMaxMb?: number;
    coldStartMaxMs?: number;
    bundleMaxBytes?: number;
  };
  artifacts: {
    root: string;
    retentionDays: number;
    classification: 'sensitive' | 'internal';
    hash: boolean;
    allowShare: boolean;
  };
  security: {
    mode: SecurityMode;
    allowedActions: ActionRisk[];
    allowedAppIds: string[];
    allowNetworkInterception: boolean;
    allowSensitiveBodyCapture: boolean;
    /**
     * Allows explicitly configured, non-restoring Android permission changes.
     * This is deliberately separate from bounded active-security transitions.
     */
    allowPersistentPermissionChanges: boolean;
    /** Exact Android runtime permission names allowed for persistent changes. */
    allowedPersistentPermissions: string[];
  };
}

export interface LoadedObserverConfig {
  config: ObserverProjectConfig;
  path: string;
  exists: boolean;
}

export interface ObserverConfigInitResult {
  path: string;
  created: boolean;
  dryRun: boolean;
  content: string;
}

export interface SecurityActionDecision {
  allowed: boolean;
  risk: ActionRisk;
  reason: string;
}

/**
 * Every observer operation in this map can change app or device state. Keep
 * the mapping next to the security configuration so CLI, Core, and adapters
 * cannot silently assign different risks to the same operation.
 */
export const OBSERVER_ACTION_RISKS = {
  launch: 'app-state',
  reload: 'app-state',
  tap: 'app-state',
  press: 'app-state',
  swipe: 'app-state',
  'type-text': 'app-state',
  back: 'app-state',
  'deep-link': 'app-state',
  'replay-run': 'app-state',
  'permission-change': 'persistent-permission',
  'trace-start': 'device-state',
  'trace-stop': 'device-state',
  'record-start': 'device-state',
  'record-stop': 'device-state',
  'security-active-deep-link': 'app-state',
  'security-active-permission': 'device-state',
  'performance-interaction': 'app-state',
  'performance-startup': 'app-state',
  'performance-memory-growth': 'app-state',
} as const satisfies Record<string, Exclude<ActionRisk, 'read'>>;

export type ObserverAction = keyof typeof OBSERVER_ACTION_RISKS;

const ACTION_RISKS: readonly ActionRisk[] = [
  'read',
  'app-state',
  'device-state',
  'persistent-permission',
  'network-interception',
];

const TOP_LEVEL_KEYS = new Set([
  '$schema',
  'schemaVersion',
  'target',
  'packs',
  'budgets',
  'artifacts',
  'security',
]);
const TARGET_KEYS = new Set([
  'platform',
  'mode',
  'appId',
  'deviceId',
  'metroUrl',
]);
const BUDGET_KEYS = new Set([
  'uiFpsMin',
  'jsBlockingMaxMs',
  'networkP95MaxMs',
  'memoryGrowthMaxMb',
  'coldStartMaxMs',
  'bundleMaxBytes',
]);
const ARTIFACT_KEYS = new Set([
  'root',
  'retentionDays',
  'classification',
  'hash',
  'allowShare',
]);
const SECURITY_KEYS = new Set([
  'mode',
  'allowedActions',
  'allowedAppIds',
  'allowNetworkInterception',
  'allowSensitiveBodyCapture',
  'allowPersistentPermissionChanges',
  'allowedPersistentPermissions',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${path} contains unknown keys: ${unknown.join(', ')}`);
  }
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value.trim();
}

function optionalPositiveNumber(
  value: unknown,
  path: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  return value;
}

function booleanOrDefault(
  value: unknown,
  fallback: boolean,
  path: string,
): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean')
    throw new TypeError(`${path} must be boolean`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) {
    throw new TypeError(`${path} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => item.trim()))];
}

export function defaultObserverConfig(): ObserverProjectConfig {
  return {
    $schema: OBSERVER_CONFIG_SCHEMA_URL,
    schemaVersion: OBSERVER_CONFIG_VERSION,
    target: {
      platform: 'android',
      mode: 'zero-instrumentation',
      metroUrl: 'http://127.0.0.1:8081',
    },
    packs: ['smoke'],
    budgets: {},
    artifacts: {
      root: '.artifacts',
      retentionDays: 14,
      classification: 'sensitive',
      hash: true,
      allowShare: false,
    },
    security: {
      mode: 'read-only',
      allowedActions: ['read'],
      allowedAppIds: [],
      allowNetworkInterception: false,
      allowSensitiveBodyCapture: false,
      allowPersistentPermissionChanges: false,
      allowedPersistentPermissions: [],
    },
  };
}

export function parseObserverConfig(value: unknown): ObserverProjectConfig {
  const root = assertRecord(value, 'config');
  assertKnownKeys(root, TOP_LEVEL_KEYS, 'config');
  if (root.schemaVersion !== OBSERVER_CONFIG_VERSION) {
    throw new TypeError(
      `config.schemaVersion must be ${OBSERVER_CONFIG_VERSION}`,
    );
  }
  const defaults = defaultObserverConfig();
  const schemaUrl = optionalString(root.$schema, 'config.$schema');
  const target = assertRecord(root.target, 'config.target');
  assertKnownKeys(target, TARGET_KEYS, 'config.target');
  if (target.platform !== undefined && target.platform !== 'android') {
    throw new TypeError('config.target.platform must be android');
  }
  if (
    target.mode !== undefined &&
    target.mode !== 'zero-instrumentation' &&
    target.mode !== 'enhanced'
  ) {
    throw new TypeError(
      'config.target.mode must be zero-instrumentation or enhanced',
    );
  }
  const metroUrl = optionalString(target.metroUrl, 'config.target.metroUrl');
  if (metroUrl !== undefined) {
    const url = new URL(metroUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new TypeError('config.target.metroUrl must use http or https');
    }
  }

  const packsValue = root.packs ?? defaults.packs;
  if (
    !Array.isArray(packsValue) ||
    packsValue.length === 0 ||
    packsValue.some(
      (pack) =>
        typeof pack !== 'string' ||
        !QUALITY_PACKS.includes(pack as QualityPack),
    )
  ) {
    throw new TypeError(
      `config.packs must contain known packs: ${QUALITY_PACKS.join(', ')}`,
    );
  }
  const packs = [...new Set(packsValue)] as QualityPack[];

  const budgets =
    root.budgets === undefined
      ? {}
      : assertRecord(root.budgets, 'config.budgets');
  assertKnownKeys(budgets, BUDGET_KEYS, 'config.budgets');
  const artifacts =
    root.artifacts === undefined
      ? {}
      : assertRecord(root.artifacts, 'config.artifacts');
  assertKnownKeys(artifacts, ARTIFACT_KEYS, 'config.artifacts');
  const retentionDays =
    optionalPositiveNumber(
      artifacts.retentionDays,
      'config.artifacts.retentionDays',
    ) ?? defaults.artifacts.retentionDays;
  if (!Number.isInteger(retentionDays) || retentionDays > 3650) {
    throw new TypeError(
      'config.artifacts.retentionDays must be an integer no greater than 3650',
    );
  }
  if (
    artifacts.classification !== undefined &&
    artifacts.classification !== 'sensitive' &&
    artifacts.classification !== 'internal'
  ) {
    throw new TypeError(
      'config.artifacts.classification must be sensitive or internal',
    );
  }
  if (artifacts.hash === false) {
    throw new TypeError('config.artifacts.hash must remain true');
  }

  const security =
    root.security === undefined
      ? {}
      : assertRecord(root.security, 'config.security');
  assertKnownKeys(security, SECURITY_KEYS, 'config.security');
  const securityMode = security.mode ?? defaults.security.mode;
  if (securityMode !== 'read-only' && securityMode !== 'authorized-active') {
    throw new TypeError(
      'config.security.mode must be read-only or authorized-active',
    );
  }
  const rawActions =
    security.allowedActions ?? defaults.security.allowedActions;
  if (
    !Array.isArray(rawActions) ||
    rawActions.some(
      (action) =>
        typeof action !== 'string' ||
        !ACTION_RISKS.includes(action as ActionRisk),
    )
  ) {
    throw new TypeError(
      `config.security.allowedActions must contain: ${ACTION_RISKS.join(', ')}`,
    );
  }
  const allowedActions = [...new Set(rawActions)] as ActionRisk[];
  const allowedAppIds = stringArray(
    security.allowedAppIds,
    'config.security.allowedAppIds',
  );
  const allowNetworkInterception = booleanOrDefault(
    security.allowNetworkInterception,
    defaults.security.allowNetworkInterception,
    'config.security.allowNetworkInterception',
  );
  const allowSensitiveBodyCapture = booleanOrDefault(
    security.allowSensitiveBodyCapture,
    defaults.security.allowSensitiveBodyCapture,
    'config.security.allowSensitiveBodyCapture',
  );
  const allowPersistentPermissionChanges = booleanOrDefault(
    security.allowPersistentPermissionChanges,
    defaults.security.allowPersistentPermissionChanges,
    'config.security.allowPersistentPermissionChanges',
  );
  const allowedPersistentPermissions = stringArray(
    security.allowedPersistentPermissions,
    'config.security.allowedPersistentPermissions',
  );
  if (securityMode === 'read-only') {
    if (allowedActions.some((action) => action !== 'read')) {
      throw new TypeError(
        'read-only security mode may only allow read actions',
      );
    }
    if (
      allowNetworkInterception ||
      allowSensitiveBodyCapture ||
      allowPersistentPermissionChanges ||
      allowedPersistentPermissions.length > 0
    ) {
      throw new TypeError(
        'read-only security mode cannot enable network interception, body capture, or persistent permission changes',
      );
    }
  }
  if (securityMode === 'authorized-active' && allowedAppIds.length === 0) {
    throw new TypeError(
      'authorized-active security mode requires at least one allowedAppId',
    );
  }
  if (
    allowNetworkInterception &&
    !allowedActions.includes('network-interception')
  ) {
    throw new TypeError(
      'allowNetworkInterception requires network-interception in allowedActions',
    );
  }
  if (
    allowPersistentPermissionChanges &&
    !allowedActions.includes('persistent-permission')
  ) {
    throw new TypeError(
      'allowPersistentPermissionChanges requires persistent-permission in allowedActions',
    );
  }
  if (
    allowPersistentPermissionChanges &&
    allowedPersistentPermissions.length === 0
  ) {
    throw new TypeError(
      'allowPersistentPermissionChanges requires at least one allowedPersistentPermissions entry',
    );
  }
  if (
    !allowPersistentPermissionChanges &&
    allowedPersistentPermissions.length > 0
  ) {
    throw new TypeError(
      'allowedPersistentPermissions requires allowPersistentPermissionChanges=true',
    );
  }

  const appId = optionalString(target.appId, 'config.target.appId');
  const deviceId = optionalString(target.deviceId, 'config.target.deviceId');
  const uiFpsMin = optionalPositiveNumber(
    budgets.uiFpsMin,
    'config.budgets.uiFpsMin',
  );
  const jsBlockingMaxMs = optionalPositiveNumber(
    budgets.jsBlockingMaxMs,
    'config.budgets.jsBlockingMaxMs',
  );
  const networkP95MaxMs = optionalPositiveNumber(
    budgets.networkP95MaxMs,
    'config.budgets.networkP95MaxMs',
  );
  const memoryGrowthMaxMb = optionalPositiveNumber(
    budgets.memoryGrowthMaxMb,
    'config.budgets.memoryGrowthMaxMb',
  );
  const coldStartMaxMs = optionalPositiveNumber(
    budgets.coldStartMaxMs,
    'config.budgets.coldStartMaxMs',
  );
  const bundleMaxBytes = optionalPositiveNumber(
    budgets.bundleMaxBytes,
    'config.budgets.bundleMaxBytes',
  );

  return {
    ...(schemaUrl ? { $schema: schemaUrl } : {}),
    schemaVersion: OBSERVER_CONFIG_VERSION,
    target: {
      platform: 'android',
      mode: (target.mode as ObserverMode | undefined) ?? defaults.target.mode,
      ...(appId !== undefined ? { appId } : {}),
      ...(deviceId !== undefined ? { deviceId } : {}),
      metroUrl: metroUrl ?? defaults.target.metroUrl,
    },
    packs,
    budgets: {
      ...(uiFpsMin !== undefined ? { uiFpsMin } : {}),
      ...(jsBlockingMaxMs !== undefined ? { jsBlockingMaxMs } : {}),
      ...(networkP95MaxMs !== undefined ? { networkP95MaxMs } : {}),
      ...(memoryGrowthMaxMb !== undefined ? { memoryGrowthMaxMb } : {}),
      ...(coldStartMaxMs !== undefined ? { coldStartMaxMs } : {}),
      ...(bundleMaxBytes !== undefined ? { bundleMaxBytes } : {}),
    },
    artifacts: {
      root:
        optionalString(artifacts.root, 'config.artifacts.root') ??
        defaults.artifacts.root,
      retentionDays,
      classification:
        (artifacts.classification as 'sensitive' | 'internal' | undefined) ??
        defaults.artifacts.classification,
      hash: booleanOrDefault(
        artifacts.hash,
        defaults.artifacts.hash,
        'config.artifacts.hash',
      ),
      allowShare: booleanOrDefault(
        artifacts.allowShare,
        defaults.artifacts.allowShare,
        'config.artifacts.allowShare',
      ),
    },
    security: {
      mode: securityMode,
      allowedActions,
      allowedAppIds,
      allowNetworkInterception,
      allowSensitiveBodyCapture,
      allowPersistentPermissionChanges,
      allowedPersistentPermissions,
    },
  };
}

export function loadObserverConfig(projectRoot: string): LoadedObserverConfig {
  const path = join(resolve(projectRoot), OBSERVER_CONFIG_FILENAME);
  if (!existsSync(path)) {
    return { config: defaultObserverConfig(), path, exists: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new TypeError(
      `Could not parse ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  return { config: parseObserverConfig(parsed), path, exists: true };
}

export function initObserverConfig(
  projectRoot: string,
  options: { dryRun?: boolean; overwrite?: boolean } = {},
): ObserverConfigInitResult {
  const path = join(resolve(projectRoot), OBSERVER_CONFIG_FILENAME);
  const content = `${JSON.stringify(defaultObserverConfig(), null, 2)}\n`;
  if (existsSync(path) && !options.overwrite) {
    return { path, created: false, dryRun: options.dryRun ?? false, content };
  }
  if (!options.dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { encoding: 'utf8', flag: 'w' });
  }
  return {
    path,
    created: !(options.dryRun ?? false),
    dryRun: options.dryRun ?? false,
    content,
  };
}

function isContainedPath(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation === '' ||
    (!isAbsolute(relation) &&
      relation !== '..' &&
      !relation.startsWith(`..${sep}`))
  );
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

/**
 * Finds an existing path component without following a dangling symbolic
 * link. The caller resolves that component with realpath before trusting it.
 */
function nearestExistingAncestor(path: string): string {
  let current = path;
  while (true) {
    try {
      lstatSync(current);
      return current;
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new TypeError(
          'config.artifacts.root could not be inspected safely',
          { cause: error },
        );
      }
      const parent = dirname(current);
      if (parent === current) {
        throw new TypeError(
          'config.artifacts.root must have an existing project directory ancestor',
          { cause: error },
        );
      }
      current = parent;
    }
  }
}

function realDirectory(path: string, label: string): string {
  let realPath: string;
  try {
    realPath = realpathSync.native(path);
  } catch (error) {
    throw new TypeError(`${label} could not be resolved safely`, {
      cause: error,
    });
  }
  let information;
  try {
    information = statSync(realPath);
  } catch (error) {
    throw new TypeError(`${label} could not be inspected safely`, {
      cause: error,
    });
  }
  if (!information.isDirectory()) {
    throw new TypeError(`${label} must be a directory`);
  }
  return realPath;
}

/**
 * Resolves an artifact root against a project boundary. Existing symlinks are
 * canonicalized before containment is checked; a missing leaf is allowed only
 * when its nearest existing ancestor remains inside that canonical project
 * directory. This keeps the normal first-run `.artifacts` case working while
 * refusing links or junctions that escape the project.
 */
export function resolveContainedArtifactRoot(
  projectRoot: string,
  configuredRoot: string,
): string {
  const lexicalProjectRoot = resolve(projectRoot);
  const artifactRoot = isAbsolute(configuredRoot)
    ? resolve(configuredRoot)
    : resolve(lexicalProjectRoot, configuredRoot);
  if (!isContainedPath(lexicalProjectRoot, artifactRoot)) {
    throw new TypeError('config.artifacts.root must stay within projectRoot');
  }

  const realProjectRoot = realDirectory(lexicalProjectRoot, 'projectRoot');
  const existingAncestor = nearestExistingAncestor(artifactRoot);
  const realAncestor = realDirectory(
    existingAncestor,
    'config.artifacts.root ancestor',
  );
  if (!isContainedPath(realProjectRoot, realAncestor)) {
    throw new TypeError(
      'config.artifacts.root must stay within projectRoot after resolving symlinks',
    );
  }

  try {
    lstatSync(artifactRoot);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return artifactRoot;
    throw new TypeError('config.artifacts.root could not be inspected safely', {
      cause: error,
    });
  }

  const realArtifactRoot = realDirectory(artifactRoot, 'config.artifacts.root');
  if (!isContainedPath(realProjectRoot, realArtifactRoot)) {
    throw new TypeError(
      'config.artifacts.root must stay within projectRoot after resolving symlinks',
    );
  }
  return artifactRoot;
}

export function resolveArtifactRoot(
  projectRoot: string,
  config: ObserverProjectConfig,
): string {
  return resolveContainedArtifactRoot(projectRoot, config.artifacts.root);
}

export function authorizeSecurityAction(
  config: ObserverProjectConfig,
  risk: ActionRisk,
  appId?: string,
  selectedDeviceId?: string,
): SecurityActionDecision {
  if (risk === 'read') {
    return { allowed: true, risk, reason: 'Read-only evidence is allowed' };
  }
  if (config.security.mode !== 'authorized-active') {
    return {
      allowed: false,
      risk,
      reason: 'Active actions require security.mode=authorized-active',
    };
  }
  if (!appId || !config.security.allowedAppIds.includes(appId)) {
    return {
      allowed: false,
      risk,
      reason: 'Target app ID is not explicitly allowlisted',
    };
  }
  if (!config.security.allowedActions.includes(risk)) {
    return {
      allowed: false,
      risk,
      reason: `Action risk ${risk} is not allowlisted`,
    };
  }
  if (
    !config.target.deviceId ||
    !selectedDeviceId ||
    selectedDeviceId !== config.target.deviceId
  ) {
    return {
      allowed: false,
      risk,
      reason:
        'Active actions require the selected ADB device to exactly match config.target.deviceId',
    };
  }
  if (
    risk === 'network-interception' &&
    !config.security.allowNetworkInterception
  ) {
    return {
      allowed: false,
      risk,
      reason: 'Network interception requires explicit opt-in',
    };
  }
  return {
    allowed: true,
    risk,
    reason: `Authorized for allowlisted app ${appId}`,
  };
}

/**
 * Applies the additional exact-permission gate for an intentionally persistent
 * Android permission mutation. It intentionally does not authorize bounded
 * active-security scenarios, which retain their separate `device-state` risk
 * and restore behavior.
 */
export function authorizePersistentPermissionChange(
  config: ObserverProjectConfig,
  permission: string,
  appId?: string,
  selectedDeviceId?: string,
): SecurityActionDecision {
  const decision = authorizeSecurityAction(
    config,
    'persistent-permission',
    appId,
    selectedDeviceId,
  );
  if (!decision.allowed) return decision;
  if (!config.security.allowPersistentPermissionChanges) {
    return {
      allowed: false,
      risk: 'persistent-permission',
      reason: 'Persistent permission changes require explicit config opt-in',
    };
  }
  if (!config.security.allowedPersistentPermissions.includes(permission)) {
    return {
      allowed: false,
      risk: 'persistent-permission',
      reason: 'Permission is not explicitly allowlisted for persistent changes',
    };
  }
  return {
    allowed: true,
    risk: 'persistent-permission',
    reason: `Authorized persistent permission change for allowlisted app ${appId ?? 'unknown'}`,
  };
}

/** Resolves an operation's fixed risk before applying the project policy. */
export function authorizeObserverAction(
  config: ObserverProjectConfig,
  action: ObserverAction,
  appId?: string,
  selectedDeviceId?: string,
): SecurityActionDecision {
  return authorizeSecurityAction(
    config,
    OBSERVER_ACTION_RISKS[action],
    appId,
    selectedDeviceId,
  );
}
