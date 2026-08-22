import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactManager } from '../artifacts/artifact-manager.js';
import { SessionStore } from './session-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('session persistence', () => {
  it('persists timeline and artifact references in SQLite', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-session-'));
    temporaryDirectories.push(root);
    const artifacts = new ArtifactManager(root, join(root, '.artifacts'));
    const store = new SessionStore(artifacts.root);
    const session = store.start(root);
    store.event(session.id, 'tap', { x: 10, y: 20 });
    const artifact = artifacts.write('summary', '{}', {
      sessionId: session.id,
    });
    expect(artifact.path).toMatch(/\.json$/);
    store.artifact(session.id, artifact);
    const stopped = store.stop(session.id);
    expect(stopped.status).toBe('complete');
    expect(stopped.timeline[0]).toMatchObject({
      type: 'tap',
      data: { x: 10, y: 20 },
    });
    expect(stopped.artifactIds).toEqual([artifact.id]);
    store.close();
  });
});
