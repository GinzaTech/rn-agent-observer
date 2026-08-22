import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import {
  ObserverStatusSchema,
  UITreeSchema,
  type AppState,
  type Artifact,
  type DeviceNetworkDelta,
  type DevToolsExport,
  type Diagnosis,
  type LogEntry,
  type NetworkRequest,
  type NetworkSummary,
  type Observation,
  type PerformanceSnapshot,
  type ReactRenderStat,
  type ScreenComparison,
  type ScreenSnapshot,
  type Session,
  type Trace,
  type UITree,
} from '@rn-agent-observer/schemas';
import { AdbClient } from './adb/adb-client.js';
import { flattenUiTree } from './adb/parsers.js';
import { ArtifactManager } from './artifacts/artifact-manager.js';
import { comparePngFiles } from './comparison/compare.js';
import { resolveAppId } from './config.js';
import { collectDevToolsExport } from './devtools/devtools-exporter.js';
import { collectMetroNetwork } from './devtools/metro-network.js';
import {
  reloadViaMetro,
  metroReloadUnavailableReason,
} from './devtools/metro-reload.js';
import { collectDevToolsProfile } from './devtools/profiler.js';
import { diagnoseEvidence } from './diagnosis/rules.js';
import { ObserverError, asObserverError } from './errors.js';
import {
  networkRequestsFromLogs,
  appDataFromLogs,
  jsTasksFromLogs,
  renderStatsFromLogs,
  routeFromLogs,
  summarizeNetwork,
  type AppDataEvent,
} from './network/network.js';
import { TraceManager } from './performance/trace-manager.js';
import {
  buildSnapshot,
  snapshotDiff,
  type SnapshotDiff,
  type UiSnapshot,
} from './refs/snapshot.js';
import {
  runReplayScript,
  type ReplayReport,
  type ReplayScript,
} from './replay/replay.js';
import { expoRouterSitemap, hasAppDir } from './routes/sitemap.js';
import { ScreenRecorder } from './recording/screen-recorder.js';
import { SessionStore } from './session/session-store.js';

export * from './adb/parsers.js';
export * from './diagnosis/rules.js';
export * from './errors.js';
export * from './network/network.js';
export * from './refs/snapshot.js';
export * from './replay/replay.js';
export * from './routes/sitemap.js';

export const OBSERVER_VERSION = '2.3.0';

export const IMPLEMENTED_COMMANDS = [
  'help',
  'status',
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
  'tap',
  'swipe',
  'type-text',
  'back',
  'deep-link',
  'permissions',
  'assert',
  'a11y-audit',
  'logs',
  'performance',
  'render-stats',
  'app-data',
  'routes',
  'network',
  'observe',
  'trace',
  'record',
  'replay',
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
}

export interface ScreenshotResult {
  artifact: Artifact;
  screen: ScreenSnapshot;
}

export interface AppReloadOptions {
  fast?: boolean;
  metroUrl?: string;
}

export class ObserverCore {
  readonly projectRoot: string;
  readonly adb: AdbClient;
  readonly artifacts: ArtifactManager;
  private sessionStore: SessionStore | undefined;
  private traceManager: TraceManager | undefined;
  private screenRecorder: ScreenRecorder | undefined;
  private readonly explicitAppId: string | undefined;
  private activeSessionId: string | undefined;

  constructor(options: ObserverCoreOptions = {}) {
    this.projectRoot = resolve(
      options.projectRoot ??
        process.env.RN_OBSERVER_PROJECT_ROOT ??
        process.cwd(),
    );
    const deviceId = options.deviceId ?? process.env.RN_OBSERVER_DEVICE_ID;
    this.adb = new AdbClient(deviceId, options.adbExecutable);
    this.explicitAppId = options.appId;
    this.artifacts = new ArtifactManager(
      this.projectRoot,
      options.artifactRoot,
    );
    this.activeSessionId =
      options.sessionId ?? process.env.RN_OBSERVER_SESSION_ID;
  }

  get sessions(): SessionStore {
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

  get appId(): string {
    return resolveAppId(this.projectRoot, this.explicitAppId);
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

  async appLaunch(): Promise<{ appId: string; launched: true }> {
    await this.adb.launch(this.appId);
    return { appId: this.appId, launched: true };
  }

  async appReload(options: AppReloadOptions = {}): Promise<{
    appId: string;
    reloaded: true;
    mode: 'app' | 'metro' | 'app-fallback';
    fallbackReason?: string;
  }> {
    if (options.fast) {
      try {
        await reloadViaMetro(options.metroUrl, this.appId);
        const result = {
          appId: this.appId,
          reloaded: true as const,
          mode: 'metro' as const,
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
    };
    this.record('reload', result);
    return result;
  }

  private record(type: string, data: unknown): void {
    if (this.activeSessionId) {
      this.sessions.event(this.activeSessionId, type, data);
    }
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
    const tree = await this.adb.uiTree();
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
    await this.adb.tap(target);
    this.record('tap', target);
    return { performed: true as const, target };
  }

  async swipe(
    start: { x: number; y: number },
    end: { x: number; y: number },
    durationMs = 500,
  ) {
    await this.adb.swipe(start, end, durationMs);
    const result = { performed: true as const, start, end, durationMs };
    this.record('swipe', result);
    return result;
  }

  async typeText(text: string) {
    await this.adb.typeText(text);
    this.record('type_text', { length: text.length });
    return { performed: true as const, characters: text.length };
  }

  async back() {
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
    const [snapshot, logs] = await Promise.all([
      this.adb.performance(this.appId),
      this.getLogs({ limit: 2000 }),
    ]);
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
    const trace = await this.traces.start(durationMs, this.activeSessionId);
    this.record('trace_started', trace);
    return trace;
  }

  async stopTrace(traceId: string): Promise<Trace> {
    const trace = await this.traces.stop(traceId);
    this.record('trace_stopped', trace);
    return trace;
  }

  async startRecording(durationMs = 10_000): Promise<Trace> {
    const recording = await this.recordings.start(
      durationMs,
      this.activeSessionId,
    );
    this.record('recording_started', recording);
    return recording;
  }

  async stopRecording(recordingId: string): Promise<Trace> {
    const recording = await this.recordings.stop(recordingId);
    this.record('recording_stopped', recording);
    return recording;
  }

  async metroNetworkSnapshot(
    options: {
      metroUrl?: string;
      durationMs?: number;
    } = {},
  ) {
    const snapshot = await collectMetroNetwork({
      appId: this.appId,
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
    return join(this.artifacts.root, 'snapshots', 'last.json');
  }

  private loadLastSnapshot(): UiSnapshot {
    try {
      return JSON.parse(
        readFileSync(this.snapshotStatePath(), 'utf8'),
      ) as UiSnapshot;
    } catch {
      throw new ObserverError(
        'SNAPSHOT_NOT_FOUND',
        'No snapshot has been taken yet',
        true,
        'Run snapshot first, then use refs from its output',
      );
    }
  }

  async snapshot(
    options: { interactiveOnly?: boolean } = {},
  ): Promise<UiSnapshot> {
    const tree = await this.getUiTree();
    const snap = buildSnapshot(tree, options);
    mkdirSync(dirname(this.snapshotStatePath()), { recursive: true });
    writeFileSync(this.snapshotStatePath(), JSON.stringify(snap));
    this.record('snapshot', {
      snapshotId: snap.snapshotId,
      elementCount: snap.elements.length,
      interactiveOnly: options.interactiveOnly ?? false,
    });
    return snap;
  }

  async press(
    ref: string,
    settleMs?: number,
  ): Promise<{
    performed: boolean;
    target: { ref: string; label: string; kind: string };
    diff?: SnapshotDiff;
  }> {
    const before = this.loadLastSnapshot();
    const element = before.elements.find((item) => item.ref === ref);
    if (!element) {
      throw new ObserverError(
        'REF_NOT_FOUND',
        `Snapshot ref "${ref}" was not found in the last snapshot`,
        true,
        'Run snapshot again and use refs from the latest output',
      );
    }
    if (element.testId) {
      await this.adb.tap({ testId: element.testId });
    } else if (element.bounds) {
      await this.adb.tap({
        x: Math.round(element.bounds.x + element.bounds.width / 2),
        y: Math.round(element.bounds.y + element.bounds.height / 2),
      });
    } else {
      throw new ObserverError(
        'REF_NOT_TAPPABLE',
        `Element "${ref}" has neither a test id nor bounds`,
        true,
        'Use tap --test-id or coordinates for this element',
      );
    }
    this.record('tap', { ref, label: element.label, kind: element.kind });
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
      const after = await this.snapshot();
      result.diff = snapshotDiff(before, after);
    }
    return result;
  }

  async deepLink(uri: string): Promise<{ appId: string; uri: string }> {
    await this.adb.deepLink(this.appId, uri);
    const result = { appId: this.appId, uri };
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
  ): Promise<{ appId: string; permission: string; granted: boolean }> {
    await this.adb.setPermission(this.appId, permission, granted);
    const result = { appId: this.appId, permission, granted };
    this.record('permission_changed', result);
    return result;
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
    issues: Array<{ className: string; bounds?: unknown }>;
  }> {
    const tree = await this.getUiTree();
    const interactive = flattenUiTree(tree.roots).filter(
      (element) => (element.clickable ?? false) && element.visible !== false,
    );
    const issues = interactive
      .filter(
        (element) =>
          !element.text && !element.contentDescription && !element.id,
      )
      .map((element) => ({
        className: element.className ?? element.type,
        ...(element.bounds ? { bounds: element.bounds } : {}),
      }));
    const result = {
      timestamp: new Date().toISOString(),
      totalInteractive: interactive.length,
      unlabeledCount: issues.length,
      issues,
    };
    this.record('a11y_audit', {
      totalInteractive: result.totalInteractive,
      unlabeledCount: result.unlabeledCount,
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
        await this.deepLink(step.uri);
        return `opened deep link ${step.uri}`;
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
    return session;
  }

  stopSession(sessionId = this.activeSessionId): Session {
    if (!sessionId) {
      throw new ObserverError(
        'SESSION_NOT_ACTIVE',
        'No session is active',
        true,
      );
    }
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
    if (this.activeSessionId === sessionId) this.activeSessionId = undefined;
    return this.sessions.get(sessionId);
  }

  getSession(sessionId: string): Session {
    return this.sessions.get(sessionId);
  }

  async diagnose(): Promise<Diagnosis> {
    const [performance, logs] = await Promise.all([
      this.performanceSnapshot(),
      this.getLogs({ limit: 2000 }),
    ]);
    const diagnosis = diagnoseEvidence({
      performance,
      network: networkRequestsFromLogs(logs),
      renders: renderStatsFromLogs(logs),
      logs,
    });
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
}

export { ObserverError, asObserverError };
