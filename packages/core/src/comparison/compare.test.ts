import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactManager } from '../artifacts/artifact-manager.js';
import { comparePngFiles, compareUiTrees } from './compare.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function image(path: string, changed: boolean): void {
  const png = new PNG({ width: 4, height: 4 });
  png.data.fill(255);
  if (changed) {
    const index = (2 * 4 + 2) * 4;
    png.data[index] = 0;
    png.data[index + 1] = 0;
    png.data[index + 2] = 0;
  }
  writeFileSync(path, PNG.sync.write(png));
}

describe('screen comparison', () => {
  it('reports changed pixels and a diff artifact', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-compare-'));
    temporaryDirectories.push(root);
    const before = join(root, 'before.png');
    const after = join(root, 'after.png');
    image(before, false);
    image(after, true);
    const result = comparePngFiles(
      before,
      after,
      new ArtifactManager(root, join(root, '.artifacts')),
    );
    expect(result.changedPixels).toBe(1);
    expect(result.similarity).toBe(15 / 16);
    expect(result.changedRegions).toEqual([
      { x: 2, y: 2, width: 1, height: 1 },
    ]);
  });

  it('reports semantic UI tree changes', () => {
    const base = {
      timestamp: '2026-08-21T00:00:00.000Z',
      source: 'test',
    };
    const result = compareUiTrees(
      {
        ...base,
        roots: [{ id: 'cta', type: 'Button', text: 'Buy', children: [] }],
      },
      {
        ...base,
        roots: [
          { id: 'cta', type: 'Button', text: 'Checkout', children: [] },
          { id: 'badge', type: 'Text', text: 'New', children: [] },
        ],
      },
    );
    expect(result).toMatchObject({
      beforeElementCount: 1,
      afterElementCount: 2,
      added: ['badge'],
      changed: ['cta'],
    });
  });

  it('masks declared dynamic regions and discloses the perceptual threshold', () => {
    const root = mkdtempSync(join(tmpdir(), 'rn-observer-compare-mask-'));
    temporaryDirectories.push(root);
    const before = join(root, 'before.png');
    const after = join(root, 'after.png');
    image(before, false);
    image(after, true);
    const result = comparePngFiles(
      before,
      after,
      new ArtifactManager(root, join(root, '.artifacts')),
      undefined,
      {
        perceptualThreshold: 0.2,
        ignoreRegions: [{ x: 2, y: 2, width: 1, height: 1 }],
      },
    );
    expect(result).toMatchObject({
      changedPixels: 0,
      ignoredPixels: 1,
      comparedPixels: 15,
      perceptualThreshold: 0.2,
      similarity: 1,
    });
  });
});
