import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
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
    expect(session.schemaVersion).toBe('1.0');
    store.event(session.id, 'tap', { x: 10, y: 20 });
    const artifact = artifacts.write('summary', '{}', {
      sessionId: session.id,
    });
    expect(artifact.path).toMatch(/\.json$/);
    store.artifact(session.id, artifact);
    const stopped = store.stop(session.id);
    expect(stopped.status).toBe('complete');
    expect(stopped.timeline[0]).toMatchObject({
      schemaVersion: '1.0',
      type: 'tap',
      data: { x: 10, y: 20 },
    });
    expect(stopped.artifactIds).toEqual([artifact.id]);
    expect(store.list()).toEqual([
      expect.objectContaining({ id: session.id, status: 'complete' }),
    ]);
    expect(store.getArtifact(artifact.id)).toMatchObject({
      id: artifact.id,
      sessionId: session.id,
    });
    store.close();
  });

  it('redacts deep-link data before persistence and migrates historical rows', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-session-deep-link-'));
    temporaryDirectories.push(root);
    const artifactRoot = join(root, '.artifacts');
    const raw =
      'demo://alice:correct-horse@store.example/products/42?token=private-token#private-fragment';
    const store = new SessionStore(artifactRoot);
    const session = store.start(root);

    store.event(session.id, 'deep_link', {
      appId: 'dev.example.app',
      uri: raw,
      duplicateRawUri: raw,
    });
    expect(store.get(session.id).timeline[0]?.data).toEqual({
      appId: 'dev.example.app',
      uri: 'demo://store.example/products/42',
      redactedComponents: ['credentials', 'query', 'fragment'],
    });
    store.close();

    const databasePath = join(artifactRoot, 'observer.sqlite');
    const legacy = new Database(databasePath);
    legacy
      .prepare(
        'INSERT INTO events (session_id, type, timestamp, data_json) VALUES (?, ?, ?, ?)',
      )
      .run(
        session.id,
        'deep_link',
        '2026-08-23T00:00:00.000Z',
        JSON.stringify({ appId: 'dev.example.app', uri: raw }),
      );
    legacy.close();

    const migrated = new SessionStore(artifactRoot);
    const verifier = new Database(databasePath, { readonly: true });
    const persisted = verifier
      .prepare('SELECT data_json FROM events WHERE session_id = ? ORDER BY id')
      .all(session.id) as Array<{ data_json: string }>;
    expect(JSON.stringify(persisted)).not.toContain('alice');
    expect(JSON.stringify(persisted)).not.toContain('correct-horse');
    expect(JSON.stringify(persisted)).not.toContain('private-token');
    expect(JSON.stringify(persisted)).not.toContain('private-fragment');
    verifier.close();
    migrated.close();
  });
});
