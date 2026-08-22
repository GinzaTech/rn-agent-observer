import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ObserverCore, ObserverError } from './index.js';

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
      const stopped = await core.stopSession();
      const replayArtifact = stopped.artifacts.find(
        (artifact) =>
          artifact.kind === 'summary' &&
          !artifact.path.endsWith('summary.json'),
      );
      expect(replayArtifact).toBeDefined();
      const replay = JSON.parse(
        readFileSync(replayArtifact?.path ?? '', 'utf8'),
      ) as { steps: Array<{ action: string; testId?: string }> };
      expect(replay.steps).toEqual([
        { action: 'tap', testId: 'open-store' },
        { action: 'tap', testId: 'save-profile' },
      ]);
    } finally {
      core.sessions.close();
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
});
