import type {
  AssuranceFinding,
  EvidenceEnvelope,
  Session,
} from '@rn-agent-observer/schemas';
import type {
  AnalyzerPluginManifest,
  ExternalPluginManifest,
  PluginManifest,
  PluginPermission,
  ReporterPluginManifest,
} from './manifest.js';

export type PluginAwaitable<T> = T | Promise<T>;

export interface PluginLogger {
  debug(message: string, details?: Readonly<Record<string, unknown>>): void;
  info(message: string, details?: Readonly<Record<string, unknown>>): void;
  warn(message: string, details?: Readonly<Record<string, unknown>>): void;
  error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface PluginHostContext {
  readonly projectRoot: string;
  readonly artifactRoot: string;
  /** Capabilities available before this plugin initializes. */
  readonly capabilities: readonly string[];
  /** Explicit grants; merely declaring a permission does not grant it. */
  readonly grantedPermissions: readonly PluginPermission[];
  readonly logger?: PluginLogger;
}

export type PluginLifecyclePhase =
  'initialize' | 'analyze' | 'report' | 'dispose';

export interface PluginInvocationContext {
  readonly pluginId: string;
  readonly invocationId: string;
  readonly phase: PluginLifecyclePhase;
  readonly signal: AbortSignal;
  readonly host: PluginHostContext;
  readonly logger: PluginLogger;
}

export interface PluginLifecycle {
  initialize?(context: PluginInvocationContext): PluginAwaitable<void>;
  dispose?(context: PluginInvocationContext): PluginAwaitable<void>;
}

/**
 * Stable boundary for analyzers. Current Session event payloads remain unknown,
 * so plugins receive an explicitly versioned envelope instead of raw internals.
 */
export type PluginEvidenceEnvelope = EvidenceEnvelope;

export interface AnalyzerRequest {
  readonly evidence: readonly PluginEvidenceEnvelope[];
  readonly configuration: Readonly<Record<string, unknown>>;
}

export interface AnalyzerResult {
  readonly findings: readonly AssuranceFinding[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ReporterRequest {
  readonly session: Session;
  readonly findings: readonly AssuranceFinding[];
  readonly outputDirectory: string;
  readonly configuration: Readonly<Record<string, unknown>>;
}

export interface ReporterArtifact {
  readonly path: string;
  readonly mimeType?: string;
  readonly label?: string;
}

export interface ReporterResult {
  readonly artifacts: readonly ReporterArtifact[];
  readonly summary?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AnalyzerExtension extends PluginLifecycle {
  readonly manifest: AnalyzerPluginManifest;
  analyze(
    request: AnalyzerRequest,
    context: PluginInvocationContext,
  ): PluginAwaitable<AnalyzerResult>;
}

export interface ReporterExtension extends PluginLifecycle {
  readonly manifest: ReporterPluginManifest;
  report(
    request: ReporterRequest,
    context: PluginInvocationContext,
  ): PluginAwaitable<ReporterResult>;
}

export type InProcessExtension = AnalyzerExtension | ReporterExtension;

export const EXTERNAL_PLUGIN_METHODS = {
  initialize: 'plugin.initialize',
  capabilities: 'plugin.capabilities',
  providerCollect: 'provider.collect',
  actionExecute: 'action.execute',
  dispose: 'plugin.dispose',
} as const;

export type ExternalPluginMethod =
  (typeof EXTERNAL_PLUGIN_METHODS)[keyof typeof EXTERNAL_PLUGIN_METHODS];

export interface ExternalPluginDescriptor {
  readonly manifest: ExternalPluginManifest;
  /** Methods are derived from kind and make host/plugin negotiation auditable. */
  readonly methods: readonly ExternalPluginMethod[];
}

export interface ExternalPluginRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: ExternalPluginMethod;
  readonly params: unknown;
}

export interface ExternalPluginRpcSuccess {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly result: unknown;
}

export interface ExternalPluginRpcFailure {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type ExternalPluginRpcResponse =
  ExternalPluginRpcSuccess | ExternalPluginRpcFailure;

export interface PluginConformanceReport {
  readonly valid: boolean;
  readonly kind: PluginManifest['kind'] | null;
  readonly pluginId: string | null;
  readonly issues: readonly {
    readonly path: string;
    readonly code: string;
    readonly message: string;
  }[];
}
