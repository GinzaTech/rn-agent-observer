import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Artifact } from '@rn-agent-observer/schemas';
import { resolveContainedArtifactRoot } from '../config/observer-config.js';

function safeTimestamp(): string {
  return new Date().toISOString().replaceAll(':', '-');
}

function errorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

function assertPathSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new TypeError(`${label} must be a safe single path segment`);
  }
}

export class ArtifactManager {
  readonly root: string;
  private readonly projectRoot: string;

  constructor(projectRoot: string, artifactRoot?: string) {
    this.projectRoot = resolve(projectRoot);
    this.root = resolveContainedArtifactRoot(
      this.projectRoot,
      artifactRoot ?? join(this.projectRoot, '.artifacts'),
    );
  }

  /** Ensures the root is still contained before another component writes in it. */
  ensureSafeRoot(): void {
    // Revalidate before each write. This catches a root that was replaced with
    // an escaping link after construction, while allowing the usual missing
    // `.artifacts` directory to be created on first use.
    resolveContainedArtifactRoot(this.projectRoot, this.root);
    mkdirSync(this.root, { recursive: true });
    resolveContainedArtifactRoot(this.projectRoot, this.root);
  }

  private containedDirectory(
    segments: readonly string[],
    label: string,
  ): string {
    this.ensureSafeRoot();
    let directory = this.root;
    for (const segment of segments) {
      assertPathSegment(segment, label);
      const candidate = join(directory, segment);
      let information;
      try {
        information = lstatSync(candidate);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          throw new TypeError(`${label} could not be inspected safely`, {
            cause: error,
          });
        }
        try {
          mkdirSync(candidate);
        } catch (mkdirError) {
          if (errorCode(mkdirError) !== 'EEXIST') {
            throw new TypeError(`${label} could not be created safely`, {
              cause: mkdirError,
            });
          }
        }
        try {
          information = lstatSync(candidate);
        } catch (statError) {
          throw new TypeError(`${label} could not be inspected safely`, {
            cause: statError,
          });
        }
      }
      if (information.isSymbolicLink() || !information.isDirectory()) {
        throw new TypeError(`${label} must not contain symbolic-link or file parents`);
      }
      directory = candidate;
    }
    return directory;
  }

  private assertSafeDestination(path: string): void {
    try {
      const information = lstatSync(path);
      if (information.isSymbolicLink() || information.isDirectory()) {
        throw new TypeError(
          'Artifact destination must not be a symbolic link or directory',
        );
      }
    } catch (error) {
      if (error instanceof TypeError || errorCode(error) !== 'ENOENT') {
        throw error;
      }
    }
  }

  sessionDirectory(sessionId = 'standalone'): string {
    return this.containedDirectory(['sessions', sessionId], 'Artifact path');
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
    const directory = this.containedDirectory(
      ['sessions', options.sessionId ?? 'standalone', category],
      'Artifact path',
    );
    const base = options.name
      ? options.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      : `${safeTimestamp()}-${id}`;
    const filename =
      options.name && extname(base) ? base : `${base}${extension}`;
    assertPathSegment(filename, 'Artifact filename');
    const path = join(directory, filename);
    this.assertSafeDestination(path);
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
