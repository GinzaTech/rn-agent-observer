import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { expoRouterSitemap, hasAppDir } from './sitemap.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('expo-router sitemap', () => {
  it('derives routes with groups and private files excluded', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-sitemap-'));
    temporaryDirectories.push(root);
    const appDir = join(root, 'app');
    mkdirSync(join(appDir, '(tabs)'), { recursive: true });
    mkdirSync(join(appDir, 'profile'), { recursive: true });
    writeFileSync(join(appDir, '_layout.tsx'), 'export default () => null');
    writeFileSync(join(appDir, 'index.tsx'), 'export default () => null');
    writeFileSync(
      join(appDir, '(tabs)', 'settings.tsx'),
      'export default () => null',
    );
    writeFileSync(
      join(appDir, '(tabs)', '_layout.tsx'),
      'export default () => null',
    );
    writeFileSync(
      join(appDir, 'profile', 'index.js'),
      'export default () => null',
    );
    writeFileSync(join(appDir, 'notes.md'), 'notes');
    expect(expoRouterSitemap(root)).toEqual(['/', '/profile', '/settings']);
    expect(hasAppDir(root)).toBe(true);
    expect(hasAppDir(tmpdir())).toBe(false);
  });

  it('returns empty for projects without an app dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-noroutes-'));
    temporaryDirectories.push(root);
    expect(expoRouterSitemap(root)).toEqual([]);
  });
});
