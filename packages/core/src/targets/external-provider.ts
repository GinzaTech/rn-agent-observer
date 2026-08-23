import { randomUUID } from 'node:crypto';
import {
  EvidenceEnvelopeSchema,
  type EvidenceEnvelope,
  type TargetFingerprint,
} from '@rn-agent-observer/schemas';
import type {
  ExternalPluginDescriptor,
  ExternalPluginHost,
  ExternalPluginRequestOptions,
} from '../plugins/index.js';

export const TARGET_PROVIDER_PROTOCOL =
  'rn-agent-observer-target-provider-v1' as const;
export const TARGET_PROVIDER_SCHEMA_VERSION = '1.0' as const;

export const TARGET_PROVIDER_OPERATIONS = [
  'device-list',
  'device-info',
  'app-state',
  'screenshot',
  'ui-tree',
  'logs',
  'performance',
  'device-network',
] as const;

export const TARGET_PLATFORMS = ['android', 'ios', 'web', 'windows'] as const;

export type TargetProviderOperation =
  (typeof TARGET_PROVIDER_OPERATIONS)[number];
export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

export interface TargetProviderSelector {
  readonly platform: TargetPlatform;
  readonly deviceId?: string;
  readonly appId?: string;
}

export interface TargetProviderLimits {
  readonly maxEvidence: number;
  readonly maxPayloadBytes: number;
}

export interface TargetProviderRequest {
  readonly protocol: typeof TARGET_PROVIDER_PROTOCOL;
  readonly schemaVersion: typeof TARGET_PROVIDER_SCHEMA_VERSION;
  readonly requestId: string;
  readonly operation: TargetProviderOperation;
  readonly target: TargetProviderSelector;
  readonly limits: TargetProviderLimits;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface TargetProviderResponse {
  readonly protocol: typeof TARGET_PROVIDER_PROTOCOL;
  readonly schemaVersion: typeof TARGET_PROVIDER_SCHEMA_VERSION;
  readonly requestId: string;
  readonly operation: TargetProviderOperation;
  readonly status: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE';
  readonly evidence: readonly EvidenceEnvelope[];
  readonly limitations: readonly string[];
}

export interface CreateTargetProviderRequestOptions {
  readonly requestId?: string;
  readonly operation: TargetProviderOperation;
  readonly target: TargetProviderSelector;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly maxEvidence?: number;
  readonly maxPayloadBytes?: number;
}

export interface TargetProviderTransport {
  readonly descriptor: ExternalPluginDescriptor;
  collect(
    params: unknown,
    options?: ExternalPluginRequestOptions,
  ): Promise<unknown>;
}

export interface TargetProviderSupportEntry {
  readonly platform: TargetPlatform;
  readonly status: 'built-in' | 'extension-available' | 'not-configured';
  readonly operations: Readonly<
    Partial<Record<TargetProviderOperation, readonly string[]>>
  >;
  readonly limitations: readonly string[];
}

export interface TargetProviderSupportMatrix {
  readonly schemaVersion: '1.0';
  readonly platforms: readonly TargetProviderSupportEntry[];
}

const DEFAULT_MAX_EVIDENCE = 25;
const MAX_EVIDENCE = 100;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_LIMITATIONS = 100;
const MAX_LIMITATION_LENGTH = 2_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertExactKeys = (
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void => {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`${path} contains unknown keys: ${unknown.join(', ')}`);
  }
};

const boundedInteger = (
  value: number,
  name: string,
  maximum: number,
): number => {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
};

const nonEmpty = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.includes('\0') || normalized.includes('\n')) {
    throw new TypeError(`${name} must be a safe non-empty string`);
  }
  return normalized;
};

const jsonBytes = (value: unknown, name: string): number => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(
      `${name} must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (serialized === undefined) {
    throw new TypeError(`${name} must be JSON serializable`);
  }
  return Buffer.byteLength(serialized, 'utf8');
};

const assertNoInlineBinary = (
  value: unknown,
  path = 'evidence.payload',
  seen = new Set<object>(),
): void => {
  if (typeof value === 'string') {
    if (/^data:[^;,]+;base64,/iu.test(value)) {
      throw new TypeError(
        `${path} must reference binary artifacts, not inline base64`,
      );
    }
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoInlineBinary(entry, `${path}[${index}]`, seen),
    );
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (/^(?:base64|binary|blob)$/iu.test(key)) {
        throw new TypeError(
          `${path}.${key} is not allowed; write binary data as an artifact`,
        );
      }
      assertNoInlineBinary(entry, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
};

const targetMatches = (
  selector: TargetProviderSelector,
  target: TargetFingerprint,
): boolean =>
  target.platform === selector.platform &&
  (selector.deviceId === undefined || target.deviceId === selector.deviceId) &&
  (selector.appId === undefined || target.appId === selector.appId);

const providerCapability = (
  platform: TargetPlatform,
  operation: TargetProviderOperation,
): string => `target.${platform}.${operation}`;

export function createTargetProviderRequest(
  options: CreateTargetProviderRequestOptions,
): TargetProviderRequest {
  if (!TARGET_PROVIDER_OPERATIONS.includes(options.operation)) {
    throw new TypeError(
      `Unsupported target provider operation: ${options.operation}`,
    );
  }
  if (!TARGET_PLATFORMS.includes(options.target.platform)) {
    throw new TypeError(
      `Unsupported target platform: ${options.target.platform}`,
    );
  }
  const requestId = options.requestId ?? randomUUID();
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new TypeError('requestId has an invalid format');
  }
  const target: TargetProviderSelector = {
    platform: options.target.platform,
    ...(options.target.deviceId
      ? { deviceId: nonEmpty(options.target.deviceId, 'target.deviceId') }
      : {}),
    ...(options.target.appId
      ? { appId: nonEmpty(options.target.appId, 'target.appId') }
      : {}),
  };
  const parameters = options.parameters ?? {};
  if (!isRecord(parameters))
    throw new TypeError('parameters must be an object');
  assertNoInlineBinary(parameters, 'parameters');
  const request: TargetProviderRequest = {
    protocol: TARGET_PROVIDER_PROTOCOL,
    schemaVersion: TARGET_PROVIDER_SCHEMA_VERSION,
    requestId,
    operation: options.operation,
    target,
    limits: {
      maxEvidence: boundedInteger(
        options.maxEvidence ?? DEFAULT_MAX_EVIDENCE,
        'maxEvidence',
        MAX_EVIDENCE,
      ),
      maxPayloadBytes: boundedInteger(
        options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
        'maxPayloadBytes',
        MAX_PAYLOAD_BYTES,
      ),
    },
    parameters,
  };
  if (jsonBytes(request, 'provider request') > MAX_REQUEST_BYTES) {
    throw new RangeError(
      `Provider request exceeds the ${MAX_REQUEST_BYTES}-byte host contract limit`,
    );
  }
  return request;
}

export function parseTargetProviderResponse(
  input: unknown,
  request: TargetProviderRequest,
  descriptor: ExternalPluginDescriptor,
): TargetProviderResponse {
  if (descriptor.manifest.kind !== 'provider') {
    throw new TypeError(`${descriptor.manifest.id} is not a provider plugin`);
  }
  if (!isRecord(input))
    throw new TypeError('provider response must be an object');
  assertExactKeys(
    input,
    [
      'protocol',
      'schemaVersion',
      'requestId',
      'operation',
      'status',
      'evidence',
      'limitations',
    ],
    'provider response',
  );
  if (
    input.protocol !== TARGET_PROVIDER_PROTOCOL ||
    input.schemaVersion !== TARGET_PROVIDER_SCHEMA_VERSION ||
    input.requestId !== request.requestId ||
    input.operation !== request.operation
  ) {
    throw new TypeError(
      'provider response protocol, schema, requestId, and operation must match the request',
    );
  }
  if (
    !['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'].includes(String(input.status))
  ) {
    throw new TypeError('provider response status is invalid');
  }
  if (!Array.isArray(input.evidence)) {
    throw new TypeError('provider response evidence must be an array');
  }
  if (input.evidence.length > request.limits.maxEvidence) {
    throw new RangeError(
      `provider response exceeds maxEvidence=${request.limits.maxEvidence}`,
    );
  }
  if (
    !Array.isArray(input.limitations) ||
    input.limitations.length > MAX_LIMITATIONS ||
    input.limitations.some(
      (entry) =>
        typeof entry !== 'string' ||
        entry.trim().length === 0 ||
        entry.length > MAX_LIMITATION_LENGTH,
    )
  ) {
    throw new TypeError(
      'provider response limitations are invalid or unbounded',
    );
  }
  const evidence = input.evidence.map((entry, index) => {
    const parsed = EvidenceEnvelopeSchema.parse(entry);
    if (
      parsed.provider.id !== descriptor.manifest.id ||
      parsed.provider.version !== descriptor.manifest.version
    ) {
      throw new TypeError(
        `evidence[${index}] provider identity does not match the plugin manifest`,
      );
    }
    if (!targetMatches(request.target, parsed.target)) {
      throw new TypeError(
        `evidence[${index}] target does not match the request`,
      );
    }
    assertNoInlineBinary(parsed.payload, `evidence[${index}].payload`);
    return parsed;
  });
  const payloadBytes = evidence.reduce(
    (total, envelope) =>
      total + jsonBytes(envelope.payload, 'provider evidence payload'),
    0,
  );
  if (payloadBytes > request.limits.maxPayloadBytes) {
    throw new RangeError(
      `provider evidence payloads total ${payloadBytes} bytes; limit is ${request.limits.maxPayloadBytes}`,
    );
  }
  const status = input.status as TargetProviderResponse['status'];
  const available = evidence.some(
    (envelope) => envelope.availability.status === 'AVAILABLE',
  );
  if (status === 'AVAILABLE' && !available) {
    throw new TypeError(
      'AVAILABLE requires at least one AVAILABLE evidence envelope',
    );
  }
  if (status === 'UNAVAILABLE' && available) {
    throw new TypeError('UNAVAILABLE cannot contain AVAILABLE evidence');
  }
  const limitations = (input.limitations as string[]).map((entry) =>
    entry.trim(),
  );
  if (status !== 'AVAILABLE' && limitations.length === 0) {
    throw new TypeError(`${status} requires a non-empty limitation`);
  }
  return {
    protocol: TARGET_PROVIDER_PROTOCOL,
    schemaVersion: TARGET_PROVIDER_SCHEMA_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    status,
    evidence,
    limitations,
  };
}

export class ExternalTargetProviderClient {
  constructor(readonly transport: TargetProviderTransport) {
    if (transport.descriptor.manifest.kind !== 'provider') {
      throw new TypeError(
        `${transport.descriptor.manifest.id} is not a provider plugin`,
      );
    }
  }

  get descriptor(): ExternalPluginDescriptor {
    return this.transport.descriptor;
  }

  supports(
    platform: TargetPlatform,
    operation: TargetProviderOperation,
  ): boolean {
    return this.descriptor.manifest.capabilities.provides.includes(
      providerCapability(platform, operation),
    );
  }

  async collect(
    options: CreateTargetProviderRequestOptions,
    requestOptions: ExternalPluginRequestOptions = {},
  ): Promise<TargetProviderResponse> {
    if (!this.supports(options.target.platform, options.operation)) {
      throw new TypeError(
        `${this.descriptor.manifest.id} does not provide ${providerCapability(options.target.platform, options.operation)}`,
      );
    }
    const request = createTargetProviderRequest(options);
    const raw = await this.transport.collect(request, requestOptions);
    return parseTargetProviderResponse(raw, request, this.descriptor);
  }
}

export class ExternalTargetProviderRegistry {
  private readonly providers = new Map<string, ExternalTargetProviderClient>();

  register(provider: ExternalTargetProviderClient): void {
    const id = provider.descriptor.manifest.id;
    if (this.providers.has(id)) {
      throw new TypeError(`Target provider ${id} is already registered`);
    }
    this.providers.set(id, provider);
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  list(): readonly ExternalTargetProviderClient[] {
    return [...this.providers.values()].sort((left, right) =>
      left.descriptor.manifest.id.localeCompare(right.descriptor.manifest.id),
    );
  }

  resolve(
    platform: TargetPlatform,
    operation: TargetProviderOperation,
    providerId?: string,
  ): ExternalTargetProviderClient {
    const candidates = this.list().filter((provider) =>
      provider.supports(platform, operation),
    );
    if (providerId) {
      const selected = candidates.find(
        (candidate) => candidate.descriptor.manifest.id === providerId,
      );
      if (!selected) {
        throw new TypeError(
          `Target provider ${providerId} does not provide ${providerCapability(platform, operation)}`,
        );
      }
      return selected;
    }
    if (candidates.length === 0) {
      throw new TypeError(
        `No external target provider supplies ${providerCapability(platform, operation)}`,
      );
    }
    if (candidates.length > 1) {
      throw new TypeError(
        `Multiple target providers supply ${providerCapability(platform, operation)}; select providerId explicitly`,
      );
    }
    return candidates[0] as ExternalTargetProviderClient;
  }
}

const ANDROID_BUILT_IN_OPERATIONS: readonly TargetProviderOperation[] = [
  ...TARGET_PROVIDER_OPERATIONS,
];

export function targetProviderSupportMatrix(
  providers: readonly ExternalTargetProviderClient[] = [],
): TargetProviderSupportMatrix {
  const platforms = TARGET_PLATFORMS.map(
    (platform): TargetProviderSupportEntry => {
      const operations: Partial<
        Record<TargetProviderOperation, readonly string[]>
      > = {};
      for (const operation of TARGET_PROVIDER_OPERATIONS) {
        const ids = providers
          .filter((provider) => provider.supports(platform, operation))
          .map((provider) => provider.descriptor.manifest.id)
          .sort();
        if (
          platform === 'android' &&
          ANDROID_BUILT_IN_OPERATIONS.includes(operation)
        ) {
          ids.unshift('builtin.android-adb');
        }
        if (ids.length > 0) operations[operation] = ids;
      }
      const external = Object.values(operations).some((ids) =>
        ids?.some((id) => id !== 'builtin.android-adb'),
      );
      return {
        platform,
        status:
          platform === 'android'
            ? 'built-in'
            : external
              ? 'extension-available'
              : 'not-configured',
        operations,
        limitations:
          platform === 'android'
            ? [
                'Built-in Android operations still require a ready, authorized ADB target.',
              ]
            : external
              ? [
                  'Support is supplied by an isolated external provider and is available only after its handshake and evidence validation succeed.',
                ]
              : [
                  `${platform} runtime collection is not built in; install and explicitly grant an external provider.`,
                ],
      };
    },
  );
  return { schemaVersion: '1.0', platforms };
}

export type ExternalTargetProviderHost = Pick<
  ExternalPluginHost,
  'descriptor' | 'collect'
>;
