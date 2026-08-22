import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type {
  ScreenComparison,
  UIElement,
  UITree,
} from '@rn-agent-observer/schemas';
import { ArtifactManager } from '../artifacts/artifact-manager.js';
import { ObserverError } from '../errors.js';

export function comparePngFiles(
  beforePath: string,
  afterPath: string,
  artifacts = new ArtifactManager(dirname(beforePath)),
  uiTrees?: { before: UITree; after: UITree },
): ScreenComparison {
  const before = PNG.sync.read(readFileSync(beforePath));
  const after = PNG.sync.read(readFileSync(afterPath));
  if (before.width !== after.width || before.height !== after.height) {
    throw new ObserverError(
      'DIMENSION_MISMATCH',
      `Images differ in dimensions: ${before.width}x${before.height} vs ${after.width}x${after.height}`,
      true,
      'Capture both screenshots on the same device and orientation',
    );
  }
  const diff = new PNG({ width: before.width, height: before.height });
  const changedPixels = pixelmatch(
    before.data,
    after.data,
    diff.data,
    before.width,
    before.height,
    {
      threshold: 0.1,
    },
  );
  let minX = before.width;
  let minY = before.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < diff.data.length; index += 4) {
    if (
      (diff.data[index] ?? 0) > 0 &&
      (diff.data[index + 1] ?? 0) === 0 &&
      (diff.data[index + 2] ?? 0) === 0
    ) {
      const pixel = index / 4;
      const x = pixel % before.width;
      const y = Math.floor(pixel / before.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const diffArtifact = artifacts.write('screenshot', PNG.sync.write(diff), {
    extension: '.png',
    mimeType: 'image/png',
    name: 'comparison-diff.png',
  });
  const total = before.width * before.height;
  return {
    before: beforePath,
    after: afterPath,
    dimensions: { width: before.width, height: before.height },
    similarity: total ? 1 - changedPixels / total : 1,
    changedPixels,
    changedRegions:
      maxX >= 0
        ? [
            {
              x: minX,
              y: minY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
            },
          ]
        : [],
    diffArtifact: diffArtifact.path,
    ...(uiTrees
      ? { uiStructure: compareUiTrees(uiTrees.before, uiTrees.after) }
      : {}),
  };
}

function flatten(elements: UIElement[]): UIElement[] {
  return elements.flatMap((element) => [element, ...flatten(element.children)]);
}

function semanticKey(element: UIElement, index: number): string {
  return (
    element.resourceId ??
    element.id ??
    element.contentDescription ??
    element.text ??
    `${element.type}#${index}`
  );
}

function structuralValue(element: UIElement): string {
  return JSON.stringify({
    type: element.type,
    text: element.text ?? null,
    contentDescription: element.contentDescription ?? null,
    bounds: element.bounds ?? null,
    clickable: element.clickable,
    enabled: element.enabled,
    visible: element.visible,
  });
}

export function compareUiTrees(before: UITree, after: UITree) {
  const beforeElements = flatten(before.roots);
  const afterElements = flatten(after.roots);
  const beforeMap = new Map(
    beforeElements.map((element, index) => [
      semanticKey(element, index),
      structuralValue(element),
    ]),
  );
  const afterMap = new Map(
    afterElements.map((element, index) => [
      semanticKey(element, index),
      structuralValue(element),
    ]),
  );
  const added = [...afterMap.keys()].filter((key) => !beforeMap.has(key));
  const removed = [...beforeMap.keys()].filter((key) => !afterMap.has(key));
  const changed = [...beforeMap.keys()].filter(
    (key) => afterMap.has(key) && beforeMap.get(key) !== afterMap.get(key),
  );
  return {
    beforeElementCount: beforeElements.length,
    afterElementCount: afterElements.length,
    added,
    removed,
    changed,
  };
}
