import {
  MAX_PLUGIN_TIMEOUT_MS,
  PluginManifestError,
  type ExternalPluginManifest,
  type InProcessPluginManifest,
  type PluginManifest,
  type PluginPermission,
  type PluginValidationIssue,
} from './manifest.js';
import {
  createExternalPluginDescriptor,
  parseAnalyzerResult,
  parseInProcessExtension,
  parseReporterResult,
} from './conformance.js';
import type {
  AnalyzerExtension,
  AnalyzerRequest,
  AnalyzerResult,
  ExternalPluginDescriptor,
  InProcessExtension,
  PluginHostContext,
  PluginInvocationContext,
  PluginLifecyclePhase,
  PluginLogger,
  ReporterExtension,
  ReporterRequest,
  ReporterResult,
} from './types.js';

export const PLUGIN_ISOLATION_CONTRACT = Object.freeze({
  inProcess:
    'Only explicitly trusted analyzer and reporter extensions run in-process. Timeouts are cooperative and cannot terminate synchronous code.',
  externalProcess:
    'Provider and action plugins remain descriptors in this registry and must execute through ExternalPluginHost isolation with shell:false, allowlisted environment, message limits and process-tree termination.',
});

export type PluginRegistryState =
  'registered' | 'initializing' | 'ready' | 'failed' | 'disposed' | 'external';

export interface RegisteredPluginInfo {
  readonly manifest: PluginManifest;
  readonly state: PluginRegistryState;
  readonly isolation: 'trusted-in-process' | 'external-process';
  readonly methods?: ExternalPluginDescriptor['methods'];
}

export interface PluginInvocationOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export class PluginRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly pluginId?: string,
  ) {
    super(message);
    this.name = 'PluginRegistryError';
  }
}

export class PluginTimeoutError extends PluginRegistryError {
  constructor(
    pluginId: string,
    readonly phase: PluginLifecyclePhase,
    readonly timeoutMs: number,
  ) {
    super(
      'PLUGIN_TIMEOUT',
      `Plugin ${pluginId} timed out during ${phase} after ${timeoutMs}ms`,
      pluginId,
    );
    this.name = 'PluginTimeoutError';
  }
}

export class PluginAbortedError extends PluginRegistryError {
  constructor(
    pluginId: string,
    readonly phase: PluginLifecyclePhase,
  ) {
    super(
      'PLUGIN_ABORTED',
      `Plugin ${pluginId} was aborted during ${phase}`,
      pluginId,
    );
    this.name = 'PluginAbortedError';
  }
}

interface RegistryEntry {
  readonly extension: InProcessExtension;
  readonly manifest: InProcessPluginManifest;
  state: Exclude<PluginRegistryState, 'external'>;
  initialization: Promise<void> | undefined;
  failure: unknown;
}

const NOOP_LOGGER: PluginLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function validateTimeout(timeoutMs: number): void {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_PLUGIN_TIMEOUT_MS
  ) {
    throw new RangeError(
      `Plugin timeout must be an integer between 1 and ${MAX_PLUGIN_TIMEOUT_MS}`,
    );
  }
}

export async function runWithPluginTimeout<T>(input: {
  readonly pluginId: string;
  readonly phase: PluginLifecyclePhase;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly operation: (signal: AbortSignal) => Promise<T> | T;
}): Promise<T> {
  validateTimeout(input.timeoutMs);
  if (input.signal?.aborted) {
    throw new PluginAbortedError(input.pluginId, input.phase);
  }

  const controller = new AbortController();
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = (): void => {
      const error = new PluginAbortedError(input.pluginId, input.phase);
      controller.abort(error);
      finish(() => reject(error));
    };
    const timer = setTimeout(() => {
      const error = new PluginTimeoutError(
        input.pluginId,
        input.phase,
        input.timeoutMs,
      );
      controller.abort(error);
      finish(() => reject(error));
    }, input.timeoutMs);
    input.signal?.addEventListener('abort', onAbort, { once: true });

    Promise.resolve()
      .then(() => input.operation(controller.signal))
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

function accessIssues(
  manifest: InProcessPluginManifest,
  host: PluginHostContext,
): PluginValidationIssue[] {
  const issues: PluginValidationIssue[] = [];
  const capabilities = new Set(host.capabilities);
  const grants = new Set<PluginPermission>(host.grantedPermissions);
  for (const capability of manifest.capabilities.requires) {
    if (!capabilities.has(capability)) {
      issues.push({
        path: 'manifest.capabilities.requires',
        code: 'capability_unavailable',
        message: `host does not provide ${capability}`,
      });
    }
  }
  for (const permission of manifest.permissions) {
    if (!grants.has(permission)) {
      issues.push({
        path: 'manifest.permissions',
        code: 'permission_not_granted',
        message: `host did not grant ${permission}`,
      });
    }
  }
  return issues;
}

function assertHostContext(host: PluginHostContext): void {
  if (host.projectRoot.trim().length === 0) {
    throw new PluginRegistryError(
      'PLUGIN_HOST_INVALID',
      'Plugin host projectRoot must be non-empty',
    );
  }
  if (host.artifactRoot.trim().length === 0) {
    throw new PluginRegistryError(
      'PLUGIN_HOST_INVALID',
      'Plugin host artifactRoot must be non-empty',
    );
  }
}

export class PluginRegistry {
  private readonly inProcess = new Map<string, RegistryEntry>();
  private readonly external = new Map<string, ExternalPluginDescriptor>();
  private invocationCounter = 0;
  private readonly host: PluginHostContext;
  private readonly logger: PluginLogger;

  constructor(host: PluginHostContext) {
    assertHostContext(host);
    this.logger = host.logger ?? NOOP_LOGGER;
    this.host = {
      projectRoot: host.projectRoot,
      artifactRoot: host.artifactRoot,
      capabilities: [...host.capabilities],
      grantedPermissions: [...host.grantedPermissions],
      logger: this.logger,
    };
  }

  register(extensionInput: unknown): InProcessPluginManifest {
    const extension = parseInProcessExtension(extensionInput);
    this.assertUnique(extension.manifest.id);
    const entry: RegistryEntry = {
      extension,
      manifest: extension.manifest,
      state: 'registered',
      initialization: undefined,
      failure: undefined,
    };
    this.inProcess.set(extension.manifest.id, entry);
    return extension.manifest;
  }

  registerExternal(manifestInput: unknown): ExternalPluginDescriptor {
    const descriptor = createExternalPluginDescriptor(manifestInput);
    this.assertUnique(descriptor.manifest.id);
    this.external.set(descriptor.manifest.id, descriptor);
    return descriptor;
  }

  list(): RegisteredPluginInfo[] {
    return [
      ...[...this.inProcess.values()].map((entry) => ({
        manifest: entry.manifest,
        state: entry.state,
        isolation: 'trusted-in-process' as const,
      })),
      ...[...this.external.values()].map((descriptor) => ({
        manifest: descriptor.manifest,
        state: 'external' as const,
        isolation: 'external-process' as const,
        methods: descriptor.methods,
      })),
    ];
  }

  getExternal(pluginId: string): ExternalPluginDescriptor | undefined {
    return this.external.get(pluginId);
  }

  async initialize(
    pluginId: string,
    options: PluginInvocationOptions = {},
  ): Promise<void> {
    const entry = this.requireInProcess(pluginId);
    await this.ensureReady(entry, options);
  }

  async initializeAll(options: PluginInvocationOptions = {}): Promise<void> {
    for (const entry of this.inProcess.values()) {
      await this.ensureReady(entry, options);
    }
  }

  async analyze(
    pluginId: string,
    request: AnalyzerRequest,
    options: PluginInvocationOptions = {},
  ): Promise<AnalyzerResult> {
    const entry = this.requireInProcess(pluginId);
    if (entry.manifest.kind !== 'analyzer') {
      throw new PluginRegistryError(
        'PLUGIN_KIND_MISMATCH',
        `Plugin ${pluginId} is not an analyzer`,
        pluginId,
      );
    }
    await this.ensureReady(entry, options);
    const extension = entry.extension as AnalyzerExtension;
    const result = await this.invoke(entry, 'analyze', options, (context) =>
      extension.analyze(request, context),
    );
    return parseAnalyzerResult(result);
  }

  async report(
    pluginId: string,
    request: ReporterRequest,
    options: PluginInvocationOptions = {},
  ): Promise<ReporterResult> {
    const entry = this.requireInProcess(pluginId);
    if (entry.manifest.kind !== 'reporter') {
      throw new PluginRegistryError(
        'PLUGIN_KIND_MISMATCH',
        `Plugin ${pluginId} is not a reporter`,
        pluginId,
      );
    }
    await this.ensureReady(entry, options);
    const extension = entry.extension as ReporterExtension;
    const result = await this.invoke(entry, 'report', options, (context) =>
      extension.report(request, context),
    );
    return parseReporterResult(result);
  }

  async disposeAll(options: PluginInvocationOptions = {}): Promise<void> {
    const errors: unknown[] = [];
    const entries = [...this.inProcess.values()].reverse();
    for (const entry of entries) {
      if (entry.state === 'disposed' || entry.state === 'registered') {
        entry.state = 'disposed';
        continue;
      }
      if (entry.initialization) {
        try {
          await entry.initialization;
        } catch {
          // A partially initialized trusted plugin still gets dispose().
        }
      }
      try {
        if (entry.extension.dispose) {
          await this.invoke(entry, 'dispose', options, (context) =>
            entry.extension.dispose?.(context),
          );
        }
      } catch (error) {
        errors.push(error);
      } finally {
        entry.state = 'disposed';
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more plugins failed to dispose');
    }
  }

  private assertUnique(pluginId: string): void {
    if (this.inProcess.has(pluginId) || this.external.has(pluginId)) {
      throw new PluginRegistryError(
        'PLUGIN_DUPLICATE',
        `Plugin ${pluginId} is already registered`,
        pluginId,
      );
    }
  }

  private requireInProcess(pluginId: string): RegistryEntry {
    const entry = this.inProcess.get(pluginId);
    if (entry) return entry;
    if (this.external.has(pluginId)) {
      throw new PluginRegistryError(
        'PLUGIN_EXTERNAL_ONLY',
        `Plugin ${pluginId} is an external descriptor and cannot run in-process`,
        pluginId,
      );
    }
    throw new PluginRegistryError(
      'PLUGIN_NOT_FOUND',
      `Plugin ${pluginId} is not registered`,
      pluginId,
    );
  }

  private async ensureReady(
    entry: RegistryEntry,
    options: PluginInvocationOptions,
  ): Promise<void> {
    if (entry.state === 'ready') return;
    if (entry.state === 'disposed') {
      throw new PluginRegistryError(
        'PLUGIN_DISPOSED',
        `Plugin ${entry.manifest.id} has been disposed`,
        entry.manifest.id,
      );
    }
    if (entry.state === 'failed') {
      throw entry.failure instanceof Error
        ? entry.failure
        : new PluginRegistryError(
            'PLUGIN_INITIALIZATION_FAILED',
            `Plugin ${entry.manifest.id} failed to initialize`,
            entry.manifest.id,
          );
    }
    if (entry.initialization) return await entry.initialization;

    const access = accessIssues(entry.manifest, this.host);
    if (access.length > 0) {
      const error = new PluginManifestError(access);
      entry.state = 'failed';
      entry.failure = error;
      throw error;
    }
    entry.state = 'initializing';
    entry.initialization = (async () => {
      try {
        if (entry.extension.initialize) {
          await this.invoke(entry, 'initialize', options, (context) =>
            entry.extension.initialize?.(context),
          );
        }
        entry.state = 'ready';
      } catch (error) {
        entry.state = 'failed';
        entry.failure = error;
        throw error;
      }
    })();
    return await entry.initialization;
  }

  private async invoke<T>(
    entry: RegistryEntry,
    phase: PluginLifecyclePhase,
    options: PluginInvocationOptions,
    operation: (context: PluginInvocationContext) => Promise<T> | T,
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? entry.manifest.execution.timeoutMs;
    validateTimeout(timeoutMs);
    this.invocationCounter += 1;
    const invocationId = `${entry.manifest.id}:${phase}:${this.invocationCounter}`;
    return await runWithPluginTimeout({
      pluginId: entry.manifest.id,
      phase,
      timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      operation: async (signal) =>
        await operation({
          pluginId: entry.manifest.id,
          invocationId,
          phase,
          signal,
          host: this.host,
          logger: this.logger,
        }),
    });
  }
}

/** Type-only helper for hosts that store external descriptors separately. */
export function externalManifestOf(
  descriptor: ExternalPluginDescriptor,
): ExternalPluginManifest {
  return descriptor.manifest;
}
