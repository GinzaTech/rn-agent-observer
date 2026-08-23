import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveContainedReadFile,
  resolveNewArtifactOutputFile,
} from './path-authority.js';

const roots: string[] = [];
const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir';

const symlinkUnavailable = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['EACCES', 'ENOSYS', 'ENOTSUP', 'EPERM'].includes(String(error.code)),
  );

const canCreateDirectoryLink = (): boolean => {
  const root = mkdtempSync(join(tmpdir(), 'rnobs-path-authority-link-'));
  try {
    const target = join(root, 'target');
    mkdirSync(target);
    symlinkSync(target, join(root, 'link'), directoryLinkType);
    return true;
  } catch (error) {
    if (symlinkUnavailable(error)) return false;
    throw error;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const supportsDirectoryLinks = canCreateDirectoryLink();

const temporaryDirectory = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'rnobs-path-authority-'));
  roots.push(root);
  return root;
};

/**
 * On Windows CI the temp directory uses 8.3 short names (RUNNER~1) while
 * production code canonicalizes to the long name (runneradmin). Only
 * realpathSync.native expands 8.3 components, so compare native paths.
 */
const realPath = (value: string): string => realpathSync.native(value);

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('filesystem path authority', () => {
  it('allows only existing physical regular files below the project root', () => {
    const projectRoot = temporaryDirectory();
    const outsideRoot = temporaryDirectory();
    const inputDirectory = join(projectRoot, 'inputs');
    const input = join(inputDirectory, 'budget.json');
    const outside = join(outsideRoot, 'outside.json');
    mkdirSync(inputDirectory);
    mkdirSync(join(projectRoot, 'directory'));
    writeFileSync(input, '{}');
    writeFileSync(outside, '{}');

    expect(
      realPath(resolveContainedReadFile(projectRoot, 'inputs/budget.json')),
    ).toBe(realPath(input));
    expect(() =>
      resolveContainedReadFile(projectRoot, 'does-not-exist.json'),
    ).toThrow('existing regular file');
    expect(() => resolveContainedReadFile(projectRoot, 'directory')).toThrow(
      'existing regular file',
    );
    expect(() =>
      resolveContainedReadFile(projectRoot, relative(projectRoot, outside)),
    ).toThrow('inside the project root');
  });

  it.skipIf(!supportsDirectoryLinks)(
    'rejects a directory symlink that escapes the project root',
    () => {
      const projectRoot = temporaryDirectory();
      const outsideRoot = temporaryDirectory();
      const outside = join(outsideRoot, 'outside.json');
      writeFileSync(outside, '{}');
      symlinkSync(
        outsideRoot,
        join(projectRoot, 'outside-link'),
        directoryLinkType,
      );

      expect(() =>
        resolveContainedReadFile(projectRoot, 'outside-link/outside.json'),
      ).toThrow('inside the project root');
    },
  );

  it('creates only a new relative output below the configured artifact root', () => {
    const projectRoot = temporaryDirectory();
    const outsideRoot = temporaryDirectory();
    const artifactRoot = join(projectRoot, '.artifacts');
    const output = resolveNewArtifactOutputFile(
      projectRoot,
      artifactRoot,
      'baselines/initial.json',
    );

    expect(join(realPath(dirname(output)), basename(output))).toBe(
      join(
        realPath(dirname(join(artifactRoot, 'baselines', 'initial.json'))),
        'initial.json',
      ),
    );
    writeFileSync(output, 'existing');
    expect(() =>
      resolveNewArtifactOutputFile(
        projectRoot,
        artifactRoot,
        'baselines/initial.json',
      ),
    ).toThrow('new file');
    expect(() =>
      resolveNewArtifactOutputFile(
        projectRoot,
        artifactRoot,
        '../outside.json',
      ),
    ).toThrow('without traversal');
    expect(() =>
      resolveNewArtifactOutputFile(
        projectRoot,
        artifactRoot,
        'baselines/../outside.json',
      ),
    ).toThrow('without traversal');
    expect(() =>
      resolveNewArtifactOutputFile(
        projectRoot,
        artifactRoot,
        join(outsideRoot, 'outside.json'),
      ),
    ).toThrow('relative path');
  });

  it.skipIf(!supportsDirectoryLinks)(
    'rejects an artifact output whose parent is a directory symlink',
    () => {
      const projectRoot = temporaryDirectory();
      const outsideRoot = temporaryDirectory();
      const artifactRoot = join(projectRoot, '.artifacts');
      mkdirSync(artifactRoot);
      symlinkSync(
        outsideRoot,
        join(artifactRoot, 'outside-link'),
        directoryLinkType,
      );

      expect(() =>
        resolveNewArtifactOutputFile(
          projectRoot,
          artifactRoot,
          'outside-link/baseline.json',
        ),
      ).toThrow('symbolic-link');
    },
  );
});
