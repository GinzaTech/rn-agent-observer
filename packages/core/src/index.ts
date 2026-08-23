import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { PNG } from 'pngjs';
import {
  ObserverStatusSchema,
  UITreeSchema,
  type AppState,
  type Artifact,
  type AssuranceFinding,
  type DeviceNetworkDelta,
  type DevToolsExport,
  type Diagnosis,
  type EvidenceGraph,
  type LogEntry,
  type NetworkRequest,
  type NetworkSummary,
  type Observation,
  type PerformanceSnapshot,
  type ReactRenderStat,
  type RuntimeUiModel,
  type ScreenComparison,
  type ScreenUnderstanding,
  type ScreenSnapshot,
  type Session,
  type Trace,
  type UITree,
} from '@rn-agent-observer/schemas';
import { AdbClient } from './adb/adb-client.js';
import { flattenUiTree } from './adb/parsers.js';
import {
  analyzePassiveAccessibility,
  type PassiveAccessibilityResult,
} from './accessibility/passive-audit.js';
import { ArtifactManager } from './artifacts/artifact-manager.js';
import { comparePngFiles } from './comparison/compare.js';
import {
  analyzeActionCoverage,
  type ActionCoverageResult,
} from './coverage/action-coverage.js';
import { resolveAppId } from './config.js';
import {
  authorizePersistentPermissionChange,
  authorizeObserverAction,
  loadObserverConfig,
  resolveArtifactRoot,
  type ObserverAction,
  type ObserverProjectConfig,
} from './config/observer-config.js';
import { collectDevToolsExport } from './devtools/devtools-exporter.js';
import { collectMetroNetwork } from './devtools/metro-network.js';
import {
  reloadViaMetro,
  metroReloadUnavailableReason,
} from './devtools/metro-reload.js';
import { collectDevToolsProfile } from './devtools/profiler.js';
import {
  diagnoseEvidence,
  mergeThresholds,
  type DiagnosisThresholds,
} from './diagnosis/rules.js';
import { ObserverError, asObserverError } from './errors.js';
import { buildEvidenceGraph } from './evidence/graph.js';
import {
  networkRequestsFromLogs,
  appDataFromLogs,
  jsTasksFromLogs,
  renderStatsFromLogs,
  routeFromLogs,
  summarizeNetwork,
  uiElementsFromLogs,
  uiInteractionsFromLogs,
  type AppDataEvent,
} from './network/network.js';
import { TraceManager } from './performance/trace-manager.js';
import {
  frameMetricSignature,
  markFrameMetricsStale,
} from './performance/freshness.js';
import {
  redactDeepLinkEventData,
  redactDeepLinkUri,
  type RedactedDeepLinkUri,
} from './privacy/deep-link.js';
import {
  buildSnapshot,
  snapshotDiff,
  stabilizeSnapshotRefs,
  type SnapshotDiff,
  type SnapshotRefRegistry,
  type UiSnapshot,
} from './refs/snapshot.js';
import {
  runReplayScript,
  type ReplayReport,
  type ReplayScript,
  type ReplayStep,
} from './replay/replay.js';
import { expoRouterSitemap, hasAppDir } from './routes/sitemap.js';
import { ScreenRecorder } from './recording/screen-recorder.js';
import {
  analyzePassiveResilience,
  type PassiveResilienceResult,
} from './resilience/passive-analysis.js';
import {
  runMalformedDeepLinkScenario,
  runPermissionTransitionScenario,
  type ActiveSecurityScenarioResult,
  type MalformedDeepLinkScenario,
  type PermissionTransitionScenario,
} from './security/active-scenario.js';
import { createObserverActiveSecurityExecutor } from './security/observer-active-executor.js';
import {
  SessionStore,
  type SessionListEntry,
  type StoredArtifact,
} from './session/session-store.js';
import {
  exportSessionShareBundle as writeSessionShareBundle,
  readAndVerifySessionShareBundle,
  type ExportSessionShareBundleResult,
  type VerifySessionShareBundleResult,
} from './session/share-bundle.js';
import {
  analyzePixels,
  analyzeScreen,
  auditAccessibility,
  redactSensitiveUiTree,
  type PriorUnderstandingState,
} from './ui/understanding.js';
import { buildRuntimeUiModel } from './ui/runtime-model.js';
import { scanSourceUi } from './ui/source-model.js';

export * from './adb/parsers.js';
export * from './diagnosis/rules.js';
export * from './errors.js';
export * from './evidence/graph.js';
export * from './filesystem/path-authority.js';
export * from './coverage/action-coverage.js';
export * from './network/network.js';
export * from './privacy/deep-link.js';
export * from './refs/snapshot.js';
export * from './replay/replay.js';
export * from './routes/sitemap.js';
export * from './session/share-bundle.js';
export * from './ui/understanding.js';
export * from './ui/runtime-model.js';
export * from './ui/source-model.js';

function readObserverVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown };
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('Core package.json does not contain a valid version');
  }
  return packageJson.version;
}

/** Package metadata is the single version source of truth. */
export const OBSERVER_VERSION = readObserverVersion();

export const IMPLEMENTED_COMMANDS = [
  'help',
  'status',
  'doctor',
  'init',
  'suite',
  'run',
  'ci',
  'security',
  'dashboard',
  'open',
  'devices',
  'device-info',
  'launch',
  'reload',
  'app-state',
  'device-network',
  'metro-network',
  'screenshot',
  'ui-tree',
  'snapshot',
  'understand-screen',
  'ui-model',
  'tap',
  'swipe',
  'type-text',
  'back',
  'deep-link',
  'permissions',
  'assert',
  'a11y-audit',
  'resilience',
  'logs',
  'performance',
  'coverage',
  'bundle',
  'plugin',
  'target',
  'render-stats',
  'app-data',
  'routes',
  'network',
  'observe',
  'trace',
  'record',
  'replay',
  'artifacts',
  'session',
  'diagnose',
  'compare',
  'devtools-export',
  'devtools-profile',
] as const;

export interface ObserverCoreOptions {
  projectRoot?: string;
  deviceId?: string;
  appId?: string;
  artifactRoot?: string;
  adbExecutable?: string;
  sessionId?: string;
  captureRuntimeUiOnStop?: boolean;
  onWarning?: (warning: ObserverWarning) => void;
}

export interface ObserverWarning {
  code: 'EVIDENCE_NOT_RECORDED';
  message: string;
  suggestion: string;
  eventType: string;
}

export interface ScreenshotResult {
  artifact: Artifact;
  screen: ScreenSnapshot;
}

export interface AppReloadOptions {
  fast?: boolean;
  metroUrl?: string;
}

/**
 * A caller must state that it intends to leave the requested Android runtime
 * permission changed. Bounded active-security scenarios do not use this API:
 * they have their own authorization, observation, and restoration path.
 */
export interface PersistentPermissionChangeConfirmation {
  readonly confirmed: true;
}

export interface PersistentPermissionChangeResult {
  readonly appId: string;
  readonly permission: string;
  readonly granted: boolean;
  readonly previouslyGranted: boolean;
  readonly verified: true;
  readonly persistent: true;
}

/**
 * Deep-link invocation evidence returned to callers. The original input is
 * used only to launch the app; this result never echoes credentials, query,
 * or fragment values.
 */
export interface DeepLinkResult extends RedactedDeepLinkUri {
  readonly appId: string;
}

export class ObserverCore {
  readonly projectRoot: string;
  readonly config: ObserverProjectConfig;
  readonly configPath: string;
  readonly configExists: boolean;
  readonly adb: AdbClient;
  readonly artifacts: ArtifactManager;
  private sessionStore: SessionStore | undefined;
  private traceManager: TraceManager | undefined;
  private screenRecorder: ScreenRecorder | undefined;
  private readonly explicitAppId: string | undefined;
  private readonly onWarning: (warning: ObserverWarning) => void;
  private readonly captureRuntimeUiOnStop: boolean;
  private activeSessionId: string | undefined;
  private warnedWithoutSession = false;

  constructor(options: ObserverCoreOptions = {}) {
    this.projectRoot = resolve(
      options.projectRoot ??
        process.env.RN_OBSERVER_PROJECT_ROOT ??
        process.cwd(),
    );
    const loadedConfig = loadObserverConfig(this.projectRoot);
    this.config = loadedConfig.config;
    this.configPath = loadedConfig.path;
    this.configExists = loadedConfig.exists;
    const deviceId =
      options.deviceId ??
      process.env.RN_OBSERVER_DEVICE_ID ??
      loadedConfig.config.target.deviceId;
    this.adb = new AdbClient(deviceId, options.adbExecutable);
    this.explicitAppId =
      options.appId ??
      process.env.RN_OBSERVER_APP_ID ??
      loadedConfig.config.target.appId;
    this.onWarning =
      options.onWarning ??
      ((warning) =>
        process.emitWarning(warning.message, {
          code: warning.code,
          detail: warning.suggestion,
        }));
    this.captureRuntimeUiOnStop = options.captureRuntimeUiOnStop ?? true;
    this.artifacts = new ArtifactManager(
      this.projectRoot,
      options.artifactRoot ??
        resolveArtifactRoot(this.projectRoot, loadedConfig.config),
    );
    this.activeSessionId =
      options.sessionId ?? process.env.RN_OBSERVER_SESSION_ID;
  }

  get sessions(): SessionStore {
    this.artifacts.ensureSafeRoot();
    this.sessionStore ??= new SessionStore(this.artifacts.root);
    return this.sessionStore;
  }

  get traces(): TraceManager {
    this.traceManager ??= new TraceManager(this.adb, this.artifacts);
    return this.traceManager;
  }

  get recordings(): ScreenRecorder {
    this.screenRecorder ??= new ScreenRecorder(this.adb, this.artifacts);
    return this.screenRecorder;
  }

  close(): void {
    this.sessionStore?.close();
    this.sessionStore = undefined;
  }

  get appId(): string {
    return resolveAppId(this.projectRoot, this.explicitAppId);
  }

  /**
   * Fails closed before an operation can change the configured app or device.
   * Read-only evidence collection deliberately does not use this boundary.
   */
  assertActionAuthorized(action: ObserverAction): void {
    const decision = authorizeObserverAction(
      this.config,
      action,
      this.appId,
      this.adb.deviceId,
    );
    if (decision.allowed) return;
    throw new ObserverError(
      'ACTION_NOT_AUTHORIZED',
      `Refused ${action}: ${decision.reason}`,
      true,
      'Use an owned development app and explicitly configure security.mode=authorized-active, its app ID, and the required action risk.',
    );
  }

  private assertPersistentPermissionChangeAuthorized(permission: string): void {
    const decision = authorizePersistentPermissionChange(
      this.config,
      permission,
      this.appId,
      this.adb.deviceId,
    );
    if (decision.allowed) return;
    throw new ObserverError(
      'ACTION_NOT_AUTHORIZED',
      `Refused persistent permission change: ${decision.reason}`,
      true,
      'Enable only the exact owned app, ADB device, persistent-permission risk, and runtime permission in project policy.',
    );
  }

  getStatus() {
    return ObserverStatusSchema.parse({
      name: 'rn-agent-observer',
      version: OBSERVER_VERSION,
      phase: 'android-v1',
      projectRoot: this.projectRoot,
      implementedCommands: [...IMPLEMENTED_COMMANDS],
      plannedCommands: [],
    });
  }

  async deviceList() {
    return { devices: await this.adb.listDevices() };
  }

  async deviceInfo() {
    return this.adb.deviceInfo();
  }

  async appLaunch(): Promise<{
    appId: string;
    launched: true;
    evidenceRecorded: boolean;
  }> {
    this.assertActionAuthorized('launch');
    await this.adb.launch(this.appId);
    const result = {
      appId: this.appId,
      launched: true as const,
      evidenceRecorded: this.hasActiveSession,
    };
    this.record('launch', result);
    return result;
  }

  async appReload(options: AppReloadOptions = {}): Promise<{
    appId: string;
    reloaded: true;
    mode: 'app' | 'metro' | 'app-fallback';
    fallbackReason?: string;
    evidenceRecorded: boolean;
  }> {
    this.assertActionAuthorized('reload');
    if (options.fast) {
      try {
        await reloadViaMetro(options.metroUrl, this.appId, this.artifacts.root);
        const result = {
          appId: this.appId,
          reloaded: true as const,
          mode: 'metro' as const,
          evidenceRecorded: this.hasActiveSession,
        };
        this.record('reload', result);
        return result;
      } catch (error) {
        await this.adb.reload(this.appId);
        const result = {
          appId: this.appId,
          reloaded: true as const,
          mode: 'app-fallback' as const,
          fallbackReason: metroReloadUnavailableReason(error),
          evidenceRecorded: this.hasActiveSession,
        };
        this.record('reload', result);
        return result;
      }
    }
    await this.adb.reload(this.appId);
    const result = {
      appId: this.appId,
      reloaded: true as const,
      mode: 'app' as const,
      evidenceRecorded: this.hasActiveSession,
    };
    this.record('reload', result);
    return result;
  }

  private get hasActiveSession(): boolean {
    return this.activeSessionId !== undefined;
  }

  private record(type: string, data: unknown): void {
    if (this.activeSessionId) {
      this.sessions.event(this.activeSessionId, type, data);
      return;
    }
    if (!this.warnedWithoutSession) {
      this.warnedWithoutSession = true;
      this.onWarning({
        code: 'EVIDENCE_NOT_RECORDED',
        message: `The "${type}" event was not added to a session timeline`,
        suggestion:
          'Run "rn-observe session start" and set RN_OBSERVER_SESSION_ID before collecting evidence',
        eventType: type,
      });
    }
  }

  /**
   * Resolves a caller-provided relative artifact path without allowing it to
   * escape the configured artifact root. This is kept in core so CLI and MCP
   * share the same boundary rather than each implementing their own check.
   */
  private artifactRelativePath(relativePath: string, label: string): string {
    if (
      !relativePath ||
      isAbsolute(relativePath) ||
      win32.isAbsolute(relativePath)
    ) {
      throw new ObserverError(
        'ARTIFACT_PATH_INVALID',
        `${label} must be a non-empty relative path inside the artifact root`,
        true,
      );
    }
    const root = resolve(this.artifacts.root);
    const candidate = resolve(root, relativePath);
    const fromRoot = relative(root, candidate);
    if (
      fromRoot.length === 0 ||
      fromRoot === '..' ||
      fromRoot.startsWith(`..${sep}`) ||
      isAbsolute(fromRoot) ||
      win32.isAbsolute(fromRoot)
    ) {
      throw new ObserverError(
        'ARTIFACT_PATH_INVALID',
        `${label} must remain inside the artifact root`,
        true,
      );
    }
    return candidate;
  }

  /** Creates a contained directory path and rejects pre-existing symlink parents. */
  private newArtifactOutputPath(relativePath: string, label: string): string {
    const outputPath = this.artifactRelativePath(relativePath, label);
    const root = resolve(this.artifacts.root);
    mkdirSync(dirname(outputPath), { recursive: true });
    const directory = relative(root, dirname(outputPath));
    let current = root;
    for (const segment of directory.split(/[\\/]/u).filter(Boolean)) {
      current = join(current, segment);
      if (lstatSync(current).isSymbolicLink()) {
        throw new ObserverError(
          'ARTIFACT_PATH_UNSAFE',
          `${label} has a symbolic-link parent and was refused`,
          true,
        );
      }
    }
    return outputPath;
  }

  async screenshot(): Promise<ScreenshotResult> {
    const buffer = await this.adb.screenshot();
    const image = PNG.sync.read(buffer);
    const artifact = this.artifacts.write('screenshot', buffer, {
      ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
      extension: '.png',
      mimeType: 'image/png',
    });
    this.sessions.artifact(this.activeSessionId, artifact);
    const screen: ScreenSnapshot = {
      width: image.width,
      height: image.height,
      orientation: image.width > image.height ? 'landscape' : 'portrait',
      timestamp: artifact.createdAt,
      artifactId: artifact.id,
    };
    const result = { artifact, screen };
    this.record('screenshot', result);
    return result;
  }

  async getUiTree(): Promise<UITree> {
    const tree = redactSensitiveUiTree(await this.adb.uiTree());
    const artifact = this.artifacts.write('ui-tree', JSON.stringify(tree), {
      ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
      extension: '.json',
      mimeType: 'application/json',
    });
    this.sessions.artifact(this.activeSessionId, artifact);
    tree.artifactId = artifact.id;
    tree.artifactPath = artifact.path;
    this.record('ui_tree', {
      source: tree.source,
      elementCount: flattenUiTree(tree.roots).length,
      artifactId: artifact.id,
    });
    return tree;
  }

  async tap(target: { x: number; y: number } | { testId: string }) {
    this.assertActionAuthorized('tap');
    await this.adb.tap(target);
    this.record('tap', target);
    return { performed: true as const, target };
  }

  async swipe(
    start: { x: number; y: number },
    end: { x: number; y: number },
    durationMs = 500,
  ) {
    this.assertActionAuthorized('swipe');
    await this.adb.swipe(start, end, durationMs);
    const result = { performed: true as const, start, end, durationMs };
    this.record('swipe', result);
    return result;
  }

  async typeText(text: string) {
    this.assertActionAuthorized('type-text');
    await this.adb.typeText(text);
    this.record('type_text', { length: text.length });
    return { performed: true as const, characters: text.length };
  }

  async back() {
    this.assertActionAuthorized('back');
    await this.adb.back();
    this.record('back', {});
    return { performed: true as const };
  }

  async getLogs(
    filters: {
      level?: LogEntry['level'];
      keyword?: string;
      source?: string;
      limit?: number;
      since?: string;
    } = {},
  ): Promise<LogEntry[]> {
    let logs = await this.adb.logs(this.appId, filters.limit ?? 500);
    if (filters.level) {
      logs = logs.filter((entry) => entry.level === filters.level);
    }
    if (filters.keyword) {
      const keyword = filters.keyword.toLowerCase();
      logs = logs.filter((entry) =>
        entry.message.toLowerCase().includes(keyword),
      );
    }
    if (filters.source) {
      logs = logs.filter((entry) => entry.source === filters.source);
    }
    if (filters.since) {
      logs = logs.filter((entry) => entry.timestamp >= (filters.since ?? ''));
    }
    this.record('logs', {
      count: logs.length,
      errors: logs.filter(
        (entry) => entry.level === 'error' || entry.level === 'fatal',
      ).length,
    });
    return logs;
  }

  async performanceSnapshot(): Promise<PerformanceSnapshot> {
    const [collectedSnapshot, logs] = await Promise.all([
      this.adb.performance(this.appId),
      this.getLogs({ limit: 2000 }),
    ]);
    let snapshot = collectedSnapshot;
    const signature = frameMetricSignature(snapshot);
    const freshnessPath = join(
      this.artifacts.root,
      'performance-state',
      `${this.appId.replace(/[^a-zA-Z0-9._-]/g, '-')}.json`,
    );
    if (signature) {
      let previous: { signature?: string; timestamp?: string } | undefined;
      try {
        previous = JSON.parse(readFileSync(freshnessPath, 'utf8')) as {
          signature?: string;
          timestamp?: string;
        };
      } catch {
        previous = undefined;
      }
      if (previous?.signature === signature && previous.timestamp) {
        snapshot = markFrameMetricsStale(snapshot, previous.timestamp);
      } else {
        mkdirSync(dirname(freshnessPath), { recursive: true });
        writeFileSync(
          freshnessPath,
          JSON.stringify({ signature, timestamp: snapshot.timestamp }),
        );
      }
    }
    const latestTask = jsTasksFromLogs(logs).at(-1);
    if (
      latestTask &&
      Date.now() - Date.parse(latestTask.timestamp) <= 5 * 60 * 1000
    ) {
      snapshot.metrics = snapshot.metrics.map((metric) =>
        metric.name === 'js_blocking_ms'
          ? {
              ...metric,
              value: latestTask.durationMs,
              available: true,
              source: latestTask.source,
              timestamp: latestTask.timestamp,
              confidence: 0.99,
              reason: undefined,
            }
          : metric,
      );
    }
    this.record('performance', snapshot);
    return snapshot;
  }

  async startTrace(durationMs = 10_000): Promise<Trace> {
    this.assertActionAuthorized('trace-start');
    const trace = await this.traces.start(durationMs, this.activeSessionId);
    this.record('trace_started', trace);
    return trace;
  }

  async stopTrace(traceId: string): Promise<Trace> {
    this.assertActionAuthorized('trace-stop');
    const completed = await this.traces.stop(traceId);
    this.sessions.artifact(completed.sessionId, completed.artifact);
    if (completed.sessionId) {
      this.sessions.event(
        completed.sessionId,
        'trace_stopped',
        completed.trace,
      );
    } else {
      this.record('trace_stopped', completed.trace);
    }
    return completed.trace;
  }

  async startRecording(durationMs = 10_000): Promise<Trace> {
    this.assertActionAuthorized('record-start');
    const recording = await this.recordings.start(
      durationMs,
      this.activeSessionId,
    );
    this.record('recording_started', recording);
    return recording;
  }

  async stopRecording(recordingId: string): Promise<Trace> {
    this.assertActionAuthorized('record-stop');
    const completed = await this.recordings.stop(recordingId);
    this.sessions.artifact(completed.sessionId, completed.artifact);
    if (completed.sessionId) {
      this.sessions.event(
        completed.sessionId,
        'recording_stopped',
        completed.trace,
      );
    } else {
      this.record('recording_stopped', completed.trace);
    }
    return completed.trace;
  }

  async metroNetworkSnapshot(
    options: {
      metroUrl?: string;
      durationMs?: number;
    } = {},
  ) {
    const snapshot = await collectMetroNetwork({
      appId: this.appId,
      artifactRoot: this.artifacts.root,
      ...options,
    });
    this.record('metro_network', {
      requestCount: snapshot.summary.requestCount,
      failedRequests: snapshot.summary.failedRequests,
      durationMs: snapshot.durationMs,
      target: snapshot.target.id,
    });
    return snapshot;
  }

  async devtoolsProfile(
    options: {
      metroUrl?: string;
      durationMs?: number;
    } = {},
  ) {
    const result = await collectDevToolsProfile({
      appId: this.appId,
      artifactRoot: this.artifacts.root,
      ...options,
    });
    const artifact = this.artifacts.write(
      'profile',
      JSON.stringify(result.profile, null, 2),
      {
        ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
        extension: '.cpuprofile',
        mimeType: 'application/json',
        name: 'devtools-profile.cpuprofile',
      },
    );
    this.sessions.artifact(this.activeSessionId, artifact);
    const summary = {
      startedAt: result.startedAt,
      stoppedAt: result.stoppedAt,
      durationMs: result.durationMs,
      nodeCount: result.nodeCount,
      sampleCount: result.sampleCount,
      artifactId: artifact.id,
    };
    this.record('devtools_profile', summary);
    return summary;
  }

  async getNetworkRequests(): Promise<NetworkRequest[]> {
    return networkRequestsFromLogs(await this.getLogs({ limit: 2000 }));
  }

  async getNetworkSummary(): Promise<NetworkSummary> {
    return summarizeNetwork(await this.getNetworkRequests());
  }

  async getReactRenderStats(): Promise<ReactRenderStat[]> {
    return renderStatsFromLogs(await this.getLogs({ limit: 2000 }));
  }

  async getAppState(): Promise<AppState> {
    const state = await this.adb.appState(this.appId);
    this.record('app_state', state);
    return state;
  }

  private snapshotStatePath(): string {
    return this.activeSessionId
      ? join(
          this.artifacts.root,
          'sessions',
          this.activeSessionId,
          'state',
          'last-snapshot.json',
        )
      : join(this.artifacts.root, 'snapshots', 'last.json');
  }

  private understandingStatePath(): string {
    return this.activeSessionId
      ? join(
          this.artifacts.root,
          'sessions',
          this.activeSessionId,
          'state',
          'screen-understanding.json',
        )
      : join(this.artifacts.root, 'screen-understanding', 'last.json');
  }

  private loadLastSnapshot(): {
    snapshot: UiSnapshot;
    interactiveOnly: boolean;
    refRegistry?: SnapshotRefRegistry;
  } {
    try {
      const raw = JSON.parse(
        readFileSync(this.snapshotStatePath(), 'utf8'),
      ) as {
        interactiveOnly?: boolean;
        refRegistry?: SnapshotRefRegistry;
        snapshot?: UiSnapshot;
      };
      if (!raw.snapshot) throw new Error('missing snapshot');
      return {
        snapshot: raw.snapshot,
        interactiveOnly: raw.interactiveOnly ?? false,
        ...(raw.refRegistry ? { refRegistry: raw.refRegistry } : {}),
      };
    } catch {
      throw new ObserverError(
        'SNAPSHOT_NOT_FOUND',
        'No snapshot has been taken yet',
        true,
        'Run snapshot first, then use refs from its output',
      );
    }
  }

  private snapshotFromTree(
    tree: UITree,
    options: { interactiveOnly?: boolean } = {},
  ): UiSnapshot {
    let priorRegistry: SnapshotRefRegistry | undefined;
    try {
      priorRegistry = this.loadLastSnapshot().refRegistry;
    } catch {
      priorRegistry = undefined;
    }
    const stable = stabilizeSnapshotRefs(
      buildSnapshot(tree, options),
      priorRegistry,
    );
    const snap = stable.snapshot;
    mkdirSync(dirname(this.snapshotStatePath()), { recursive: true });
    writeFileSync(
      this.snapshotStatePath(),
      JSON.stringify({
        interactiveOnly: options.interactiveOnly ?? false,
        refRegistry: stable.registry,
        snapshot: snap,
      }),
    );
    this.record('snapshot', {
      snapshotId: snap.snapshotId,
      elementCount: snap.elements.length,
      interactiveOnly: options.interactiveOnly ?? false,
    });
    return snap;
  }

  async snapshot(
    options: { interactiveOnly?: boolean } = {},
  ): Promise<UiSnapshot> {
    return this.snapshotFromTree(await this.getUiTree(), options);
  }

  async understandScreen(
    options: { stuckAfterMs?: number } = {},
  ): Promise<ScreenUnderstanding> {
    const stuckAfterMs = Math.max(
      1_000,
      Math.min(options.stuckAfterMs ?? 15_000, 300_000),
    );
    const screenshot = await this.screenshot();
    const tree = await this.getUiTree();
    const snapshot = this.snapshotFromTree(tree);
    const appState = await this.getAppState();
    const logs = await this.getLogs({ limit: 200 });
    const device = await this.adb.deviceInfo().catch(() => undefined);
    let prior: PriorUnderstandingState | undefined;
    try {
      prior = JSON.parse(
        readFileSync(this.understandingStatePath(), 'utf8'),
      ) as PriorUnderstandingState;
    } catch {
      prior = undefined;
    }
    const image = PNG.sync.read(readFileSync(screenshot.artifact.path));
    const result = analyzeScreen({
      tree,
      snapshot,
      screen: screenshot.screen,
      screenshotPath: screenshot.artifact.path,
      pixelStatistics: analyzePixels(image),
      densityDpi: device?.densityDpi ?? 420,
      appState,
      errorLogs: logs.filter(
        (entry) => entry.level === 'error' || entry.level === 'fatal',
      ),
      route: routeFromLogs(logs),
      stuckAfterMs,
      ...(prior ? { prior } : {}),
    });
    const artifact = this.artifacts.write(
      'ui-understanding',
      JSON.stringify(result, null, 2),
      {
        ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
        extension: '.json',
        mimeType: 'application/json',
        name: 'screen-understanding.json',
      },
    );
    this.sessions.artifact(this.activeSessionId, artifact);
    const complete: ScreenUnderstanding = {
      ...result,
      artifacts: {
        ...result.artifacts,
        understandingId: artifact.id,
        understandingPath: artifact.path,
      },
    };
    mkdirSync(dirname(this.understandingStatePath()), { recursive: true });
    writeFileSync(
      this.understandingStatePath(),
      JSON.stringify({
        state: complete.state,
        fingerprint: complete.fingerprint,
        firstSeenAt: complete.stateSince,
      } satisfies PriorUnderstandingState),
    );
    this.record('screen_understanding', {
      state: complete.state,
      fingerprint: complete.fingerprint,
      issueCodes: complete.issues.map((issue) => issue.code),
      screenshotId: complete.artifacts.screenshotId,
      uiTreeId: complete.artifacts.uiTreeId,
      understandingId: artifact.id,
    });
    return complete;
  }

  private uiInteractionStatePath(sessionId: string): string {
    return join(
      this.artifacts.root,
      'sessions',
      sessionId,
      'state',
      'ui-interactions.json',
    );
  }

  private ingestUiInteractions(
    interactions: ReturnType<typeof uiInteractionsFromLogs>,
  ): number {
    const sessionId = this.activeSessionId;
    if (!sessionId) return 0;
    const statePath = this.uiInteractionStatePath(sessionId);
    let ingested: Set<string>;
    try {
      ingested = new Set(
        JSON.parse(readFileSync(statePath, 'utf8')) as string[],
      );
    } catch {
      ingested = new Set();
    }
    let added = 0;
    for (const interaction of interactions) {
      const key = `${interaction.interactionId}:${interaction.phase}`;
      if (ingested.has(key)) continue;
      this.sessions.event(sessionId, 'app_interaction', interaction);
      ingested.add(key);
      added += 1;
    }
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify([...ingested]));
    return added;
  }

  async runtimeUiModel(): Promise<RuntimeUiModel> {
    const tree = await this.getUiTree();
    const snapshot = this.snapshotFromTree(tree);
    const sessionStartedAt = this.activeSessionId
      ? this.sessions.get(this.activeSessionId).startedAt
      : undefined;
    const [logs, device] = await Promise.all([
      this.getLogs({
        limit: sessionStartedAt ? 20_000 : 5_000,
        ...(sessionStartedAt ? { since: sessionStartedAt } : {}),
      }),
      this.adb.deviceInfo().catch(() => undefined),
    ]);
    const interactions = uiInteractionsFromLogs(logs);
    const result = buildRuntimeUiModel({
      sourceElements: scanSourceUi(this.projectRoot),
      tree,
      snapshot,
      telemetry: uiElementsFromLogs(logs),
      interactions,
      route: routeFromLogs(logs),
      viewport: device?.resolution ?? null,
    });
    const artifact = this.artifacts.write(
      'runtime-ui-model',
      JSON.stringify(result, null, 2),
      {
        ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
        extension: '.json',
        mimeType: 'application/json',
        name: 'runtime-ui-model.json',
      },
    );
    this.sessions.artifact(this.activeSessionId, artifact);
    const complete: RuntimeUiModel = {
      ...result,
      artifacts: {
        ...result.artifacts,
        modelId: artifact.id,
        modelPath: artifact.path,
      },
    };
    const ingestedInteractions = this.ingestUiInteractions(interactions);
    this.record('runtime_ui_model', {
      route: complete.route,
      counts: complete.counts,
      issueCodes: complete.issues.map((entry) => entry.code),
      modelId: artifact.id,
      ingestedInteractions,
    });
    return complete;
  }

  async press(
    ref: string,
    settleMs?: number,
  ): Promise<{
    performed: boolean;
    target: { ref: string; label: string; kind: string };
    diff?: SnapshotDiff;
  }> {
    this.assertActionAuthorized('press');
    const { snapshot: before, interactiveOnly } = this.loadLastSnapshot();
    const element = before.elements.find((item) => item.ref === ref);
    if (!element) {
      throw new ObserverError(
        'REF_NOT_FOUND',
        `Snapshot ref "${ref}" was not found in the last snapshot`,
        true,
        'Run snapshot again and use refs from the latest output',
      );
    }
    const replayTarget = element.testId
      ? { testId: element.testId }
      : element.bounds
        ? {
            x: Math.round(element.bounds.x + element.bounds.width / 2),
            y: Math.round(element.bounds.y + element.bounds.height / 2),
          }
        : undefined;
    if (replayTarget) {
      await this.adb.tap(replayTarget);
    } else {
      throw new ObserverError(
        'REF_NOT_TAPPABLE',
        `Element "${ref}" has neither a test id nor bounds`,
        true,
        'Use tap --test-id or coordinates for this element',
      );
    }
    this.record('tap', {
      ...replayTarget,
      ref,
      label: element.label,
      kind: element.kind,
      ...(settleMs !== undefined ? { settleMs } : {}),
    });
    const result: {
      performed: boolean;
      target: { ref: string; label: string; kind: string };
      diff?: SnapshotDiff;
    } = {
      performed: true,
      target: { ref, label: element.label, kind: element.kind },
    };
    if (settleMs && settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      const after = await this.snapshot(
        interactiveOnly ? { interactiveOnly: true } : {},
      );
      result.diff = snapshotDiff(before, after);
    }
    return result;
  }

  async deepLink(uri: string): Promise<DeepLinkResult> {
    this.assertActionAuthorized('deep-link');
    const appId = this.appId;
    const redacted = redactDeepLinkUri(uri);
    try {
      await this.adb.deepLink(appId, uri);
    } catch {
      throw new ObserverError(
        'DEEP_LINK_FAILED',
        `Could not open deep link ${redacted.uri}`,
        true,
      );
    }
    const result: DeepLinkResult = { appId, ...redacted };
    this.record('deep_link', result);
    return result;
  }

  async listPermissions(): Promise<{
    appId: string;
    permissions: Array<{ name: string; granted: boolean }>;
  }> {
    const permissions = await this.adb.runtimePermissions(this.appId);
    this.record('permissions', { count: permissions.length });
    return { appId: this.appId, permissions };
  }

  async setPermission(
    permission: string,
    granted: boolean,
    confirmation: PersistentPermissionChangeConfirmation,
  ): Promise<PersistentPermissionChangeResult> {
    if (confirmation?.confirmed !== true) {
      throw new ObserverError(
        'PERSISTENT_PERMISSION_CONFIRMATION_REQUIRED',
        'Persistent permission changes require an explicit per-run confirmation.',
        true,
        'Pass the persistent permission confirmation only after reviewing the exact app, device, and permission.',
      );
    }
    if (typeof permission !== 'string' || permission.trim().length === 0) {
      throw new ObserverError(
        'INVALID_ARGUMENT',
        'Permission must be a non-empty Android runtime permission name.',
        true,
      );
    }
    if (typeof granted !== 'boolean') {
      throw new ObserverError(
        'INVALID_ARGUMENT',
        'Permission grant state must be a boolean.',
        true,
      );
    }
    const normalizedPermission = permission.trim();
    this.assertPersistentPermissionChangeAuthorized(normalizedPermission);
    const appId = this.appId;
    const declaredPermissions = await this.adb.runtimePermissions(appId);
    const previous = declaredPermissions.find(
      (candidate) => candidate.name === normalizedPermission,
    );
    if (!previous) {
      throw new ObserverError(
        'PERMISSION_NOT_DECLARED',
        'Configured persistent permission is not a runtime permission of the target app.',
        true,
        'Use list_permissions to select an exact runtime permission declared by the configured app.',
      );
    }

    await this.adb.setPermission(appId, normalizedPermission, granted);
    const observed = (await this.adb.runtimePermissions(appId)).find(
      (candidate) => candidate.name === normalizedPermission,
    );
    if (!observed || observed.granted !== granted) {
      throw new ObserverError(
        'PERMISSION_STATE_NOT_VERIFIED',
        'Persistent permission state did not match the requested change after ADB completed.',
        true,
        'Inspect list_permissions before continuing; this operation intentionally does not restore or relaunch the app.',
      );
    }
    const result: PersistentPermissionChangeResult = {
      appId,
      permission: normalizedPermission,
      granted,
      previouslyGranted: previous.granted,
      verified: true,
      persistent: true,
    };
    this.record('permission_changed', result);
    return result;
  }

  private persistActiveSecurityScenario(result: ActiveSecurityScenarioResult): {
    result: ActiveSecurityScenarioResult;
    artifact: Artifact;
  } {
    const artifact = this.artifacts.write(
      'security-report',
      JSON.stringify(result, null, 2),
      {
        ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
        extension: '.json',
        mimeType: 'application/json',
        name: `active-security-${result.scenarioId}.json`,
      },
    );
    this.sessions.artifact(this.activeSessionId, artifact);
    this.record('security_active_scenario', {
      scenarioId: result.scenarioId,
      kind: result.kind,
      outcome: result.outcome,
      authorization: result.authorization,
      probeCount: result.probes.length,
      findingOutcomes: result.findings.reduce<Record<string, number>>(
        (counts, finding) => {
          counts[finding.outcome] = (counts[finding.outcome] ?? 0) + 1;
          return counts;
        },
        {},
      ),
      artifactId: artifact.id,
    });
    return { result, artifact };
  }

  async runMalformedDeepLinkSecurityScenario(
    scenario: MalformedDeepLinkScenario,
    signal?: AbortSignal,
  ): Promise<{ result: ActiveSecurityScenarioResult; artifact: Artifact }> {
    this.assertActionAuthorized('security-active-deep-link');
    const result = await runMalformedDeepLinkScenario(
      scenario,
      createObserverActiveSecurityExecutor(this),
      signal,
    );
    return this.persistActiveSecurityScenario(result);
  }

  async runPermissionTransitionSecurityScenario(
    scenario: PermissionTransitionScenario,
    signal?: AbortSignal,
  ): Promise<{ result: ActiveSecurityScenarioResult; artifact: Artifact }> {
    this.assertActionAuthorized('security-active-permission');
    const result = await runPermissionTransitionScenario(
      scenario,
      createObserverActiveSecurityExecutor(this),
      signal,
    );
    return this.persistActiveSecurityScenario(result);
  }

  async assertElement(input: {
    testId?: string;
    text?: string;
    visible?: boolean;
  }): Promise<{
    passed: boolean;
    assertion: typeof input;
    evidence: {
      matchCount: number;
      label: string | null;
      visible: boolean | null;
    };
    timestamp: string;
  }> {
    if (!input.testId && !input.text) {
      throw new ObserverError(
        'INVALID_ARGUMENT',
        'assert requires a testId or text',
        true,
        'Pass --test-id ID or --text VALUE',
      );
    }
    const tree = await this.getUiTree();
    const matches = flattenUiTree(tree.roots).filter((element) =>
      input.testId
        ? element.id === input.testId ||
          element.resourceId?.endsWith(`/${input.testId}`)
        : element.text === input.text,
    );
    let passed = matches.length > 0;
    if (passed && input.visible === true) {
      passed = matches.some(
        (element) => element.visible !== false && element.bounds,
      );
    }
    if (passed && input.visible === false) {
      passed = matches.every((element) => element.visible === false);
    }
    const first = matches[0];
    const result = {
      passed,
      assertion: input,
      evidence: {
        matchCount: matches.length,
        label: first
          ? (first.contentDescription ?? first.text ?? first.id ?? null)
          : null,
        visible: first ? (first.visible ?? true) : null,
      },
      timestamp: new Date().toISOString(),
    };
    this.record('assertion', result);
    return result;
  }

  async a11yAudit(): Promise<{
    timestamp: string;
    totalInteractive: number;
    unlabeledCount: number;
    smallTouchTargets: number;
    issues: Array<{
      className: string;
      issue: 'unlabeled' | 'small-touch-target';
      bounds?: unknown;
    }>;
  }> {
    const tree = await this.getUiTree();
    const device = await this.adb.deviceInfo().catch(() => undefined);
    const audit = auditAccessibility(tree, device?.densityDpi ?? 420);
    const result = {
      timestamp: new Date().toISOString(),
      ...audit,
    };
    this.record('a11y_audit', {
      totalInteractive: result.totalInteractive,
      unlabeledCount: result.unlabeledCount,
      smallTouchTargets: result.smallTouchTargets,
    });
    return result;
  }

  async accessibilityAudit(): Promise<PassiveAccessibilityResult> {
    let tree: UITree | undefined;
    try {
      tree = await this.getUiTree();
    } catch {
      const result = analyzePassiveAccessibility(undefined, {
        availability: {
          status: 'UNAVAILABLE',
          reason: 'UI tree collection failed',
        },
      });
      this.record('a11y_audit', {
        analyzer: result.analyzer,
        outcome: result.outcome,
        counts: result.counts,
      });
      return result;
    }
    const device = await this.adb.deviceInfo().catch(() => undefined);
    const result = analyzePassiveAccessibility(tree, {
      densityDpi: device?.densityDpi ?? null,
    });
    this.record('a11y_audit', {
      analyzer: result.analyzer,
      outcome: result.outcome,
      counts: result.counts,
    });
    return result;
  }

  async resilienceReadiness(): Promise<PassiveResilienceResult> {
    const capturedAt = new Date().toISOString();
    const [appStateResult, screenResult, logsResult] = await Promise.allSettled(
      [
        this.getAppState(),
        this.understandScreen(),
        this.getLogs({ limit: 500 }),
      ],
    );
    const unavailable = [
      ...(appStateResult.status === 'rejected' ? ['app-state'] : []),
      ...(screenResult.status === 'rejected' ? ['screen'] : []),
      ...(logsResult.status === 'rejected' ? ['logs'] : []),
    ];
    const screen =
      screenResult.status === 'fulfilled'
        ? {
            state: screenResult.value.state,
            timestamp: screenResult.value.timestamp,
            issueCodes: screenResult.value.issues.map((issue) => issue.code),
          }
        : undefined;
    const result = analyzePassiveResilience({
      scenarioId: 'current-readiness',
      scenarioKind: 'passive-readiness',
      checkpoints: {
        recovery: {
          capturedAt,
          availability:
            unavailable.length === 0
              ? { status: 'AVAILABLE' }
              : {
                  status: 'DEGRADED',
                  reason: `Unavailable evidence: ${unavailable.join(', ')}`,
                },
          ...(appStateResult.status === 'fulfilled'
            ? { appState: appStateResult.value }
            : {}),
          ...(screen ? { screen } : {}),
          ...(logsResult.status === 'fulfilled'
            ? { logs: logsResult.value }
            : {}),
        },
      },
      expectations: [
        {
          id: 'process-running',
          title: 'App process is running at the recovery checkpoint',
          type: 'process-running',
          phase: 'recovery',
          expected: true,
        },
        {
          id: 'foreground',
          title: 'App is foreground at the recovery checkpoint',
          type: 'foreground',
          phase: 'recovery',
          expected: true,
        },
        {
          id: 'loading',
          title: 'Recovery checkpoint is not explicitly stuck loading',
          type: 'no-stuck-loading',
          phase: 'recovery',
        },
        {
          id: 'runtime-errors',
          title: 'Recovery checkpoint has no observed runtime errors',
          type: 'no-runtime-errors',
          phase: 'recovery',
        },
      ],
    });
    this.record('resilience_readiness', {
      analyzer: result.analyzer,
      outcome: result.outcome,
      evaluationCount: result.evaluations.length,
    });
    return result;
  }

  async getAppData(): Promise<AppDataEvent[]> {
    const events = appDataFromLogs(await this.getLogs({ limit: 2000 }));
    this.record('app_data', { namespaces: events.map((e) => e.namespace) });
    return events;
  }

  listRoutes(): {
    source: string;
    appDirExists: boolean;
    routes: string[];
  } {
    const result = {
      source: 'expo-router-filesystem',
      appDirExists: hasAppDir(this.projectRoot),
      routes: expoRouterSitemap(this.projectRoot),
    };
    this.record('routes', { count: result.routes.length });
    return result;
  }

  async runReplay(scriptPath: string): Promise<ReplayReport> {
    this.assertActionAuthorized('replay-run');
    let script: ReplayScript;
    try {
      script = JSON.parse(readFileSync(scriptPath, 'utf8')) as ReplayScript;
    } catch (error) {
      throw new ObserverError(
        'REPLAY_SCRIPT_INVALID',
        `Could not read replay script ${scriptPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        true,
        'Provide a JSON file with a "steps" array',
      );
    }
    if (!Array.isArray(script.steps)) {
      throw new ObserverError(
        'REPLAY_SCRIPT_INVALID',
        'Replay script must contain a "steps" array',
        true,
      );
    }
    const report = await runReplayScript(script, {
      tap: async (step) => {
        if (step.testId) {
          await this.tap({ testId: step.testId });
          return `tapped testId "${step.testId}"`;
        }
        if (step.ref) {
          const pressed = await this.press(step.ref, step.settleMs);
          return pressed.diff
            ? `pressed @${step.ref} (${pressed.diff.lines.length} diff lines)`
            : `pressed @${step.ref}`;
        }
        if (
          step.x !== undefined &&
          step.y !== undefined &&
          Number.isFinite(step.x) &&
          Number.isFinite(step.y)
        ) {
          await this.tap({ x: step.x, y: step.y });
          return `tapped ${step.x},${step.y}`;
        }
        throw new Error('tap step requires testId, ref, or x and y');
      },
      swipe: async (step) => {
        await this.swipe(
          { x: step.fromX, y: step.fromY },
          { x: step.toX, y: step.toY },
          step.durationMs ?? 500,
        );
        return `swiped ${step.fromX},${step.fromY} -> ${step.toX},${step.toY}`;
      },
      typeText: async (step) => {
        await this.typeText(step.text);
        return `typed ${step.text.length} characters`;
      },
      back: async () => {
        await this.back();
        return 'pressed back';
      },
      deepLink: async (step) => {
        const result = await this.deepLink(step.uri);
        return `opened deep link ${result.uri}`;
      },
      reload: async (step) => {
        const result = await this.appReload({
          ...(step.fast ? { fast: true } : {}),
        });
        return `reloaded (mode: ${result.mode})`;
      },
      assert: async (step) => {
        const result = await this.assertElement(step);
        return result.passed
          ? `assert passed: ${JSON.stringify(step)}`
          : `FAILED assert: ${JSON.stringify(step)}`;
      },
      wait: async (step) => {
        await new Promise((resolve) => setTimeout(resolve, step.ms));
        return `waited ${step.ms}ms`;
      },
      screenshot: async () => {
        const shot = await this.screenshot();
        return shot.artifact.path;
      },
    });
    this.record('replay', {
      name: report.name,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
    });
    return report;
  }

  async deviceNetworkDelta(windowMs = 2_000): Promise<DeviceNetworkDelta> {
    const delta = await this.adb.deviceNetworkDelta(windowMs);
    this.record('device_network', delta);
    return delta;
  }

  async devtoolsExport(
    options: {
      metroUrl?: string;
      durationMs?: number;
    } = {},
  ): Promise<DevToolsExport> {
    const result = await collectDevToolsExport({
      appId: this.appId,
      artifactRoot: this.artifacts.root,
      ...options,
    });
    const artifact = this.artifacts.write(
      'devtools-export',
      JSON.stringify(result, null, 2),
      {
        ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
        extension: '.json',
        mimeType: 'application/json',
        name: 'devtools-export.json',
      },
    );
    this.sessions.artifact(this.activeSessionId, artifact);
    const exported: DevToolsExport = {
      ...result,
      artifactId: artifact.id,
    };
    this.record('devtools_export', {
      target: result.target,
      consoleEntryCount: result.consoleEntries.length,
      exceptionCount: result.exceptions.length,
      heapAvailable: result.heap.available,
      artifactId: artifact.id,
    });
    return exported;
  }

  async observeScreen(
    include: Array<
      | 'screenshot'
      | 'ui_tree'
      | 'route'
      | 'performance'
      | 'network'
      | 'logs'
      | 'app_state'
    > = [
      'screenshot',
      'ui_tree',
      'route',
      'performance',
      'network',
      'logs',
      'app_state',
    ],
  ): Promise<Observation> {
    const observation: Observation = {
      timestamp: new Date().toISOString(),
      route: null,
    };
    const logs = include.some((item) =>
      ['logs', 'route', 'network'].includes(item),
    )
      ? await this.getLogs({ limit: 2000 })
      : [];
    if (include.includes('screenshot')) {
      observation.screen = (await this.screenshot()).screen;
    }
    if (include.includes('ui_tree')) {
      const tree = await this.getUiTree();
      observation.uiTree = {
        elementCount: flattenUiTree(tree.roots).length,
        source: tree.source,
      };
    }
    if (include.includes('route')) observation.route = routeFromLogs(logs);
    if (include.includes('app_state')) {
      observation.appState = await this.getAppState();
    }
    if (include.includes('performance')) {
      observation.performance = await this.performanceSnapshot();
    }
    if (include.includes('network')) {
      observation.network = summarizeNetwork(networkRequestsFromLogs(logs));
    }
    if (include.includes('logs')) {
      observation.logs = {
        count: logs.length,
        errors: logs
          .filter(
            (entry) =>
              (entry.level === 'error' || entry.level === 'fatal') &&
              !/^\s*at\s/.test(entry.message),
          )
          .slice(-20),
      };
    }
    this.record('observation', observation);
    return observation;
  }

  startSession(): Session {
    if (this.activeSessionId) {
      throw new ObserverError(
        'SESSION_ALREADY_ACTIVE',
        `Session ${this.activeSessionId} is already active`,
        true,
      );
    }
    const session = this.sessions.start(this.projectRoot);
    this.activeSessionId = session.id;
    this.warnedWithoutSession = false;
    let resolvedAppId: string | undefined;
    try {
      resolvedAppId = this.appId;
    } catch {
      resolvedAppId = undefined;
    }
    this.sessions.event(session.id, 'session_context', {
      schemaVersion: '1.0',
      observerVersion: OBSERVER_VERSION,
      configSchemaVersion: this.config.schemaVersion,
      target: {
        platform: 'android',
        mode: this.config.target.mode,
        ...(resolvedAppId ? { appId: resolvedAppId } : {}),
        ...(this.adb.deviceId ? { deviceId: this.adb.deviceId } : {}),
      },
      packs: this.config.packs,
      securityMode: this.config.security.mode,
    });
    return this.sessions.get(session.id);
  }

  async stopSession(sessionId = this.activeSessionId): Promise<Session> {
    if (!sessionId) {
      throw new ObserverError(
        'SESSION_NOT_ACTIVE',
        'No session is active',
        true,
      );
    }
    if (this.sessions.get(sessionId).status !== 'active') {
      throw new ObserverError(
        'SESSION_NOT_ACTIVE',
        `Session ${sessionId} is not active`,
        true,
        'Start a new session or inspect the existing session',
      );
    }
    // Collect the final React/source/native model before exporting replay so
    // physical in-app interactions emitted by instrumentation are persisted.
    const priorActiveSessionId = this.activeSessionId;
    this.activeSessionId = sessionId;
    if (this.captureRuntimeUiOnStop) {
      try {
        await this.runtimeUiModel();
      } catch (error) {
        this.sessions.event(sessionId, 'runtime_ui_capture_failed', {
          error: asObserverError(error).toJSON(),
        });
      }
    }
    // Every session becomes a replay script automatically. This runs before
    // stop so the export event and artifact are part of the final summary.
    this.exportReplayScript(sessionId);
    const session = this.sessions.stop(sessionId);
    const summary = this.artifacts.write(
      'summary',
      JSON.stringify(
        {
          sessionId: session.id,
          projectRoot: session.projectRoot,
          startedAt: session.startedAt,
          stoppedAt: session.stoppedAt,
          status: session.status,
          eventCount: session.timeline.length,
          artifactCount: session.artifactIds.length,
          eventTypes: [...new Set(session.timeline.map((event) => event.type))],
        },
        null,
        2,
      ),
      {
        sessionId,
        extension: '.json',
        mimeType: 'application/json',
        name: 'summary.json',
      },
    );
    this.sessions.artifact(sessionId, summary);
    this.exportEvidenceGraph(sessionId);
    this.activeSessionId =
      priorActiveSessionId && priorActiveSessionId !== sessionId
        ? priorActiveSessionId
        : undefined;
    return this.sessions.get(sessionId);
  }

  getSession(sessionId: string): Session {
    return this.sessions.get(sessionId);
  }

  listSessions(
    options: { limit?: number; offset?: number } = {},
  ): SessionListEntry[] {
    return this.sessions.list(options);
  }

  getArtifact(artifactId: string): StoredArtifact {
    return this.sessions.getArtifact(artifactId);
  }

  /**
   * Builds a portable, metadata-first evidence bundle for one persisted
   * session. Sharing is opt-in at project level and outputs stay inside the
   * configured artifact root; the bundle writer never overwrites a file.
   */
  exportSessionShareBundle(
    sessionId: string,
    options: {
      relativePath?: string;
      includeTextArtifacts?: boolean;
    } = {},
  ): { bundle: ExportSessionShareBundleResult; artifact: Artifact } {
    if (!this.config.artifacts.allowShare) {
      throw new ObserverError(
        'SHARING_DISABLED',
        'Session sharing is disabled by this project configuration',
        true,
        'Set artifacts.allowShare to true only after reviewing the evidence you intend to share',
      );
    }
    const relativePath = options.relativePath ?? `shares/${sessionId}.rnobs`;
    if (!relativePath.toLowerCase().endsWith('.rnobs')) {
      throw new ObserverError(
        'BUNDLE_EXTENSION_INVALID',
        'Session share bundles must use the .rnobs extension',
        true,
      );
    }
    const session = this.sessions.get(sessionId);
    const outputPath = this.newArtifactOutputPath(
      relativePath,
      'session share output',
    );
    const bundle = writeSessionShareBundle(session, {
      artifactRoot: this.artifacts.root,
      outputPath,
      ...(options.includeTextArtifacts === undefined
        ? {}
        : { includeTextArtifacts: options.includeTextArtifacts }),
    });
    const artifact: Artifact = {
      id: randomUUID(),
      kind: 'share-bundle',
      path: bundle.path,
      mimeType:
        'application/vnd.rn-agent-observer.session-evidence-bundle+json',
      createdAt: new Date().toISOString(),
    };
    this.sessions.artifact(sessionId, artifact);
    this.sessions.event(sessionId, 'session_share_bundle', {
      artifactId: artifact.id,
      outcome: bundle.outcome,
      sha256: bundle.sha256,
      bytes: bundle.bytes,
      entryCount: bundle.entryCount,
      embeddedTextCount: bundle.embeddedTextCount,
      excludedCount: bundle.excludedCount,
    });
    return { bundle, artifact };
  }

  /**
   * Verifies a local bundle without extracting it. The MCP surface uses this
   * contained variant so a connected client cannot read arbitrary host paths.
   */
  verifySessionShareBundle(
    relativePath: string,
    expectedSha256?: string,
  ): VerifySessionShareBundleResult {
    const path = this.artifactRelativePath(
      relativePath,
      'session share bundle input',
    );
    return readAndVerifySessionShareBundle(path, {
      ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
    });
  }

  /** Persists an evidence-safe route/action coverage report for the current run. */
  analyzeRouteActionCoverage(input: unknown): {
    result: ActionCoverageResult;
    artifact: Artifact;
  } {
    const result = analyzeActionCoverage(input);
    const artifact = this.artifacts.write(
      'coverage-report',
      JSON.stringify(result, null, 2),
      {
        ...(this.activeSessionId ? { sessionId: this.activeSessionId } : {}),
        extension: '.json',
        mimeType: 'application/json',
        name: 'route-action-coverage.json',
      },
    );
    this.sessions.artifact(this.activeSessionId, artifact);
    this.record('coverage_analysis', {
      outcome: result.outcome,
      routeCount: result.counts.routes.total,
      actionCount: result.counts.actions.total,
      observableCount: result.counts.overall.observable,
      coveredCount: result.counts.overall.covered,
      evidenceCount: result.observations.usableEvidence,
      artifactId: artifact.id,
    });
    return { result, artifact };
  }

  getEvidenceGraph(
    sessionId: string,
    findings: readonly AssuranceFinding[] = [],
  ): EvidenceGraph {
    return buildEvidenceGraph({
      session: this.sessions.get(sessionId),
      findings,
    });
  }

  exportEvidenceGraph(
    sessionId: string,
    findings: readonly AssuranceFinding[] = [],
  ): { graph: EvidenceGraph; artifact: Artifact } {
    const graph = this.getEvidenceGraph(sessionId, findings);
    const artifact = this.artifacts.write(
      'evidence-graph',
      JSON.stringify(graph, null, 2),
      {
        sessionId,
        extension: '.json',
        mimeType: 'application/json',
        name: 'evidence-graph.json',
      },
    );
    this.sessions.artifact(sessionId, artifact);
    return { graph, artifact };
  }

  async diagnose(
    thresholdOverrides?: Partial<DiagnosisThresholds>,
  ): Promise<Diagnosis> {
    try {
      mergeThresholds(thresholdOverrides);
    } catch (error) {
      throw new ObserverError(
        'DIAGNOSIS_THRESHOLDS_INVALID',
        error instanceof Error ? error.message : String(error),
        true,
        'Use positive values; critical/high thresholds must be stricter than their warning thresholds',
      );
    }
    const [performance, logs] = await Promise.all([
      this.performanceSnapshot(),
      this.getLogs({ limit: 2000 }),
    ]);
    const diagnosis = diagnoseEvidence(
      {
        performance,
        network: networkRequestsFromLogs(logs),
        renders: renderStatsFromLogs(logs),
        logs,
      },
      thresholdOverrides,
    );
    this.record('diagnosis', diagnosis);
    return diagnosis;
  }

  compareScreens(
    before: string,
    after: string,
    uiTreePaths?: { before: string; after: string },
  ): ScreenComparison {
    const uiTrees = uiTreePaths
      ? {
          before: UITreeSchema.parse(
            JSON.parse(readFileSync(uiTreePaths.before, 'utf8')),
          ),
          after: UITreeSchema.parse(
            JSON.parse(readFileSync(uiTreePaths.after, 'utf8')),
          ),
        }
      : undefined;
    const comparison = comparePngFiles(before, after, this.artifacts, uiTrees);
    this.record('comparison', comparison);
    return comparison;
  }

  /**
   * Turns a recorded session timeline into a replayable script JSON.
   * Interaction events (tap/swipe/type_text/back/deep_link) become steps in
   * order; each step keeps a summary in `notes` for traceability.
   */
  exportReplayScript(sessionId: string): {
    script: ReplayScript;
    path: string;
    stepCount: number;
    skippedEventTypes: string[];
  } {
    const session = this.sessions.get(sessionId);
    const steps: ReplayStep[] = [];
    const skipped = new Set<string>();
    for (const event of session.timeline) {
      if (event.type === 'screenshot') {
        steps.push({ action: 'screenshot' });
        continue;
      }
      if (event.type === 'tap') {
        const data = event.data as {
          testId?: string;
          x?: number;
          y?: number;
          ref?: string;
          settleMs?: number;
        } | null;
        if (data?.testId) {
          steps.push({
            action: 'tap',
            testId: data.testId,
            ...(data.settleMs !== undefined ? { settleMs: data.settleMs } : {}),
          });
          continue;
        }
        if (
          data &&
          typeof data.x === 'number' &&
          typeof data.y === 'number' &&
          Number.isFinite(data.x) &&
          Number.isFinite(data.y)
        ) {
          steps.push({ action: 'tap', x: data.x, y: data.y });
          continue;
        }
        skipped.add('tap(unstructured)');
        continue;
      }
      if (event.type === 'app_interaction') {
        const data = event.data as {
          phase?: string;
          testId?: string | null;
        } | null;
        if (data?.phase === 'start' && data.testId) {
          steps.push({ action: 'tap', testId: data.testId });
        }
        continue;
      }
      if (event.type === 'swipe') {
        const data = event.data as {
          start?: { x: number; y: number };
          end?: { x: number; y: number };
          durationMs?: number;
        } | null;
        if (
          data?.start &&
          data?.end &&
          Number.isFinite(data.start.x) &&
          Number.isFinite(data.start.y) &&
          Number.isFinite(data.end.x) &&
          Number.isFinite(data.end.y)
        ) {
          steps.push({
            action: 'swipe',
            fromX: data.start.x,
            fromY: data.start.y,
            toX: data.end.x,
            toY: data.end.y,
            ...(data.durationMs !== undefined
              ? { durationMs: data.durationMs }
              : {}),
          });
          continue;
        }
        skipped.add('swipe(unstructured)');
        continue;
      }
      if (event.type === 'type_text') {
        // Session telemetry deliberately stores only the character count so
        // passwords/tokens cannot leak into SQLite or generated scripts.
        skipped.add('type_text(length-only)');
        continue;
      }
      if (event.type === 'back') {
        steps.push({ action: 'back' });
        continue;
      }
      if (event.type === 'deep_link') {
        const data = event.data as { uri?: unknown } | null;
        if (typeof data?.uri === 'string') {
          const redacted = redactDeepLinkEventData(event.data);
          steps.push({
            action: 'deep-link',
            uri: redacted.uri,
            redactedComponents: redacted.redactedComponents,
          });
        } else {
          skipped.add('deep_link(unstructured)');
        }
        continue;
      }
      if (event.type === 'reload') {
        const data = event.data as { mode?: string } | null;
        steps.push({
          action: 'reload',
          ...(data?.mode === 'metro' ? { fast: true } : {}),
        });
        continue;
      }
      // observation/evidence events are intentionally skipped
      skipped.add(event.type);
    }
    const script: ReplayScript = {
      name: `replay-${sessionId.slice(0, 8)}`,
      steps,
    };
    const artifact = this.artifacts.write(
      'summary',
      JSON.stringify(script, null, 2),
      {
        sessionId,
        extension: '.json',
        mimeType: 'application/json',
      },
    );
    this.sessions.artifact(sessionId, artifact);
    this.sessions.event(sessionId, 'replay_export', {
      sessionId,
      stepCount: steps.length,
      artifactId: artifact.id,
    });
    return {
      script,
      path: artifact.path,
      stepCount: steps.length,
      skippedEventTypes: [...skipped].sort(),
    };
  }

  /**
   * Deletes sessions and their artifacts older than the given number of
   * days. Returns counts; the SQLite metadata for removed sessions is
   * deleted too so the store stays consistent with disk.
   */
  cleanupArtifacts(
    options: { olderThanDays?: number; dryRun?: boolean } = {},
  ): {
    dryRun: boolean;
    olderThanDays: number;
    sessionsRemoved: number;
    artifactsRemoved: number;
    bytesFreed: number;
  } {
    this.artifacts.ensureSafeRoot();
    const olderThanDays = Math.max(
      0,
      options.olderThanDays ?? this.config.artifacts.retentionDays,
    );
    const dryRun = options.dryRun ?? false;
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1_000;
    const sessionsDirectory = join(this.artifacts.root, 'sessions');
    let sessionsRemoved = 0;
    let artifactsRemoved = 0;
    let bytesFreed = 0;
    const entries = (() => {
      try {
        const information = lstatSync(sessionsDirectory);
        if (information.isSymbolicLink() || !information.isDirectory()) {
          throw new ObserverError(
            'ARTIFACT_PATH_UNSAFE',
            'Refused cleanup because the artifact sessions directory is unsafe',
            true,
          );
        }
        return readdirSync(sessionsDirectory);
      } catch (error) {
        if (error instanceof ObserverError) throw error;
        return [];
      }
    })();
    for (const entry of entries) {
      const sessionPath = join(sessionsDirectory, entry);
      let stat;
      try {
        stat = lstatSync(sessionPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      if (this.sessions.status(entry) === 'active') continue;
      if (stat.mtimeMs < cutoff) {
        const directory = this.directoryStats(sessionPath);
        if (!directory.safe) continue;
        if (!dryRun) {
          rmSync(sessionPath, { recursive: true, force: true });
          this.sessions.deleteSession(entry);
        }
        sessionsRemoved += 1;
        artifactsRemoved += directory.files;
        bytesFreed += directory.bytes;
      }
    }
    return {
      dryRun,
      olderThanDays,
      sessionsRemoved,
      artifactsRemoved,
      bytesFreed,
    };
  }

  private directoryStats(path: string): {
    bytes: number;
    files: number;
    safe: boolean;
  } {
    let bytes = 0;
    let files = 0;
    try {
      for (const entry of readdirSync(path)) {
        const full = join(path, entry);
        const stat = lstatSync(full);
        if (stat.isSymbolicLink()) return { bytes: 0, files: 0, safe: false };
        if (stat.isDirectory()) {
          const nested = this.directoryStats(full);
          if (!nested.safe) return nested;
          bytes += nested.bytes;
          files += nested.files;
        } else {
          bytes += stat.size;
          files += 1;
        }
      }
    } catch {
      // unreadable entries contribute 0
    }
    return { bytes, files, safe: true };
  }
}

export { ObserverError, asObserverError };
export {
  type SessionListEntry,
  type StoredArtifact,
} from './session/session-store.js';
export {
  MAX_PERFORMANCE_SAMPLES,
  MAX_PERFORMANCE_BASELINE_BYTES,
  MIN_PERFORMANCE_SAMPLES,
  analyzePerformanceSamples,
  createPerformanceBaseline,
  loadPerformanceBaseline,
  runPerformanceExperiment,
  writePerformanceBaseline,
  type AnalyzePerformanceSamplesOptions,
  type PerformanceExperimentProgress,
  type RunPerformanceExperimentOptions,
} from './performance/experiment.js';
export {
  DEFAULT_PERFORMANCE_BUDGETS,
  loadPerformanceBudgets,
  runObserverPerformanceExperiment,
  type ObserverPerformanceExperimentOptions,
} from './performance/observer-experiment.js';
export * from './performance/android-startup.js';
export * from './performance/memory-growth.js';
export {
  OBSERVER_CONFIG_FILENAME,
  OBSERVER_CONFIG_SCHEMA_URL,
  OBSERVER_CONFIG_VERSION,
  OBSERVER_ACTION_RISKS,
  QUALITY_PACKS,
  authorizePersistentPermissionChange,
  authorizeObserverAction,
  authorizeSecurityAction,
  defaultObserverConfig,
  initObserverConfig,
  loadObserverConfig,
  parseObserverConfig,
  resolveArtifactRoot,
  type ActionRisk,
  type LoadedObserverConfig,
  type ObserverConfigInitResult,
  type ObserverAction,
  type ObserverMode,
  type ObserverProjectConfig,
  type QualityPack,
  type SecurityActionDecision,
  type SecurityMode,
} from './config/observer-config.js';
export {
  defaultDoctorProbes,
  parseAdbDevices,
  runDoctor,
  type CommandProbeResult,
  type DoctorCapabilities,
  type DoctorCheck,
  type DoctorCheckStatus,
  type DoctorOptions,
  type DoctorOverallStatus,
  type DoctorProbes,
  type DoctorReport,
  type MetroProbeResult,
} from './doctor/doctor.js';
export {
  analyzeAndroidManifest,
  analyzeNetworkSecurityConfig,
  type AndroidManifestAnalysisOptions,
  type NetworkSecurityConfigAnalysisOptions,
} from './security/android-manifest.js';
export {
  MAX_SECRET_SCAN_BYTES,
  scanSecrets,
  type SecretKind,
  type SecretMatch,
  type SecretScanOptions,
  type SecretScanResult,
} from './security/secret-scanner.js';
export {
  MAX_PASSIVE_AUDIT_BYTES,
  MAX_PASSIVE_AUDIT_FILES,
  runPassiveSecurityAudit,
  type PassiveSecurityAuditOptions,
  type PassiveSecurityAuditResult,
} from './security/passive-audit.js';
export {
  securityOutcome,
  type SecurityAnalysisResult,
} from './security/types.js';
export {
  renderSuiteReport,
  writeSuiteReports,
  type RenderedSuiteReport,
  type WrittenSuiteReport,
} from './suite/reporters.js';
export {
  MAX_SUITE_FILE_BYTES,
  loadSuiteDefinition,
  parseSuiteDefinition,
  type LoadedSuiteDefinition,
  type SuiteFileFormat,
} from './suite/loader.js';
export { observerSuiteCapabilities } from './suite/capabilities.js';
export {
  OBSERVER_SUITE_COMMANDS,
  createObserverSuiteExecutor,
  type ObserverSuiteCommand,
  type ObserverSuiteCommandDescriptor,
} from './suite/observer-executor.js';
export {
  BUILTIN_SUITES,
  getBuiltinSuite,
  listBuiltinSuites,
  type BuiltinSuiteName,
} from './suite/presets.js';
export {
  runSuite,
  type RunSuiteOptions,
  type SuiteAuthorization,
  type SuiteCommandContext,
  type SuiteCommandExecutor,
  type SuiteCommandResult,
  type SuiteRunProgress,
} from './suite/runner.js';
export {
  runObserverSuiteWorkflow,
  type ObserverSuiteWorkflowResult,
  type RunObserverSuiteWorkflowOptions,
} from './suite/workflow.js';
export * from './accessibility/index.js';
export * from './resilience/index.js';
export * from './plugins/index.js';
export * from './targets/index.js';
export * from './security/active-scenario.js';
export * from './security/observer-active-executor.js';
export * from './security/supply-chain.js';
export * from './dashboard/index.js';
