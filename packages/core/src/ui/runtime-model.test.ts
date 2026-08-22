import { describe, expect, it } from 'vitest';
import type { SourceUiElement, UITree } from '@rn-agent-observer/schemas';
import { buildSnapshot } from '../refs/snapshot.js';
import { buildRuntimeUiModel } from './runtime-model.js';

const NOW = '2026-08-22T12:00:00.000Z';
const source: SourceUiElement[] = [
  {
    id: 'App.tsx:10:3',
    componentName: 'Pressable',
    role: 'button',
    testId: 'save',
    generatedTestId: null,
    label: 'Save',
    hasPressHandler: true,
    disabledStatic: null,
    conditionallyRendered: false,
    source: { file: 'App.tsx', line: 10, column: 3 },
  },
];

function tree(): UITree {
  return {
    roots: [
      {
        id: 'save',
        type: 'android.widget.Button',
        text: 'Save',
        clickable: true,
        enabled: true,
        visible: true,
        bounds: { x: 10, y: 10, width: 100, height: 60 },
        children: [],
      },
    ],
    timestamp: NOW,
    source: 'test',
    artifactId: 'tree-1',
    artifactPath: 'tree.json',
  };
}

describe('runtime UI model', () => {
  it('correlates source, native visibility and recorded interaction', () => {
    const uiTree = tree();
    const result = buildRuntimeUiModel({
      sourceElements: source,
      tree: uiTree,
      snapshot: buildSnapshot(uiTree),
      telemetry: [
        {
          elementId: 'save',
          testId: 'save',
          componentName: 'Pressable',
          role: 'button',
          label: 'Save',
          parentId: null,
          mounted: true,
          visible: true,
          enabled: true,
          timestamp: NOW,
        },
      ],
      interactions: [
        {
          interactionId: 'press-1',
          elementId: 'save',
          testId: 'save',
          label: 'Save',
          phase: 'success',
          timestamp: NOW,
          durationMs: 2,
          error: null,
        },
      ],
      route: '/profile',
      viewport: { width: 1080, height: 2400 },
      now: NOW,
    });
    expect(result.nodes[0]).toMatchObject({
      ref: 'e1',
      rendered: 'yes',
      visibility: 'visible',
      canPress: 'yes',
      instrumented: true,
    });
    expect(result.counts).toMatchObject({ pressable: 1, interactions: 1 });
  });

  it('does not claim a mounted but flattened control is pressable', () => {
    const emptyTree: UITree = {
      roots: [],
      timestamp: NOW,
      source: 'test',
    };
    const result = buildRuntimeUiModel({
      sourceElements: source,
      tree: emptyTree,
      snapshot: buildSnapshot(emptyTree),
      telemetry: [
        {
          elementId: 'save',
          testId: 'save',
          componentName: 'Pressable',
          role: 'button',
          label: 'Save',
          parentId: null,
          mounted: true,
          visible: true,
          enabled: true,
          timestamp: NOW,
        },
      ],
      interactions: [],
      route: null,
      viewport: { width: 1080, height: 2400 },
      now: NOW,
    });
    expect(result.nodes[0]).toMatchObject({
      rendered: 'yes',
      visibility: 'flattened-or-unobserved',
      canPress: 'unknown',
    });
    expect(result.issues.map((entry) => entry.code)).toContain(
      'source-action-not-observed',
    );
  });
});
