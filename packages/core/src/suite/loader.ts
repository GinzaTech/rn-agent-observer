import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  SuiteDefinitionSchema,
  type SuiteDefinition,
} from '@rn-agent-observer/schemas';
import { parseDocument } from 'yaml';

export const MAX_SUITE_FILE_BYTES = 1_048_576;

export type SuiteFileFormat = 'json' | 'yaml';

export interface LoadedSuiteDefinition {
  path: string;
  format: SuiteFileFormat;
  sha256: string;
  definition: SuiteDefinition;
}

const parseJson = (source: string): unknown => {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new TypeError(
      `Suite JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
};

const parseYaml = (source: string): unknown => {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    const message = document.errors.map((error) => error.message).join('; ');
    throw new TypeError(`Suite YAML is invalid: ${message}`, {
      cause: document.errors[0],
    });
  }
  return document.toJS({ maxAliasCount: 25 }) as unknown;
};

export const parseSuiteDefinition = (
  source: string,
  format: SuiteFileFormat,
): SuiteDefinition => {
  if (Buffer.byteLength(source, 'utf8') > MAX_SUITE_FILE_BYTES) {
    throw new RangeError(
      `Suite file exceeds ${MAX_SUITE_FILE_BYTES} byte safety limit`,
    );
  }
  return SuiteDefinitionSchema.parse(
    format === 'json' ? parseJson(source) : parseYaml(source),
  );
};

export const loadSuiteDefinition = async (
  suitePath: string,
): Promise<LoadedSuiteDefinition> => {
  const path = resolve(suitePath);
  const extension = extname(path).toLowerCase();
  const format: SuiteFileFormat =
    extension === '.yaml' || extension === '.yml' ? 'yaml' : 'json';
  if (!['.json', '.yaml', '.yml'].includes(extension)) {
    throw new TypeError('Suite file must use .json, .yaml, or .yml');
  }
  const source = await readFile(path, 'utf8');
  return {
    path,
    format,
    sha256: createHash('sha256').update(source).digest('hex'),
    definition: parseSuiteDefinition(source, format),
  };
};
