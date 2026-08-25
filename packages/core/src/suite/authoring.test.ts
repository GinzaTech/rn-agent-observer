import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createStarterSuite,
  inspectSuiteFile,
  writeStarterSuite,
} from './authoring.js';

describe('suite authoring', () => {
  it('creates validated smoke and performance definitions', () => {
    expect(createStarterSuite('smoke')).toMatchObject({
      metadata: { id: 'project.smoke' },
      reporters: ['json', 'html', 'junit', 'sarif', 'github'],
    });
    expect(createStarterSuite('performance')).toMatchObject({
      metadata: { id: 'project.performance' },
    });
  });

  it('writes a contained non-overwriting YAML suite and inspects it offline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-suite-authoring-'));
    try {
      const result = await writeStarterSuite(
        root,
        '.rn-observer/suites/smoke.yaml',
        'smoke',
      );
      const path = join(root, '.rn-observer', 'suites', 'smoke.yaml');
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toContain(
        'apiVersion: rn-observer/v1alpha1',
      );
      expect(result).toMatchObject({
        valid: true,
        suite: {
          id: 'project.smoke',
          steps: 3,
          assertions: 4,
          risks: ['read'],
        },
      });
      await expect(inspectSuiteFile(root, path)).resolves.toEqual(result);
      await expect(
        writeStarterSuite(root, '.rn-observer/suites/smoke.yaml', 'smoke'),
      ).rejects.toMatchObject({ code: 'FILE_PATH_NOT_AUTHORIZED' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal and unsupported output formats', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-suite-output-'));
    try {
      await expect(
        writeStarterSuite(root, '../outside.yaml', 'smoke'),
      ).rejects.toMatchObject({ code: 'FILE_PATH_NOT_AUTHORIZED' });
      await expect(
        writeStarterSuite(root, 'suite.txt', 'smoke'),
      ).rejects.toThrow(/\.json, \.yaml, or \.yml/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
