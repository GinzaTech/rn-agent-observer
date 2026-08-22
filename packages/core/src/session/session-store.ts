import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import type { Artifact, Session } from '@rn-agent-observer/schemas';
import { ObserverError } from '../errors.js';

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
  }

  start(projectRoot: string): Session {
    const session: Session = {
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
    this.database
      .prepare(
        'INSERT INTO events (session_id, type, timestamp, data_json) VALUES (?, ?, ?, ?)',
      )
      .run(sessionId, type, new Date().toISOString(), JSON.stringify(data));
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
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        data: JSON.parse(event.data_json) as unknown,
      })),
    };
  }

  close(): void {
    this.database.close();
  }
}
