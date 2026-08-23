import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  PluginManifestError,
  parsePluginManifest,
  type PluginManifest,
} from './manifest.js';

export const DEFAULT_PLUGIN_MANIFEST_MAX_BYTES = 64 * 1024;
export const MAX_PLUGIN_MANIFEST_MAX_BYTES = 1024 * 1024;

export interface LoadedPluginManifest {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly manifest: PluginManifest;
}

const contained = (root: string, candidate: string): boolean => {
  const relation = relative(root, candidate);
  return (
    relation === '' ||
    (!isAbsolute(relation) &&
      relation !== '..' &&
      !relation.startsWith(`..${sep}`))
  );
};

export function loadPluginManifestFile(
  projectRoot: string,
  path: string,
  options: { readonly maxBytes?: number } = {},
): LoadedPluginManifest {
  const maximum = options.maxBytes ?? DEFAULT_PLUGIN_MANIFEST_MAX_BYTES;
  if (
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > MAX_PLUGIN_MANIFEST_MAX_BYTES
  ) {
    throw new RangeError(
      `maxBytes must be an integer from 1 to ${MAX_PLUGIN_MANIFEST_MAX_BYTES}`,
    );
  }
  const root = realpathSync.native(resolve(projectRoot));
  const requested = resolve(root, path);
  let resolved: string;
  try {
    resolved = realpathSync.native(requested);
  } catch (error) {
    throw new TypeError(
      `Plugin manifest cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!contained(root, resolved)) {
    throw new TypeError('Plugin manifest must resolve inside projectRoot');
  }
  const statistics = statSync(resolved);
  if (!statistics.isFile())
    throw new TypeError('Plugin manifest must be a file');
  if (statistics.size > maximum) {
    throw new RangeError(
      `Plugin manifest is ${statistics.size} bytes; limit is ${maximum}`,
    );
  }
  const bytes = readFileSync(resolved);
  let input: unknown;
  try {
    input = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new PluginManifestError([
      {
        path: 'manifest',
        code: 'invalid_json',
        message: 'must contain valid JSON',
      },
    ]);
  }
  return {
    path: resolved,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
    manifest: parsePluginManifest(input),
  };
}
