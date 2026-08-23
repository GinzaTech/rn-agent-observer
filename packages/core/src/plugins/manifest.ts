export const PLUGIN_MANIFEST_VERSION = 1 as const;
export const PLUGIN_API_VERSION = 1 as const;
export const EXTERNAL_PLUGIN_PROTOCOL =
  'rn-agent-observer-plugin-jsonrpc-stdio-v1' as const;

export const DEFAULT_PLUGIN_TIMEOUT_MS = 10_000;
export const DEFAULT_EXTERNAL_SHUTDOWN_TIMEOUT_MS = 2_000;
export const DEFAULT_EXTERNAL_MAX_MESSAGE_BYTES = 1024 * 1024;
export const MAX_PLUGIN_TIMEOUT_MS = 5 * 60_000;
export const MAX_EXTERNAL_MESSAGE_BYTES = 16 * 1024 * 1024;

export const PLUGIN_KINDS = [
  'analyzer',
  'reporter',
  'provider',
  'action',
] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

export const PLUGIN_RISKS = ['read-only', 'low', 'medium', 'high'] as const;
export type PluginRisk = (typeof PLUGIN_RISKS)[number];

export const PLUGIN_PERMISSIONS = [
  'evidence:read',
  'artifacts:read',
  'artifacts:write',
  'project:read',
  'device:read',
  'device:control',
  'network:access',
] as const;
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export interface PluginCapabilities {
  readonly provides: readonly string[];
  readonly requires: readonly string[];
}

export interface InProcessPluginExecution {
  readonly mode: 'in-process';
  /** In-process code has host privileges and is only accepted when trusted. */
  readonly trusted: true;
  /** Cooperative timeout. It cannot terminate synchronous in-process code. */
  readonly timeoutMs: number;
}

export interface ExternalProcessPluginExecution {
  readonly mode: 'external-process';
  readonly protocol: typeof EXTERNAL_PLUGIN_PROTOCOL;
  readonly command: string;
  readonly args: readonly string[];
  /** The host must spawn the command directly and never through a shell. */
  readonly shell: false;
  /** Environment variable names the host may explicitly forward. */
  readonly environmentAllowlist: readonly string[];
  readonly requestTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly maxMessageBytes: number;
}

interface PluginManifestBase {
  readonly manifestVersion: typeof PLUGIN_MANIFEST_VERSION;
  readonly apiVersion: typeof PLUGIN_API_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly description?: string;
  readonly capabilities: PluginCapabilities;
  readonly permissions: readonly PluginPermission[];
  readonly risk: PluginRisk;
}

export interface AnalyzerPluginManifest extends PluginManifestBase {
  readonly kind: 'analyzer';
  readonly execution: InProcessPluginExecution;
}

export interface ReporterPluginManifest extends PluginManifestBase {
  readonly kind: 'reporter';
  readonly execution: InProcessPluginExecution;
}

export interface ProviderPluginManifest extends PluginManifestBase {
  readonly kind: 'provider';
  readonly execution: ExternalProcessPluginExecution;
}

export interface ActionPluginManifest extends PluginManifestBase {
  readonly kind: 'action';
  readonly execution: ExternalProcessPluginExecution;
}

export type InProcessPluginManifest =
  AnalyzerPluginManifest | ReporterPluginManifest;
export type ExternalPluginManifest =
  ProviderPluginManifest | ActionPluginManifest;
export type PluginManifest = InProcessPluginManifest | ExternalPluginManifest;

export interface PluginValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type PluginValidationResult<T> =
  | { readonly success: true; readonly value: T }
  | {
      readonly success: false;
      readonly issues: readonly PluginValidationIssue[];
    };

export class PluginManifestError extends Error {
  readonly issues: readonly PluginValidationIssue[];

  constructor(issues: readonly PluginValidationIssue[]) {
    super(
      `Invalid plugin manifest: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'PluginManifestError';
    this.issues = issues;
  }
}

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._/-]*[a-z0-9])?$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(?:[.:-][a-z0-9][a-z0-9-]*)+$/;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const RISK_ORDER: Readonly<Record<PluginRisk, number>> = {
  'read-only': 0,
  low: 1,
  medium: 2,
  high: 3,
};

const PERMISSION_RISK: Readonly<Record<PluginPermission, PluginRisk>> = {
  'evidence:read': 'read-only',
  'artifacts:read': 'read-only',
  'project:read': 'read-only',
  'device:read': 'read-only',
  'artifacts:write': 'low',
  'network:access': 'medium',
  'device:control': 'high',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(
  issues: PluginValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: PluginValidationIssue[],
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    issue(
      issues,
      `${path}.${key}`,
      'required_string',
      'must be a non-empty string',
    );
    return undefined;
  }
  return value.trim();
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: PluginValidationIssue[],
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    issue(
      issues,
      `${path}.${key}`,
      'invalid_string',
      'must be a non-empty string',
    );
    return undefined;
  }
  return value.trim();
}

function boundedInteger(
  value: unknown,
  fallback: number,
  path: string,
  maximum: number,
  issues: PluginValidationIssue[],
): number {
  const candidate = value ?? fallback;
  if (
    typeof candidate !== 'number' ||
    !Number.isInteger(candidate) ||
    candidate <= 0 ||
    candidate > maximum
  ) {
    issue(
      issues,
      path,
      'invalid_limit',
      `must be an integer between 1 and ${maximum}`,
    );
    return fallback;
  }
  return candidate;
}

function uniqueStrings(
  value: unknown,
  path: string,
  issues: PluginValidationIssue[],
  options: {
    readonly required: boolean;
    readonly pattern?: RegExp;
    readonly unique?: boolean;
  },
): string[] {
  if (!Array.isArray(value)) {
    if (options.required) {
      issue(issues, path, 'required_array', 'must be an array');
    }
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      issue(
        issues,
        `${path}[${index}]`,
        'invalid_string',
        'must be a non-empty string',
      );
      return;
    }
    const normalized = entry.trim();
    if (normalized.includes('\0') || normalized.includes('\n')) {
      issue(
        issues,
        `${path}[${index}]`,
        'unsafe_string',
        'must not contain NUL or newline characters',
      );
      return;
    }
    if (options.pattern && !options.pattern.test(normalized)) {
      issue(
        issues,
        `${path}[${index}]`,
        'invalid_format',
        'has an invalid format',
      );
      return;
    }
    if ((options.unique ?? true) && seen.has(normalized)) {
      issue(
        issues,
        `${path}[${index}]`,
        'duplicate',
        `duplicates ${normalized}`,
      );
      return;
    }
    if (options.unique ?? true) seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function parseCapabilities(
  value: unknown,
  issues: PluginValidationIssue[],
): PluginCapabilities {
  if (!isRecord(value)) {
    issue(
      issues,
      'manifest.capabilities',
      'required_object',
      'must declare provides and requires arrays',
    );
    return { provides: [], requires: [] };
  }
  return {
    provides: uniqueStrings(
      value.provides,
      'manifest.capabilities.provides',
      issues,
      { required: true, pattern: CAPABILITY_PATTERN },
    ),
    requires: uniqueStrings(
      value.requires,
      'manifest.capabilities.requires',
      issues,
      { required: true, pattern: CAPABILITY_PATTERN },
    ),
  };
}

function parsePermissions(
  value: unknown,
  issues: PluginValidationIssue[],
): PluginPermission[] {
  const values = uniqueStrings(value, 'manifest.permissions', issues, {
    required: true,
  });
  return values.flatMap((permission, index) => {
    if (!(PLUGIN_PERMISSIONS as readonly string[]).includes(permission)) {
      issue(
        issues,
        `manifest.permissions[${index}]`,
        'unknown_permission',
        `${permission} is not a supported permission`,
      );
      return [];
    }
    return [permission as PluginPermission];
  });
}

function parseRisk(
  value: unknown,
  issues: PluginValidationIssue[],
): PluginRisk {
  if (!(PLUGIN_RISKS as readonly unknown[]).includes(value)) {
    issue(
      issues,
      'manifest.risk',
      'invalid_risk',
      `must be one of ${PLUGIN_RISKS.join(', ')}`,
    );
    return 'read-only';
  }
  return value as PluginRisk;
}

function parseInProcessExecution(
  value: Record<string, unknown>,
  issues: PluginValidationIssue[],
): InProcessPluginExecution {
  if (value.trusted !== true) {
    issue(
      issues,
      'manifest.execution.trusted',
      'trusted_required',
      'in-process plugins must explicitly declare trusted: true',
    );
  }
  return {
    mode: 'in-process',
    trusted: true,
    timeoutMs: boundedInteger(
      value.timeoutMs,
      DEFAULT_PLUGIN_TIMEOUT_MS,
      'manifest.execution.timeoutMs',
      MAX_PLUGIN_TIMEOUT_MS,
      issues,
    ),
  };
}

function parseExternalExecution(
  value: Record<string, unknown>,
  issues: PluginValidationIssue[],
): ExternalProcessPluginExecution {
  if (value.protocol !== EXTERNAL_PLUGIN_PROTOCOL) {
    issue(
      issues,
      'manifest.execution.protocol',
      'unsupported_protocol',
      `must equal ${EXTERNAL_PLUGIN_PROTOCOL}`,
    );
  }
  if (value.shell !== false) {
    issue(
      issues,
      'manifest.execution.shell',
      'shell_forbidden',
      'external plugins must explicitly declare shell: false',
    );
  }
  const command = requiredString(
    value,
    'command',
    'manifest.execution',
    issues,
  );
  if (command?.includes('\0') || command?.includes('\n')) {
    issue(
      issues,
      'manifest.execution.command',
      'unsafe_command',
      'must not contain NUL or newline characters',
    );
  }
  return {
    mode: 'external-process',
    protocol: EXTERNAL_PLUGIN_PROTOCOL,
    command: command ?? '',
    args: uniqueStrings(value.args ?? [], 'manifest.execution.args', issues, {
      required: true,
      unique: false,
    }),
    shell: false,
    environmentAllowlist: uniqueStrings(
      value.environmentAllowlist ?? [],
      'manifest.execution.environmentAllowlist',
      issues,
      { required: true, pattern: ENVIRONMENT_NAME_PATTERN },
    ),
    requestTimeoutMs: boundedInteger(
      value.requestTimeoutMs,
      DEFAULT_PLUGIN_TIMEOUT_MS,
      'manifest.execution.requestTimeoutMs',
      MAX_PLUGIN_TIMEOUT_MS,
      issues,
    ),
    shutdownTimeoutMs: boundedInteger(
      value.shutdownTimeoutMs,
      DEFAULT_EXTERNAL_SHUTDOWN_TIMEOUT_MS,
      'manifest.execution.shutdownTimeoutMs',
      MAX_PLUGIN_TIMEOUT_MS,
      issues,
    ),
    maxMessageBytes: boundedInteger(
      value.maxMessageBytes,
      DEFAULT_EXTERNAL_MAX_MESSAGE_BYTES,
      'manifest.execution.maxMessageBytes',
      MAX_EXTERNAL_MESSAGE_BYTES,
      issues,
    ),
  };
}

function validateRiskFloor(
  risk: PluginRisk,
  kind: PluginKind,
  permissions: readonly PluginPermission[],
  issues: PluginValidationIssue[],
): void {
  let minimum: PluginRisk = kind === 'action' ? 'medium' : 'read-only';
  for (const permission of permissions) {
    const required = PERMISSION_RISK[permission];
    if (RISK_ORDER[required] > RISK_ORDER[minimum]) minimum = required;
  }
  if (RISK_ORDER[risk] < RISK_ORDER[minimum]) {
    issue(
      issues,
      'manifest.risk',
      'risk_underdeclared',
      `must be at least ${minimum} for the declared kind and permissions`,
    );
  }
}

export function validatePluginManifest(
  input: unknown,
): PluginValidationResult<PluginManifest> {
  const issues: PluginValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [
        {
          path: 'manifest',
          code: 'required_object',
          message: 'must be an object',
        },
      ],
    };
  }

  if (input.manifestVersion !== PLUGIN_MANIFEST_VERSION) {
    issue(
      issues,
      'manifest.manifestVersion',
      'unsupported_manifest_version',
      `must equal ${PLUGIN_MANIFEST_VERSION}`,
    );
  }
  if (input.apiVersion !== PLUGIN_API_VERSION) {
    issue(
      issues,
      'manifest.apiVersion',
      'unsupported_api_version',
      `must equal ${PLUGIN_API_VERSION}`,
    );
  }

  const id = requiredString(input, 'id', 'manifest', issues);
  if (
    id &&
    (id.length > 128 ||
      !PLUGIN_ID_PATTERN.test(id) ||
      id.includes('..') ||
      id.includes('//'))
  ) {
    issue(
      issues,
      'manifest.id',
      'invalid_plugin_id',
      'must be a lowercase package-like identifier without empty path segments',
    );
  }
  const displayName = requiredString(input, 'displayName', 'manifest', issues);
  const version = requiredString(input, 'version', 'manifest', issues);
  if (version && !SEMVER_PATTERN.test(version)) {
    issue(
      issues,
      'manifest.version',
      'invalid_semver',
      'must be a semantic version such as 1.2.3',
    );
  }
  const description = optionalString(input, 'description', 'manifest', issues);

  const kindValue = input.kind;
  if (!(PLUGIN_KINDS as readonly unknown[]).includes(kindValue)) {
    issue(
      issues,
      'manifest.kind',
      'invalid_kind',
      `must be one of ${PLUGIN_KINDS.join(', ')}`,
    );
  }
  const kind: PluginKind = (PLUGIN_KINDS as readonly unknown[]).includes(
    kindValue,
  )
    ? (kindValue as PluginKind)
    : 'analyzer';
  const capabilities = parseCapabilities(input.capabilities, issues);
  const permissions = parsePermissions(input.permissions, issues);
  const risk = parseRisk(input.risk, issues);

  if (!isRecord(input.execution)) {
    issue(
      issues,
      'manifest.execution',
      'required_object',
      'must describe plugin isolation',
    );
  }
  const executionRecord = isRecord(input.execution) ? input.execution : {};
  let execution: InProcessPluginExecution | ExternalProcessPluginExecution;
  if (executionRecord.mode === 'in-process') {
    execution = parseInProcessExecution(executionRecord, issues);
    if (kind !== 'analyzer' && kind !== 'reporter') {
      issue(
        issues,
        'manifest.execution.mode',
        'in_process_kind_forbidden',
        'only trusted analyzer and reporter plugins may run in-process',
      );
    }
    if (permissions.includes('device:control')) {
      issue(
        issues,
        'manifest.permissions',
        'in_process_device_control_forbidden',
        'in-process plugins may not request device:control',
      );
    }
  } else if (executionRecord.mode === 'external-process') {
    execution = parseExternalExecution(executionRecord, issues);
    if (kind !== 'provider' && kind !== 'action') {
      issue(
        issues,
        'manifest.execution.mode',
        'external_kind_unsupported',
        'external-process plugins are limited to provider and action in API v1',
      );
    }
  } else {
    issue(
      issues,
      'manifest.execution.mode',
      'invalid_execution_mode',
      'must be in-process or external-process',
    );
    execution = parseInProcessExecution({}, issues);
  }

  validateRiskFloor(risk, kind, permissions, issues);
  if (issues.length > 0) return { success: false, issues };

  const base = {
    manifestVersion: PLUGIN_MANIFEST_VERSION,
    apiVersion: PLUGIN_API_VERSION,
    id: id ?? '',
    displayName: displayName ?? '',
    version: version ?? '',
    ...(description === undefined ? {} : { description }),
    capabilities,
    permissions,
    risk,
  };
  if (kind === 'analyzer' && execution.mode === 'in-process') {
    return { success: true, value: { ...base, kind, execution } };
  }
  if (kind === 'reporter' && execution.mode === 'in-process') {
    return { success: true, value: { ...base, kind, execution } };
  }
  if (kind === 'provider' && execution.mode === 'external-process') {
    return { success: true, value: { ...base, kind, execution } };
  }
  if (kind === 'action' && execution.mode === 'external-process') {
    return { success: true, value: { ...base, kind, execution } };
  }

  return {
    success: false,
    issues: [
      {
        path: 'manifest',
        code: 'invalid_manifest_combination',
        message: 'kind and execution mode are not compatible',
      },
    ],
  };
}

export function parsePluginManifest(input: unknown): PluginManifest {
  const result = validatePluginManifest(input);
  if (!result.success) throw new PluginManifestError(result.issues);
  return result.value;
}

export function parseInProcessPluginManifest(
  input: unknown,
): InProcessPluginManifest {
  const manifest = parsePluginManifest(input);
  if (manifest.kind !== 'analyzer' && manifest.kind !== 'reporter') {
    throw new PluginManifestError([
      {
        path: 'manifest.execution.mode',
        code: 'in_process_required',
        message: 'must be in-process',
      },
    ]);
  }
  return manifest;
}

export function parseExternalPluginManifest(
  input: unknown,
): ExternalPluginManifest {
  const manifest = parsePluginManifest(input);
  if (manifest.kind !== 'provider' && manifest.kind !== 'action') {
    throw new PluginManifestError([
      {
        path: 'manifest.execution.mode',
        code: 'external_process_required',
        message: 'must be external-process',
      },
    ]);
  }
  return manifest;
}
