import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Artifact } from '@rn-agent-observer/schemas';

function safeTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-');
}

export class ArtifactManager {
  readonly root: string;

  constructor(projectRoot: string, artifactRoot?: string) {
    this.root = resolve(artifactRoot ?? join(projectRoot, '.artifacts'));
  }

  sessionDirectory(sessionId = 'standalone'): string {
    const directory = join(this.root, 'sessions', sessionId);
    mkdirSync(directory, { recursive: true });
    return directory;
  }

  write(
    kind: Artifact['kind'],
    data: string | Buffer,
    options: {
      sessionId?: string;
      extension?: string;
      mimeType?: string;
      name?: string;
    } = {},
  ): Artifact {
    const id = randomUUID();
    const extension =
      options.extension ?? (typeof data === 'string' ? '.json' : '.bin');
    const category = kind === 'summary' ? 'summaries' : `${kind}s`;
    const directory = join(this.sessionDirectory(options.sessionId), category);
    mkdirSync(directory, { recursive: true });
    const base = options.name
      ? options.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      : `${safeTimestamp()}-${id}`;
    const filename =
      options.name && extname(base) ? base : `${base}${extension}`;
    const path = join(directory, filename);
    writeFileSync(path, data);
    return {
      id,
      kind,
      path,
      ...(options.mimeType ? { mimeType: options.mimeType } : {}),
      createdAt: new Date().toISOString(),
    };
  }
}
