import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  EXTERNAL_PLUGIN_PROTOCOL,
  MAX_PLUGIN_TIMEOUT_MS,
  type ExternalPluginManifest,
  type PluginPermission,
} from './manifest.js';
import { createExternalPluginDescriptor } from './conformance.js';
import {
  EXTERNAL_PLUGIN_METHODS,
  type ExternalPluginDescriptor,
  type ExternalPluginMethod,
  type ExternalPluginRpcRequest,
} from './types.js';

const DEFAULT_STDERR_MAX_BYTES = 64 * 1024;
const MAX_STDERR_MAX_BYTES = 1024 * 1024;
const PROCESS_EXIT_GRACE_MS = 250;
const WINDOWS_TASKKILL_TIMEOUT_MS = 1_000;

export type ExternalPluginHostState =
  'idle' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';

export interface ExternalPluginHostOptions {
  /** Root that contains cwd after resolving symlinks. */
  readonly projectRoot: string;
  /** Absolute, or relative to projectRoot. Defaults to projectRoot. */
  readonly cwd?: string;
  /** Explicit caller-owned environment source; process.env is never implicit. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly capabilities: readonly string[];
  readonly grantedPermissions: readonly PluginPermission[];
  readonly stderrMaxBytes?: number;
}

export interface ExternalPluginRequestOptions {
  /** May shorten but never extend the manifest request timeout. */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ExternalPluginHandshake {
  readonly protocol: typeof EXTERNAL_PLUGIN_PROTOCOL;
  readonly pluginId: string;
  readonly kind: ExternalPluginManifest['kind'];
  readonly apiVersion: 1;
  readonly pid: number;
  readonly capabilities: {
    readonly provides: readonly string[];
    readonly requires: readonly string[];
  };
}

export interface ExternalPluginStderrSnapshot {
  readonly text: string;
  readonly bytesSeen: number;
  readonly truncated: boolean;
}

export class ExternalPluginHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly pluginId: string,
    readonly stderr?: ExternalPluginStderrSnapshot,
  ) {
    super(message);
    this.name = 'ExternalPluginHostError';
  }
}

export class ExternalPluginRpcError extends ExternalPluginHostError {
  constructor(
    pluginId: string,
    readonly rpcCode: number,
    rpcMessage: string,
    stderr?: ExternalPluginStderrSnapshot,
  ) {
    super(
      'PLUGIN_RPC_ERROR',
      `Plugin ${pluginId} returned JSON-RPC error ${rpcCode}: ${redactExternalPluginStderr(rpcMessage)}`,
      pluginId,
      stderr,
    );
    this.name = 'ExternalPluginRpcError';
  }
}

interface PendingRequest {
  readonly id: number;
  readonly method: ExternalPluginMethod;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal | undefined;
  readonly abortHandler: (() => void) | undefined;
}

interface ProcessClose {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function normalizedStringArray(
  value: unknown,
  field: string,
  pluginId: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new ExternalPluginHostError(
      'PLUGIN_HANDSHAKE_INVALID',
      `${field} must be an array`,
      pluginId,
    );
  }
  const seen = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new ExternalPluginHostError(
        'PLUGIN_HANDSHAKE_INVALID',
        `${field}[${index}] must be a non-empty string`,
        pluginId,
      );
    }
    const normalized = entry.trim();
    if (seen.has(normalized)) {
      throw new ExternalPluginHostError(
        'PLUGIN_HANDSHAKE_INVALID',
        `${field} contains duplicate ${normalized}`,
        pluginId,
      );
    }
    seen.add(normalized);
    return normalized;
  });
}

function sameStringSet(
  first: readonly string[],
  second: readonly string[],
): boolean {
  if (first.length !== second.length) return false;
  const expected = new Set(first);
  return second.every((entry) => expected.has(entry));
}

function validatePositiveInteger(
  value: number,
  name: string,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
}

export function resolveContainedPluginCwd(
  projectRoot: string,
  cwd?: string,
): string {
  if (projectRoot.trim().length === 0) {
    throw new ExternalPluginHostError(
      'PLUGIN_CWD_INVALID',
      'projectRoot must be non-empty',
      'unknown',
    );
  }
  let root: string;
  let candidate: string;
  try {
    root = realpathSync.native(resolve(projectRoot));
    candidate = realpathSync.native(
      cwd === undefined
        ? root
        : isAbsolute(cwd)
          ? resolve(cwd)
          : resolve(root, cwd),
    );
  } catch {
    throw new ExternalPluginHostError(
      'PLUGIN_CWD_INVALID',
      'projectRoot and plugin cwd must already exist',
      'unknown',
    );
  }
  if (!statSync(candidate).isDirectory()) {
    throw new ExternalPluginHostError(
      'PLUGIN_CWD_INVALID',
      'plugin cwd must be a directory',
      'unknown',
    );
  }
  const fromRoot = relative(root, candidate);
  const outside =
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot);
  if (outside) {
    throw new ExternalPluginHostError(
      'PLUGIN_CWD_OUTSIDE_ROOT',
      'plugin cwd must stay within projectRoot after resolving symlinks',
      'unknown',
    );
  }
  return candidate;
}

export function forwardAllowlistedPluginEnvironment(
  allowlist: readonly string[],
  source: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  const sourceEntries = Object.entries(source);
  const forwardedNames = new Set<string>();
  for (const name of allowlist) {
    const comparisonName =
      process.platform === 'win32' ? name.toLowerCase() : name;
    if (forwardedNames.has(comparisonName)) continue;
    forwardedNames.add(comparisonName);
    const direct = source[name];
    const value =
      direct ??
      (process.platform === 'win32'
        ? sourceEntries.find(
            ([candidate]) => candidate.toLowerCase() === name.toLowerCase(),
          )?.[1]
        : undefined);
    if (value !== undefined) {
      if (typeof value !== 'string' || value.includes('\0')) {
        throw new TypeError(
          `Environment value for ${name} must be a NUL-free string`,
        );
      }
      result[name] = value;
    }
  }
  return result;
}

export function redactExternalPluginStderr(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_EMAIL]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu,
      '[REDACTED_JWT]',
    )
    .replace(/\bBearer\s+[^\s,;]+/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(token|access[_-]?token|api[_-]?key|authorization|cookie|password|passwd|secret)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '$1=[REDACTED]',
    )
    .replace(/\b[A-Za-z0-9_~+/-]{40,}={0,2}\b/gu, '[REDACTED_OPAQUE]');
}

function externalManifestInput(input: unknown): unknown {
  return isRecord(input) && 'manifest' in input ? input.manifest : input;
}

function assertExternalAccess(
  descriptor: ExternalPluginDescriptor,
  options: ExternalPluginHostOptions,
): void {
  const capabilities = new Set(options.capabilities);
  for (const required of descriptor.manifest.capabilities.requires) {
    if (!capabilities.has(required)) {
      throw new ExternalPluginHostError(
        'PLUGIN_CAPABILITY_UNAVAILABLE',
        `Host does not provide required capability ${required}`,
        descriptor.manifest.id,
      );
    }
  }
  const grants = new Set<PluginPermission>(options.grantedPermissions);
  for (const permission of descriptor.manifest.permissions) {
    if (!grants.has(permission)) {
      throw new ExternalPluginHostError(
        'PLUGIN_PERMISSION_DENIED',
        `Host did not grant declared permission ${permission}`,
        descriptor.manifest.id,
      );
    }
  }
}

async function waitForChildClose(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolveWait) => {
    let settled = false;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolveWait(closed);
    };
    const onClose = (): void => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('close', onClose);
  });
}

/**
 * `taskkill /T` without `/F` may close the direct child before Windows has
 * walked every descendant. Once that root is gone, a later `/T` has no tree to
 * traverse. Callers that must contain an unresponsive plugin therefore use
 * the forced, single-pass tree termination below.
 */
async function runWindowsTaskkill(
  pid: number,
  force: boolean,
): Promise<boolean> {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const command = systemRoot
    ? resolve(systemRoot, 'System32', 'taskkill.exe')
    : 'taskkill.exe';
  const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
  return await new Promise<boolean>((resolveKill) => {
    const killer = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    let settled = false;
    const finish = (succeeded: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killer.removeListener('error', onError);
      killer.removeListener('close', onClose);
      resolveKill(succeeded);
    };
    const onError = (): void => finish(false);
    const onClose = (code: number | null): void => finish(code === 0);
    const timer = setTimeout(() => {
      try {
        killer.kill();
      } catch {
        // taskkill exited between the timer and the kill attempt.
      }
      finish(false);
    }, WINDOWS_TASKKILL_TIMEOUT_MS);
    killer.once('error', onError);
    killer.once('close', onClose);
  });
}

function signalPosixProcessTree(
  child: ChildProcessWithoutNullStreams,
  pid: number,
  force: boolean,
): void {
  const signal: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM';
  try {
    process.kill(-pid, signal);
  } catch {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill(signal);
    } catch {
      // The process exited between the state check and signal delivery.
    }
  }
}

export async function terminateExternalPluginTree(
  child: ChildProcessWithoutNullStreams,
  graceMs = PROCESS_EXIT_GRACE_MS,
): Promise<void> {
  const pid = child.pid;
  if (
    pid === undefined ||
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  if (process.platform === 'win32') {
    // Normal disposal already gets the plugin's JSON-RPC shutdown window. For
    // a timeout/protocol failure, kill the *current* tree in one forced pass;
    // a soft taskkill can make the root disappear before its children are
    // enumerated, leaving an orphan behind.
    const terminatedTree = await runWindowsTaskkill(pid, true);
    if (
      !terminatedTree &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      try {
        child.kill('SIGKILL');
      } catch {
        // The process exited while taskkill was reporting its result.
      }
    }
    await waitForChildClose(child, Math.max(graceMs, PROCESS_EXIT_GRACE_MS));
    return;
  }

  // The plugin runs in its own POSIX process group. Always send the final
  // group-wide SIGKILL: a closed group leader is not proof that a descendant
  // handled SIGTERM, while the group can still exist without its leader.
  signalPosixProcessTree(child, pid, false);
  await waitForChildClose(child, graceMs);
  signalPosixProcessTree(child, pid, true);
  await waitForChildClose(child, Math.max(graceMs, PROCESS_EXIT_GRACE_MS));
}

export class ExternalPluginHost {
  readonly descriptor: ExternalPluginDescriptor;
  readonly cwd: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly hostCapabilities: readonly string[];
  private readonly stderrMaxBytes: number;
  private child: ChildProcessWithoutNullStreams | undefined;
  private pending = new Map<number, PendingRequest>();
  private stdoutBuffer = Buffer.alloc(0);
  private stderrBuffer = Buffer.alloc(0);
  private stderrBytesSeen = 0;
  private stderrTruncated = false;
  private requestCounter = 0;
  private startPromise: Promise<ExternalPluginHandshake> | undefined;
  private closePromise: Promise<ProcessClose> | undefined;
  private resolveClose: ((value: ProcessClose) => void) | undefined;
  private termination: Promise<void> | undefined;
  private handshake: ExternalPluginHandshake | undefined;
  private closed = false;
  private _state: ExternalPluginHostState = 'idle';

  constructor(
    descriptorOrManifest: ExternalPluginDescriptor | ExternalPluginManifest,
    options: ExternalPluginHostOptions,
  ) {
    this.descriptor = createExternalPluginDescriptor(
      externalManifestInput(descriptorOrManifest),
    );
    assertExternalAccess(this.descriptor, options);
    const stderrMaxBytes = options.stderrMaxBytes ?? DEFAULT_STDERR_MAX_BYTES;
    validatePositiveInteger(
      stderrMaxBytes,
      'stderrMaxBytes',
      MAX_STDERR_MAX_BYTES,
    );
    this.stderrMaxBytes = stderrMaxBytes;
    this.cwd = resolveContainedPluginCwd(options.projectRoot, options.cwd);
    this.environment = forwardAllowlistedPluginEnvironment(
      this.descriptor.manifest.execution.environmentAllowlist,
      options.environment ?? {},
    );
    this.hostCapabilities = [...options.capabilities];
  }

  get state(): ExternalPluginHostState {
    return this._state;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get stderr(): ExternalPluginStderrSnapshot {
    const text = redactExternalPluginStderr(this.stderrBuffer.toString('utf8'));
    return {
      text: this.stderrTruncated
        ? `[truncated to last ${this.stderrMaxBytes} bytes]\n${text}`
        : text,
      bytesSeen: this.stderrBytesSeen,
      truncated: this.stderrTruncated,
    };
  }

  async start(
    requestOptions: ExternalPluginRequestOptions = {},
  ): Promise<ExternalPluginHandshake> {
    if (this._state === 'ready' && this.handshake) return this.handshake;
    if (this.startPromise) return await this.startPromise;
    if (this._state !== 'idle') {
      throw this.error(
        'PLUGIN_HOST_STATE_INVALID',
        `Cannot start plugin from ${this._state} state`,
      );
    }
    this._state = 'starting';
    this.startPromise = this.startInternal(requestOptions);
    try {
      return await this.startPromise;
    } catch (error) {
      await this.fail(error);
      throw error;
    }
  }

  async collect(
    params: unknown,
    options: ExternalPluginRequestOptions = {},
  ): Promise<unknown> {
    if (this.descriptor.manifest.kind !== 'provider') {
      throw this.error(
        'PLUGIN_KIND_MISMATCH',
        `${this.descriptor.manifest.id} is not a provider`,
      );
    }
    await this.start(options);
    return await this.request(
      EXTERNAL_PLUGIN_METHODS.providerCollect,
      params,
      options,
    );
  }

  async executeAction(
    params: unknown,
    options: ExternalPluginRequestOptions = {},
  ): Promise<unknown> {
    if (this.descriptor.manifest.kind !== 'action') {
      throw this.error(
        'PLUGIN_KIND_MISMATCH',
        `${this.descriptor.manifest.id} is not an action plugin`,
      );
    }
    await this.start(options);
    return await this.request(
      EXTERNAL_PLUGIN_METHODS.actionExecute,
      params,
      options,
    );
  }

  async dispose(options: ExternalPluginRequestOptions = {}): Promise<void> {
    if (this._state === 'stopped') return;
    if (this._state === 'idle') {
      this._state = 'stopped';
      return;
    }
    if (this._state === 'failed') {
      await this.terminate();
      this._state = 'stopped';
      return;
    }
    if (this._state === 'starting' && this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        await this.terminate();
        this._state = 'stopped';
        return;
      }
    }
    if (this._state !== 'ready') {
      throw this.error(
        'PLUGIN_HOST_STATE_INVALID',
        `Cannot dispose plugin from ${this._state} state`,
      );
    }

    this._state = 'stopping';
    let disposeError: unknown;
    try {
      await this.request(
        EXTERNAL_PLUGIN_METHODS.dispose,
        {},
        {
          timeoutMs: Math.min(
            options.timeoutMs ??
              this.descriptor.manifest.execution.shutdownTimeoutMs,
            this.descriptor.manifest.execution.shutdownTimeoutMs,
          ),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
        true,
      );
    } catch (error) {
      disposeError = error;
    }

    this.child?.stdin.end();
    const closed = await this.waitForClose(
      this.descriptor.manifest.execution.shutdownTimeoutMs,
    );
    if (!closed) await this.terminate();
    this._state = 'stopped';
    if (disposeError !== undefined) throw disposeError;
  }

  private async startInternal(
    options: ExternalPluginRequestOptions,
  ): Promise<ExternalPluginHandshake> {
    await this.spawnProcess();
    const initialization = await this.request(
      EXTERNAL_PLUGIN_METHODS.initialize,
      {
        protocol: EXTERNAL_PLUGIN_PROTOCOL,
        host: {
          apiVersion: 1,
          capabilities: [...this.hostCapabilities],
          grantedPermissions: [...this.descriptor.manifest.permissions],
        },
        plugin: {
          id: this.descriptor.manifest.id,
          kind: this.descriptor.manifest.kind,
          version: this.descriptor.manifest.version,
        },
      },
      options,
      true,
    );
    this.validateInitialization(initialization);

    const capabilityResult = await this.request(
      EXTERNAL_PLUGIN_METHODS.capabilities,
      {},
      options,
      true,
    );
    const capabilities = this.validateCapabilities(capabilityResult);
    const pid = this.child?.pid;
    if (pid === undefined) {
      throw this.error(
        'PLUGIN_PROCESS_NOT_RUNNING',
        'Plugin has no process ID',
      );
    }
    const handshake: ExternalPluginHandshake = {
      protocol: EXTERNAL_PLUGIN_PROTOCOL,
      pluginId: this.descriptor.manifest.id,
      kind: this.descriptor.manifest.kind,
      apiVersion: 1,
      pid,
      capabilities,
    };
    this.handshake = handshake;
    this._state = 'ready';
    return handshake;
  }

  private async spawnProcess(): Promise<void> {
    const execution = this.descriptor.manifest.execution;
    const child = spawn(execution.command, [...execution.args], {
      cwd: this.cwd,
      env: this.environment,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    });
    this.child = child;
    this.closePromise = new Promise<ProcessClose>((resolveClose) => {
      this.resolveClose = resolveClose;
    });
    child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk));
    child.stderr.on('data', (chunk: Buffer) => this.onStderr(chunk));
    child.on('close', (code, signal) => this.onClose(code, signal));

    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const onSpawn = (): void => {
        child.removeListener('error', onError);
        child.on('error', (error) => {
          void this.fail(
            this.error(
              'PLUGIN_PROCESS_ERROR',
              redactExternalPluginStderr(error.message),
            ),
          );
        });
        resolveSpawn();
      };
      const onError = (error: Error): void => {
        child.removeListener('spawn', onSpawn);
        rejectSpawn(
          this.error(
            'PLUGIN_SPAWN_FAILED',
            redactExternalPluginStderr(error.message),
          ),
        );
      };
      child.once('spawn', onSpawn);
      child.once('error', onError);
    });
  }

  private async request(
    method: ExternalPluginMethod,
    params: unknown,
    options: ExternalPluginRequestOptions,
    allowStartingOrStopping = false,
  ): Promise<unknown> {
    const allowed =
      this._state === 'ready' ||
      (allowStartingOrStopping &&
        (this._state === 'starting' || this._state === 'stopping'));
    if (!allowed || !this.child || this.closed) {
      throw this.error(
        'PLUGIN_PROCESS_NOT_RUNNING',
        `Cannot call ${method} while plugin is ${this._state}`,
      );
    }
    if (!this.descriptor.methods.includes(method)) {
      throw this.error(
        'PLUGIN_METHOD_NOT_ALLOWED',
        `${method} is not allowed for ${this.descriptor.manifest.kind}`,
      );
    }
    const declaredTimeout = this.descriptor.manifest.execution.requestTimeoutMs;
    const timeoutMs = Math.min(
      options.timeoutMs ?? declaredTimeout,
      declaredTimeout,
    );
    validatePositiveInteger(
      timeoutMs,
      'request timeout',
      MAX_PLUGIN_TIMEOUT_MS,
    );
    if (options.signal?.aborted) {
      const error = this.error(
        'PLUGIN_REQUEST_ABORTED',
        `${method} was aborted before it started`,
      );
      await this.fail(error);
      throw error;
    }

    this.requestCounter += 1;
    const id = this.requestCounter;
    const request: ExternalPluginRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    let encoded: Buffer;
    try {
      encoded = Buffer.from(`${JSON.stringify(request)}\n`, 'utf8');
    } catch (error) {
      throw this.error(
        'PLUGIN_REQUEST_NOT_SERIALIZABLE',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (
      encoded.byteLength > this.descriptor.manifest.execution.maxMessageBytes
    ) {
      throw this.error(
        'PLUGIN_REQUEST_TOO_LARGE',
        `JSON-RPC request is ${encoded.byteLength} bytes; limit is ${this.descriptor.manifest.execution.maxMessageBytes}`,
      );
    }

    return await new Promise<unknown>((resolveRequest, rejectRequest) => {
      const onAbort =
        options.signal === undefined
          ? undefined
          : () => {
              const pending = this.takePending(id);
              if (!pending) return;
              const error = this.error(
                'PLUGIN_REQUEST_ABORTED',
                `${method} was aborted`,
              );
              pending.reject(error);
              void this.fail(error);
            };
      const timer = setTimeout(() => {
        const pending = this.takePending(id);
        if (!pending) return;
        const error = this.error(
          'PLUGIN_REQUEST_TIMEOUT',
          `${method} timed out after ${timeoutMs}ms`,
        );
        pending.reject(error);
        void this.fail(error);
      }, timeoutMs);
      const pending: PendingRequest = {
        id,
        method,
        resolve: resolveRequest,
        reject: rejectRequest,
        timer,
        signal: options.signal,
        abortHandler: onAbort,
      };
      this.pending.set(id, pending);
      options.signal?.addEventListener('abort', onAbort ?? (() => undefined), {
        once: true,
      });
      this.child?.stdin.write(encoded, (error) => {
        if (!error) return;
        const active = this.takePending(id);
        if (!active) return;
        const wrapped = this.error(
          'PLUGIN_STDIN_FAILED',
          redactExternalPluginStderr(error.message),
        );
        active.reject(wrapped);
        void this.fail(wrapped);
      });
    });
  }

  private onStdout(chunk: Buffer): void {
    if (this._state === 'failed' || this._state === 'stopped') return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    const maximum = this.descriptor.manifest.execution.maxMessageBytes;
    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) break;
      let line = this.stdoutBuffer.subarray(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.byteLength === 0) continue;
      if (line.byteLength > maximum) {
        void this.fail(
          this.error(
            'PLUGIN_STDOUT_LIMIT',
            `Plugin emitted a ${line.byteLength}-byte message; limit is ${maximum}`,
          ),
        );
        return;
      }
      this.handleResponseLine(line);
      if (this.state === 'failed') return;
    }
    if (this.stdoutBuffer.byteLength > maximum) {
      void this.fail(
        this.error(
          'PLUGIN_STDOUT_LIMIT',
          `Plugin stdout exceeded ${maximum} bytes without a newline`,
        ),
      );
    }
  }

  private onStderr(chunk: Buffer): void {
    this.stderrBytesSeen += chunk.byteLength;
    this.stderrBuffer = Buffer.concat([this.stderrBuffer, chunk]);
    if (this.stderrBuffer.byteLength > this.stderrMaxBytes) {
      this.stderrBuffer = this.stderrBuffer.subarray(
        this.stderrBuffer.byteLength - this.stderrMaxBytes,
      );
      this.stderrTruncated = true;
    }
  }

  private handleResponseLine(line: Buffer): void {
    let value: unknown;
    try {
      value = JSON.parse(line.toString('utf8')) as unknown;
    } catch {
      void this.fail(
        this.error(
          'PLUGIN_PROTOCOL_INVALID_JSON',
          'Plugin stdout contained invalid JSON',
        ),
      );
      return;
    }
    if (!isRecord(value) || value.jsonrpc !== '2.0') {
      void this.fail(
        this.error(
          'PLUGIN_PROTOCOL_INVALID_RESPONSE',
          'Plugin response must be a JSON-RPC 2.0 object',
        ),
      );
      return;
    }
    if (!Number.isInteger(value.id) || typeof value.id !== 'number') {
      void this.fail(
        this.error(
          'PLUGIN_PROTOCOL_INVALID_ID',
          'Plugin response ID must match the numeric host request ID',
        ),
      );
      return;
    }
    const pending = this.takePending(value.id);
    if (!pending) {
      void this.fail(
        this.error(
          'PLUGIN_PROTOCOL_UNKNOWN_ID',
          `Plugin responded with unknown request ID ${value.id}`,
        ),
      );
      return;
    }
    const hasResult = hasOwn(value, 'result');
    const hasError = hasOwn(value, 'error');
    if (hasResult === hasError) {
      const error = this.error(
        'PLUGIN_PROTOCOL_INVALID_RESPONSE',
        'Plugin response must contain exactly one of result or error',
      );
      pending.reject(error);
      void this.fail(error);
      return;
    }
    if (hasError) {
      if (
        !isRecord(value.error) ||
        typeof value.error.code !== 'number' ||
        !Number.isInteger(value.error.code) ||
        typeof value.error.message !== 'string'
      ) {
        const error = this.error(
          'PLUGIN_PROTOCOL_INVALID_ERROR',
          'Plugin JSON-RPC error must contain integer code and string message',
        );
        pending.reject(error);
        void this.fail(error);
        return;
      }
      pending.reject(
        new ExternalPluginRpcError(
          this.descriptor.manifest.id,
          value.error.code,
          value.error.message,
          this.stderr,
        ),
      );
      return;
    }
    pending.resolve(value.result);
  }

  private validateInitialization(value: unknown): void {
    if (
      !isRecord(value) ||
      value.protocol !== EXTERNAL_PLUGIN_PROTOCOL ||
      value.pluginId !== this.descriptor.manifest.id ||
      value.kind !== this.descriptor.manifest.kind ||
      value.apiVersion !== 1
    ) {
      throw this.error(
        'PLUGIN_HANDSHAKE_INVALID',
        'plugin.initialize returned identity or protocol data that does not match the manifest',
      );
    }
  }

  private validateCapabilities(value: unknown): {
    provides: readonly string[];
    requires: readonly string[];
  } {
    if (!isRecord(value)) {
      throw this.error(
        'PLUGIN_HANDSHAKE_INVALID',
        'plugin.capabilities must return an object',
      );
    }
    const provides = normalizedStringArray(
      value.provides,
      'plugin.capabilities.provides',
      this.descriptor.manifest.id,
    );
    const requires = normalizedStringArray(
      value.requires,
      'plugin.capabilities.requires',
      this.descriptor.manifest.id,
    );
    if (
      !sameStringSet(
        this.descriptor.manifest.capabilities.provides,
        provides,
      ) ||
      !sameStringSet(this.descriptor.manifest.capabilities.requires, requires)
    ) {
      throw this.error(
        'PLUGIN_CAPABILITY_MISMATCH',
        'Runtime capabilities must exactly match the validated manifest',
      );
    }
    return { provides, requires };
  }

  private takePending(id: number): PendingRequest | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener('abort', pending.abortHandler);
    }
    return pending;
  }

  private rejectAllPending(error: unknown): void {
    for (const id of [...this.pending.keys()]) {
      this.takePending(id)?.reject(error);
    }
  }

  private onClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    this.closed = true;
    this.resolveClose?.({ code, signal });
    this.resolveClose = undefined;
    if (this.pending.size > 0) {
      this.rejectAllPending(
        this.error(
          'PLUGIN_PROCESS_EXITED',
          `Plugin process exited with code ${String(code)} and signal ${String(signal)}`,
        ),
      );
    }
    if (
      this._state !== 'stopping' &&
      this._state !== 'stopped' &&
      this._state !== 'failed'
    ) {
      this._state = 'failed';
    }
  }

  private async waitForClose(timeoutMs: number): Promise<boolean> {
    if (this.closed) return true;
    const closePromise = this.closePromise;
    if (!closePromise) return true;
    return await new Promise<boolean>((resolveWait) => {
      const timer = setTimeout(() => resolveWait(false), timeoutMs);
      void closePromise.then(() => {
        clearTimeout(timer);
        resolveWait(true);
      });
    });
  }

  private async terminate(): Promise<void> {
    if (this.termination) return await this.termination;
    const child = this.child;
    if (!child || this.closed) return;
    this.termination = terminateExternalPluginTree(child);
    return await this.termination;
  }

  private async fail(error: unknown): Promise<void> {
    if (this._state !== 'stopped') this._state = 'failed';
    this.stdoutBuffer = Buffer.alloc(0);
    const normalized =
      error instanceof Error
        ? error
        : this.error('PLUGIN_HOST_FAILED', String(error));
    this.rejectAllPending(normalized);
    await this.terminate();
  }

  private error(code: string, message: string): ExternalPluginHostError {
    return new ExternalPluginHostError(
      code,
      redactExternalPluginStderr(message),
      this.descriptor.manifest.id,
      this.stderr,
    );
  }
}
