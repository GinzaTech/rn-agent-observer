import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Artifact, Session } from '@rn-agent-observer/schemas';
import { ObserverError } from '../errors.js';
import {
  isDeepLinkSessionEventType,
  redactDeepLinkEventData,
} from '../privacy/deep-link.js';

interface SessionRow {
  id: string;
  project_root: string;
  started_at: string;
  stopped_at: string | null;
  status: Session['status'];
}

interface EventRow {
  id: number;
  type: string;
  timestamp: string;
  data_json: string;
}

interface ArtifactRow {
  id: string;
  kind: Artifact['kind'];
  path: string;
  mime_type: string | null;
  created_at: string;
}

interface ArtifactLookupRow extends ArtifactRow {
  session_id: string | null;
}

export interface SessionListEntry {
  id: string;
  projectRoot: string;
  startedAt: string;
  stoppedAt?: string;
  status: Session['status'];
}

export interface StoredArtifact extends Artifact {
  sessionId?: string;
}

export class SessionStore {
  private readonly database: Database.Database;

  constructor(artifactRoot: string) {
    mkdirSync(artifactRoot, { recursive: true });
    this.database = new Database(join(artifactRoot, 'observer.sqlite'));
    this.database.pragma('journal_mode = WAL');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_root TEXT NOT NULL,
        started_at TEXT NOT NULL,
        stopped_at TEXT,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        data_json TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        mime_type TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this.redactPersistedDeepLinkEvents();
  }

  start(projectRoot: string): Session {
    const session: Session = {
      schemaVersion: '1.0',
      id: randomUUID(),
      projectRoot,
      startedAt: new Date().toISOString(),
      status: 'active',
      artifactIds: [],
      artifacts: [],
      timeline: [],
    };
    this.database
      .prepare(
        'INSERT INTO sessions (id, project_root, started_at, status) VALUES (?, ?, ?, ?)',
      )
      .run(session.id, session.projectRoot, session.startedAt, session.status);
    return session;
  }

  stop(sessionId: string): Session {
    const stoppedAt = new Date().toISOString();
    const result = this.database
      .prepare(
        "UPDATE sessions SET stopped_at = ?, status = 'complete' WHERE id = ? AND status = 'active'",
      )
      .run(stoppedAt, sessionId);
    if (result.changes === 0) {
      throw new ObserverError(
        'SESSION_NOT_ACTIVE',
        `Session ${sessionId} is not active`,
        true,
        'Start a new session or inspect the existing session',
      );
    }
    return this.get(sessionId);
  }

  event(sessionId: string, type: string, data: unknown): void {
    const persistedData = isDeepLinkSessionEventType(type)
      ? redactDeepLinkEventData(data)
      : data;
    this.database
      .prepare(
        'INSERT INTO events (session_id, type, timestamp, data_json) VALUES (?, ?, ?, ?)',
      )
      .run(
        sessionId,
        type,
        new Date().toISOString(),
        JSON.stringify(persistedData),
      );
  }

  artifact(sessionId: string | undefined, artifact: Artifact): void {
    this.database
      .prepare(
        'INSERT OR REPLACE INTO artifacts (id, session_id, kind, path, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        artifact.id,
        sessionId ?? null,
        artifact.kind,
        artifact.path,
        artifact.mimeType ?? null,
        artifact.createdAt,
      );
  }

  get(sessionId: string): Session {
    const row = this.database
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as SessionRow | undefined;
    if (!row)
      throw new ObserverError(
        'SESSION_NOT_FOUND',
        `Session ${sessionId} was not found`,
        true,
      );
    const events = this.database
      .prepare(
        'SELECT id, type, timestamp, data_json FROM events WHERE session_id = ? ORDER BY id',
      )
      .all(sessionId) as EventRow[];
    const artifacts = this.database
      .prepare(
        'SELECT id, kind, path, mime_type, created_at FROM artifacts WHERE session_id = ? ORDER BY created_at',
      )
      .all(sessionId) as ArtifactRow[];
    return {
      schemaVersion: '1.0',
      id: row.id,
      projectRoot: row.project_root,
      startedAt: row.started_at,
      ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}),
      status: row.status,
      artifactIds: artifacts.map((artifact) => artifact.id),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        path: artifact.path,
        ...(artifact.mime_type ? { mimeType: artifact.mime_type } : {}),
        createdAt: artifact.created_at,
      })),
      timeline: events.map((event) => ({
        schemaVersion: '1.0',
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        data: isDeepLinkSessionEventType(event.type)
          ? redactDeepLinkEventData(JSON.parse(event.data_json) as unknown)
          : (JSON.parse(event.data_json) as unknown),
      })),
    };
  }

  status(sessionId: string): Session['status'] | undefined {
    const row = this.database
      .prepare('SELECT status FROM sessions WHERE id = ?')
      .get(sessionId) as Pick<SessionRow, 'status'> | undefined;
    return row?.status;
  }

  list(options: { limit?: number; offset?: number } = {}): SessionListEntry[] {
    const limit = Math.min(Math.max(1, options.limit ?? 20), 100);
    const offset = Math.max(0, options.offset ?? 0);
    const rows = this.database
      .prepare(
        'SELECT id, project_root, started_at, stopped_at, status FROM sessions ORDER BY started_at DESC LIMIT ? OFFSET ?',
      )
      .all(limit, offset) as SessionRow[];
    return rows.map((row) => ({
      id: row.id,
      projectRoot: row.project_root,
      startedAt: row.started_at,
      ...(row.stopped_at ? { stoppedAt: row.stopped_at } : {}),
      status: row.status,
    }));
  }

  getArtifact(artifactId: string): StoredArtifact {
    const row = this.database
      .prepare(
        'SELECT id, session_id, kind, path, mime_type, created_at FROM artifacts WHERE id = ?',
      )
      .get(artifactId) as ArtifactLookupRow | undefined;
    if (!row) {
      throw new ObserverError(
        'ARTIFACT_NOT_FOUND',
        `Artifact ${artifactId} was not found`,
        true,
      );
    }
    return {
      id: row.id,
      kind: row.kind,
      path: row.path,
      ...(row.mime_type ? { mimeType: row.mime_type } : {}),
      createdAt: row.created_at,
      ...(row.session_id ? { sessionId: row.session_id } : {}),
    };
  }

  deleteSession(sessionId: string): void {
    this.database.transaction(() => {
      this.database
        .prepare('DELETE FROM events WHERE session_id = ?')
        .run(sessionId);
      this.database
        .prepare('DELETE FROM artifacts WHERE session_id = ?')
        .run(sessionId);
      this.database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    })();
  }

  close(): void {
    this.database.close();
  }

  /**
   * Older observer versions wrote raw deep-link event data. Normalize it on
   * open so later replay/export calls cannot re-emit that historical value.
   */
  private redactPersistedDeepLinkEvents(): void {
    const events = this.database
      .prepare(
        'SELECT id, type, timestamp, data_json FROM events WHERE type IN (?, ?)',
      )
      .all('deep_link', 'deep-link') as EventRow[];
    const update = this.database.prepare(
      'UPDATE events SET data_json = ? WHERE id = ?',
    );
    this.database.transaction(() => {
      for (const event of events) {
        let data: unknown;
        try {
          data = JSON.parse(event.data_json) as unknown;
        } catch {
          data = undefined;
        }
        const redacted = JSON.stringify(redactDeepLinkEventData(data));
        if (redacted !== event.data_json) update.run(redacted, event.id);
      }
    })();
  }
}
