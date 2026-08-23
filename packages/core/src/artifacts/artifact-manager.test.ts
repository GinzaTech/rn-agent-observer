import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactManager } from './artifact-manager.js';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'rn-observer-artifacts-'));
  temporaryDirectories.push(directory);
  return directory;
}

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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ArtifactManager', () => {
  it('creates a normal missing in-project artifact root on first write', () => {
    const projectRoot = temporaryDirectory();
    const root = join(projectRoot, '.evidence', 'run-artifacts');
    const artifacts = new ArtifactManager(projectRoot, root);

    expect(existsSync(root)).toBe(false);
    const artifact = artifacts.write('summary', '{"safe":true}', {
      sessionId: 'session-1',
      name: 'report.json',
    });

    expect(artifact.path).toBe(
      join(root, 'sessions', 'session-1', 'summaries', 'report.json'),
    );
    expect(readFileSync(artifact.path, 'utf8')).toBe('{"safe":true}');
  });

  it('rejects a configured artifact root that resolves through an escaping link', () => {
    const projectRoot = temporaryDirectory();
    const outside = temporaryDirectory();
    const link = join(projectRoot, 'linked-artifacts');
    if (!createDirectoryLink(outside, link)) return;

    expect(
      () => new ArtifactManager(projectRoot, join(link, 'next-run')),
    ).toThrow(/after resolving symlinks/i);
  });

  it('refuses symlink path components under an otherwise safe artifact root', () => {
    const projectRoot = temporaryDirectory();
    const outside = temporaryDirectory();
    const root = join(projectRoot, '.artifacts');
    mkdirSync(root);
    if (!createDirectoryLink(outside, join(root, 'sessions'))) return;
    const artifacts = new ArtifactManager(projectRoot, root);

    expect(() => artifacts.write('summary', '{}')).toThrow(
      /symbolic-link or file parents/i,
    );
    expect(existsSync(join(outside, 'standalone'))).toBe(false);
  });

  it('refuses traversal in caller-supplied session identifiers', () => {
    const projectRoot = temporaryDirectory();
    const artifacts = new ArtifactManager(projectRoot);

    expect(() => artifacts.sessionDirectory('../outside')).toThrow(
      /safe single path segment/i,
    );
  });
});
