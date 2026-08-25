import { lstatSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { ObserverError } from '../errors.js';

const pathError = (message: string): ObserverError =>
  new ObserverError('FILE_PATH_NOT_AUTHORIZED', message, true);

const isContained = (root: string, candidate: string): boolean => {
  const relation = relative(root, candidate);
  return (
    relation === '' ||
    (!isAbsolute(relation) &&
      !win32.isAbsolute(relation) &&
      relation !== '..' &&
      !relation.startsWith(`..${sep}`) &&
      !relation.startsWith('../') &&
      !relation.startsWith('..\\'))
  );
};

const existingLstat = (path: string) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined;
    }
    throw error;
  }
};

const existingDirectory = (path: string, label: string): string => {
  let resolved: string;
  try {
    resolved = realpathSync.native(resolve(path));
  } catch {
    throw pathError(`${label} must be an existing directory`);
  }
  let statistics;
  try {
    statistics = statSync(resolved);
  } catch {
    throw pathError(`${label} must be an existing directory`);
  }
  if (!statistics.isDirectory()) {
    throw pathError(`${label} must be an existing directory`);
  }
  return resolved;
};

const hasTraversalSegment = (path: string): boolean =>
  path.split(/[\\/]+/u).includes('..');

const validateRelativeOutputPath = (path: string, label: string): void => {
  if (
    !path.trim() ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    hasTraversalSegment(path)
  ) {
    throw pathError(
      `${label} must be a non-empty relative path without traversal`,
    );
  }
};

const ensureDirectoryChild = (
  parent: string,
  segment: string,
  label: string,
): string => {
  const child = join(parent, segment);
  const existing = existingLstat(child);
  if (existing) {
    if (existing.isSymbolicLink() || !existing.isDirectory()) {
      throw pathError(
        `${label} has a symbolic-link or non-directory parent and was refused`,
      );
    }
    return child;
  }
  try {
    mkdirSync(child);
  } catch {
    const afterCreate = existingLstat(child);
    if (
      afterCreate &&
      !afterCreate.isSymbolicLink() &&
      afterCreate.isDirectory()
    ) {
      return child;
    }
    throw pathError(`${label} parent directory could not be created safely`);
  }
  return child;
};

const safeRelativeSegments = (path: string): string[] =>
  path.split(/[\\/]+/u).filter(Boolean);

/**
 * Resolves a caller-supplied input only when its real filesystem target is a
 * regular file inside the physical project root. This is deliberately stricter
 * than lexical path checks so a symlink to a file outside the project is not
 * accepted.
 */
export function resolveContainedReadFile(
  projectRoot: string,
  requestedPath: string,
  label = 'input path',
): string {
  if (!requestedPath.trim()) {
    throw pathError(`${label} must name an existing regular file`);
  }
  const root = existingDirectory(projectRoot, 'project root');
  let resolved: string;
  try {
    resolved = realpathSync.native(resolve(root, requestedPath));
  } catch {
    throw pathError(
      `${label} must name an existing regular file inside the project root`,
    );
  }
  if (!isContained(root, resolved)) {
    throw pathError(`${label} must resolve inside the project root`);
  }
  let statistics;
  try {
    statistics = statSync(resolved);
  } catch {
    throw pathError(
      `${label} must name an existing regular file inside the project root`,
    );
  }
  if (!statistics.isFile()) {
    throw pathError(
      `${label} must name an existing regular file inside the project root`,
    );
  }
  return resolved;
}

/**
 * Creates only safe directory parents under the configured artifact root and
 * returns a not-yet-existing output file path. The caller must still use an
 * exclusive create when writing to retain the no-overwrite guarantee.
 */
export function resolveNewArtifactOutputFile(
  projectRoot: string,
  artifactRoot: string,
  requestedPath: string,
  label = 'output path',
): string {
  validateRelativeOutputPath(requestedPath, label);

  const configuredProjectRoot = resolve(projectRoot);
  const physicalProjectRoot = existingDirectory(
    configuredProjectRoot,
    'project root',
  );
  const configuredArtifactRoot = resolve(artifactRoot);
  if (!isContained(configuredProjectRoot, configuredArtifactRoot)) {
    throw pathError(
      'configured artifact root must stay inside the project root',
    );
  }

  let physicalArtifactRoot = physicalProjectRoot;
  for (const segment of safeRelativeSegments(
    relative(configuredProjectRoot, configuredArtifactRoot),
  )) {
    physicalArtifactRoot = ensureDirectoryChild(
      physicalArtifactRoot,
      segment,
      label,
    );
  }

  const candidate = resolve(physicalArtifactRoot, requestedPath);
  if (
    candidate === physicalArtifactRoot ||
    !isContained(physicalArtifactRoot, candidate)
  ) {
    throw pathError(`${label} must remain inside the configured artifact root`);
  }

  let parent = physicalArtifactRoot;
  for (const segment of safeRelativeSegments(
    relative(physicalArtifactRoot, dirname(candidate)),
  )) {
    parent = ensureDirectoryChild(parent, segment, label);
  }
  const output = join(parent, basename(candidate));
  if (existingLstat(output)) {
    throw pathError(`${label} must name a new file and cannot overwrite data`);
  }
  return output;
}

/**
 * Resolves a new user-authored project file without permitting traversal,
 * symlink parents, or overwrite. This is intentionally separate from artifact
 * output because suite definitions are source files that users normally commit.
 */
export function resolveNewProjectOutputFile(
  projectRoot: string,
  requestedPath: string,
  label = 'project output path',
): string {
  validateRelativeOutputPath(requestedPath, label);
  const root = existingDirectory(projectRoot, 'project root');
  const candidate = resolve(root, requestedPath);
  if (candidate === root || !isContained(root, candidate)) {
    throw pathError(`${label} must remain inside the project root`);
  }

  let parent = root;
  for (const segment of safeRelativeSegments(
    relative(root, dirname(candidate)),
  )) {
    parent = ensureDirectoryChild(parent, segment, label);
  }
  const output = join(parent, basename(candidate));
  if (existingLstat(output)) {
    throw pathError(`${label} must name a new file and cannot overwrite data`);
  }
  return output;
}
