import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ObserverCore, ObserverError } from './index.js';

function createDirectoryLink(target: string, path: string): boolean {
  try {
    symlinkSync(
      target,
      path,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    if (code === 'EPERM' || code === 'EACCES') return false;
    throw error;
  }
}

describe('ObserverCore', () => {
  it('reports a normalized project root', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-status-'));
    try {
      const status = new ObserverCore({ projectRoot: root }).getStatus();
      expect(status.projectRoot).toBe(resolve(root));
      expect(status.plannedCommands).toEqual([]);
      expect(existsSync(join(root, '.artifacts'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serializes errors without a stack trace', () => {
    const error = new ObserverError('NOT_IMPLEMENTED', 'Not available', false);
    expect(JSON.stringify(error.toJSON())).not.toContain('stack');
  });

  it('warns instead of silently dropping timeline evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-warning-'));
    const warnings: string[] = [];
    try {
      const core = new ObserverCore({
        projectRoot: root,
        onWarning: (warning) => warnings.push(warning.code),
      });
      core.listRoutes();
      core.listRoutes();
      expect(warnings).toEqual(['EVIDENCE_NOT_RECORDED']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('automatically writes a safe replay artifact when a session stops', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-replay-'));
    const core = new ObserverCore({
      projectRoot: root,
      onWarning: () => {},
      captureRuntimeUiOnStop: false,
    });
    try {
      const session = core.startSession();
      core.sessions.event(session.id, 'tap', { testId: 'open-store' });
      core.sessions.event(session.id, 'app_interaction', {
        phase: 'start',
        testId: 'save-profile',
      });
      core.sessions.event(session.id, 'type_text', { length: 12 });
      core.sessions.event(session.id, 'deep_link', {
        appId: 'dev.example.app',
        uri: 'demo://alice:correct-horse@store.example/products/42?token=private-token#private-fragment',
      });
      const stopped = await core.stopSession();
      expect(
        stopped.artifacts.some(
          (artifact) => artifact.kind === 'evidence-graph',
        ),
      ).toBe(true);
      const replayArtifact = stopped.artifacts.find(
        (artifact) =>
          artifact.kind === 'summary' &&
          !artifact.path.endsWith('summary.json'),
      );
      expect(replayArtifact).toBeDefined();
      const replay = JSON.parse(
        readFileSync(replayArtifact?.path ?? '', 'utf8'),
      ) as {
        steps: Array<{
          action: string;
          testId?: string;
          uri?: string;
          redactedComponents?: string[];
        }>;
      };
      expect(replay.steps).toEqual([
        { action: 'tap', testId: 'open-store' },
        { action: 'tap', testId: 'save-profile' },
        {
          action: 'deep-link',
          uri: 'demo://store.example/products/42',
          redactedComponents: ['credentials', 'query', 'fragment'],
        },
      ]);
      expect(JSON.stringify(replay)).not.toContain('alice');
      expect(JSON.stringify(replay)).not.toContain('correct-horse');
      expect(JSON.stringify(replay)).not.toContain('private-token');
      expect(JSON.stringify(replay)).not.toContain('private-fragment');
    } finally {
      core.sessions.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns only redacted deep-link evidence to callers and replay reports', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-deep-link-'));
    const core = new ObserverCore({
      projectRoot: root,
      appId: 'dev.example.app',
      deviceId: 'emulator-5554',
      captureRuntimeUiOnStop: false,
      trustActiveConfig: true,
      onWarning: () => {},
    });
    const raw =
      'demo://alice:correct-horse@store.example/products/42?token=private-token#private-fragment';
    const opened = vi.spyOn(core.adb, 'deepLink').mockResolvedValue(undefined);
    try {
      core.config.security.mode = 'authorized-active';
      core.config.security.allowedActions = ['read', 'app-state'];
      core.config.security.allowedAppIds = ['dev.example.app'];
      core.config.target.deviceId = 'emulator-5554';
      const session = core.startSession();

      const result = await core.deepLink(raw);
      expect(opened).toHaveBeenCalledWith('dev.example.app', raw);
      expect(result).toEqual({
        appId: 'dev.example.app',
        uri: 'demo://store.example/products/42',
        redactedComponents: ['credentials', 'query', 'fragment'],
      });
      expect(JSON.stringify(result)).not.toContain('private-token');
      expect(JSON.stringify(core.getSession(session.id))).not.toContain(
        'private-token',
      );

      const scriptPath = join(root, 'caller-provided-replay.json');
      writeFileSync(
        scriptPath,
        JSON.stringify({ steps: [{ action: 'deep-link', uri: raw }] }),
        'utf8',
      );
      const report = await core.runReplay(scriptPath);
      expect(report.results[0]?.summary).toBe(
        'opened deep link demo://store.example/products/42',
      );
      expect(JSON.stringify(report)).not.toContain('private-token');
      expect(JSON.stringify(report)).not.toContain('private-fragment');

      opened.mockRejectedValueOnce(new Error(raw));
      let failure: unknown;
      try {
        await core.deepLink(raw);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: 'DEEP_LINK_FAILED' });
      expect((failure as Error).message).toBe(
        'Could not open deep link demo://store.example/products/42',
      );
      expect((failure as Error).message).not.toContain('private-token');
    } finally {
      core.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not correlate source with another app when the target is not foreground', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-runtime-ui-'));
    const core = new ObserverCore({
      projectRoot: root,
      appId: 'dev.example.app',
      deviceId: 'emulator-5554',
      onWarning: () => {},
    });
    const tree = vi.spyOn(core, 'getUiTree');
    vi.spyOn(core.adb, 'appState').mockResolvedValue({
      appId: 'dev.example.app',
      processRunning: true,
      pid: 42,
      foregroundActivity: 'com.android.launcher/.Launcher',
      appInForeground: false,
      source: 'adb-pidof+dumpsys-activity',
      timestamp: '2026-08-23T00:00:00.000Z',
    });
    try {
      const model = await core.runtimeUiModel();

      expect(model.availability).toEqual({
        status: 'target-not-foreground',
        reason: expect.stringContaining('cannot be attributed'),
      });
      expect(model.nodes).toEqual([]);
      expect(model.issues).toEqual([]);
      expect(tree).not.toHaveBeenCalled();
    } finally {
      core.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('retains verified runtime telemetry after logcat rolls over', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-telemetry-cache-'));
    const core = new ObserverCore({
      projectRoot: root,
      appId: 'dev.example.app',
      deviceId: 'emulator-5554',
      captureRuntimeUiOnStop: false,
      trustActiveConfig: true,
      onWarning: () => {},
    });
    try {
      core.config.security.mode = 'authorized-active';
      core.config.security.allowedActions = ['read', 'app-state'];
      core.config.security.allowedAppIds = ['dev.example.app'];
      core.config.target.deviceId = 'emulator-5554';
      const session = core.startSession();
      const timestamp = new Date().toISOString();
      vi.spyOn(core.adb, 'uiTree').mockResolvedValue({
        roots: [
          {
            type: 'android.widget.Button',
            text: 'Trigger JS task',
            id: 'trigger-js-block',
            clickable: true,
            children: [],
          },
        ],
        timestamp,
        source: 'test-uiautomator',
      });
      vi.spyOn(core.adb, 'tap').mockResolvedValue(undefined);
      vi.spyOn(core.adb, 'appState').mockResolvedValue({
        appId: 'dev.example.app',
        processRunning: true,
        pid: 42,
        foregroundActivity: 'dev.example.app/.MainActivity',
        appInForeground: true,
        source: 'adb-pidof+dumpsys-activity',
        timestamp,
      });
      vi.spyOn(core.adb, 'deviceInfo').mockRejectedValue(
        new Error('not required'),
      );
      const logs = vi.spyOn(core.adb, 'logs');
      logs.mockResolvedValueOnce({
        pidFilterApplied: true,
        processId: 42,
        entries: [
          {
            level: 'info',
            source: 'ReactNativeJS',
            timestamp,
            message: `RN_AGENT_OBSERVER_ROUTE {"route":"PerformanceLab","timestamp":"${timestamp}"}`,
          },
          {
            level: 'info',
            source: 'ReactNativeJS',
            timestamp,
            message: `RN_AGENT_OBSERVER_JS_TASK {"durationMs":100,"label":"intentional-block","timestamp":"${timestamp}","source":"rn-instrumentation"}`,
          },
          {
            level: 'info',
            source: 'ReactNativeJS',
            timestamp,
            message: `RN_AGENT_OBSERVER_NETWORK {"id":"request-1","method":"GET","url":"/fixture","status":200,"durationMs":25,"timestamp":"${timestamp}","source":"rn-instrumentation"}`,
          },
        ],
      });
      logs.mockResolvedValue({
        pidFilterApplied: true,
        processId: 42,
        entries: [],
      });
      vi.spyOn(core.adb, 'performance').mockResolvedValue({
        timestamp,
        metrics: [
          {
            name: 'js_blocking_ms',
            value: null,
            unit: 'ms',
            source: 'rn-instrumentation',
            timestamp,
            available: false,
            reason: 'No JS task is present in the current logcat window',
          },
        ],
      });
      vi.spyOn(core.adb, 'clockSkewMs').mockResolvedValue(null);

      const before = await core.snapshot();
      await core.press(before.elements[0]?.ref ?? '', 1);

      const performance = await core.performanceSnapshot();
      expect(
        performance.metrics.find((metric) => metric.name === 'js_blocking_ms'),
      ).toMatchObject({ available: true, value: 100 });
      expect(await core.getNetworkRequests()).toMatchObject([
        { id: 'request-1', durationMs: 25 },
      ]);
      const model = await core.runtimeUiModel();
      expect(model.route).toBe('PerformanceLab');
      expect(model.limitations).toContainEqual(
        expect.stringContaining('restored from the active session cache'),
      );
      expect(
        core
          .getSession(session.id)
          .timeline.some((event) => event.type === 'runtime_telemetry_capture'),
      ).toBe(true);
    } finally {
      core.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records an unavailable runtime UI model when stopping a session off-target', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-runtime-stop-'));
    const core = new ObserverCore({
      projectRoot: root,
      appId: 'dev.example.app',
      deviceId: 'emulator-5554',
      onWarning: () => {},
    });
    const tree = vi.spyOn(core, 'getUiTree');
    vi.spyOn(core.adb, 'appState').mockResolvedValue({
      appId: 'dev.example.app',
      processRunning: false,
      pid: null,
      foregroundActivity: 'com.android.launcher/.Launcher',
      appInForeground: false,
      source: 'adb-pidof+dumpsys-activity',
      timestamp: '2026-08-23T00:00:00.000Z',
    });
    try {
      const session = core.startSession();
      const stopped = await core.stopSession(session.id);
      const modelEvent = stopped.timeline.find(
        (event) => event.type === 'runtime_ui_model',
      );

      expect(modelEvent?.data).toMatchObject({
        availability: { status: 'target-not-running' },
        issueCodes: [],
      });
      expect(tree).not.toHaveBeenCalled();
    } finally {
      core.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleans completed artifacts but never an active session', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-cleanup-'));
    const core = new ObserverCore({
      projectRoot: root,
      onWarning: () => {},
      captureRuntimeUiOnStop: false,
    });
    try {
      const completed = core.startSession();
      await core.stopSession();
      const completedPath = join(root, '.artifacts', 'sessions', completed.id);
      const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000);
      utimesSync(completedPath, old, old);

      const active = core.startSession();
      core.artifacts.write('summary', '{}', { sessionId: active.id });
      const activePath = join(root, '.artifacts', 'sessions', active.id);
      utimesSync(activePath, old, old);

      const dryRun = core.cleanupArtifacts({
        olderThanDays: 1,
        dryRun: true,
      });
      expect(dryRun.sessionsRemoved).toBe(1);
      expect(dryRun.artifactsRemoved).toBeGreaterThan(0);
      expect(existsSync(completedPath)).toBe(true);

      const removed = core.cleanupArtifacts({ olderThanDays: 1 });
      expect(removed.sessionsRemoved).toBe(1);
      expect(existsSync(completedPath)).toBe(false);
      expect(existsSync(activePath)).toBe(true);
      expect(readdirSync(activePath).length).toBeGreaterThan(0);
      await core.stopSession();
    } finally {
      core.sessions.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses artifacts.retentionDays when cleanup has no explicit age', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-retention-'));
    writeFileSync(
      join(root, '.rn-observer.json'),
      JSON.stringify({
        schemaVersion: 1,
        target: {},
        packs: ['smoke'],
        artifacts: { retentionDays: 1 },
      }),
      'utf8',
    );
    const core = new ObserverCore({
      projectRoot: root,
      onWarning: () => {},
      captureRuntimeUiOnStop: false,
    });
    try {
      const completed = core.startSession();
      await core.stopSession();
      const completedPath = join(root, '.artifacts', 'sessions', completed.id);
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
      utimesSync(completedPath, old, old);

      const result = core.cleanupArtifacts({ dryRun: true });
      expect(result.olderThanDays).toBe(1);
      expect(result.sessionsRemoved).toBe(1);
      expect(existsSync(completedPath)).toBe(true);
    } finally {
      core.sessions.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses to open session storage after the artifact root becomes an escaping link', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-artifact-root-link-'));
    const outside = mkdtempSync(
      join(tmpdir(), 'rn-observer-artifact-outside-'),
    );
    const artifactRoot = join(root, '.artifacts');
    mkdirSync(artifactRoot);
    const core = new ObserverCore({ projectRoot: root, onWarning: () => {} });
    try {
      rmSync(artifactRoot, { recursive: true, force: true });
      if (!createDirectoryLink(outside, artifactRoot)) return;

      expect(() => core.startSession()).toThrow(/after resolving symlinks/i);
      expect(existsSync(join(outside, 'sessions'))).toBe(false);
    } finally {
      core.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips symlinked session entries during artifact cleanup', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-cleanup-link-'));
    const outside = mkdtempSync(join(tmpdir(), 'rn-observer-cleanup-outside-'));
    const sessionsDirectory = join(root, '.artifacts', 'sessions');
    mkdirSync(sessionsDirectory, { recursive: true });
    const sessionLink = join(sessionsDirectory, 'escaped-session');
    const core = new ObserverCore({ projectRoot: root, onWarning: () => {} });
    try {
      if (!createDirectoryLink(outside, sessionLink)) return;

      const result = core.cleanupArtifacts({ olderThanDays: 0 });
      expect(result.sessionsRemoved).toBe(0);
      expect(existsSync(sessionLink)).toBe(true);
      expect(existsSync(outside)).toBe(true);
    } finally {
      core.close();
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
