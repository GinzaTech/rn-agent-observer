import { describe, expect, it } from 'vitest';
import type { AppState, UITree } from '@rn-agent-observer/schemas';
import { buildSnapshot } from '../refs/snapshot.js';
import {
  analyzePixels,
  analyzeScreen,
  redactSensitiveUiTree,
  type AnalyzeScreenInput,
  type PriorUnderstandingState,
} from './understanding.js';

const NOW = '2026-08-22T10:00:00.000Z';

function tree(elements: object[]): UITree {
  return {
    roots: elements.map((element) => ({
      type: 'View',
      visible: true,
      children: [],
      ...element,
    })),
    timestamp: NOW,
    source: 'test-uiautomator',
    artifactId: 'tree-1',
    artifactPath: 'C:\\artifacts\\tree.json',
  };
}

function appState(overrides: Partial<AppState> = {}): AppState {
  return {
    appId: 'dev.test',
    processRunning: true,
    pid: 42,
    foregroundActivity: 'dev.test/.MainActivity',
    appInForeground: true,
    source: 'adb-pidof+dumpsys-activity',
    timestamp: NOW,
    ...overrides,
  };
}

function input(
  uiTree: UITree,
  options: {
    prior?: PriorUnderstandingState;
    now?: string;
    visuallyBlank?: boolean;
  } = {},
): AnalyzeScreenInput {
  const redacted = redactSensitiveUiTree(uiTree);
  return {
    tree: redacted,
    snapshot: buildSnapshot(redacted),
    screen: {
      width: 1080,
      height: 2400,
      orientation: 'portrait',
      timestamp: NOW,
      artifactId: 'shot-1',
    },
    screenshotPath: 'C:\\artifacts\\shot.png',
    pixelStatistics: options.visuallyBlank
      ? {
          sampledPixels: 100,
          dominantColorRatio: 0.99,
          luminanceStdDev: 2,
        }
      : {
          sampledPixels: 100,
          dominantColorRatio: 0.3,
          luminanceStdDev: 60,
        },
    densityDpi: 160,
    appState: appState(),
    errorLogs: [],
    route: '/profile',
    stuckAfterMs: 15_000,
    ...(options.prior ? { prior: options.prior } : {}),
    ...(options.now ? { now: options.now } : { now: NOW }),
  };
}

describe('screen understanding', () => {
  it('summarizes visible content and agent actions with refs', () => {
    const result = analyzeScreen(
      input(
        tree([
          {
            type: 'android.widget.TextView',
            text: 'Vshop',
            bounds: { x: 100, y: 100, width: 300, height: 80 },
          },
          {
            type: 'android.widget.Button',
            text: 'Profile',
            id: 'profile-tab',
            clickable: true,
            bounds: { x: 100, y: 2200, width: 180, height: 100 },
          },
        ]),
      ),
    );
    expect(result).toMatchObject({
      state: 'content',
      route: '/profile',
      headline: 'Vshop',
      counts: { interactiveElements: 1 },
    });
    expect(result.actions[0]).toMatchObject({
      ref: 'e2',
      label: 'Profile',
      testId: 'profile-tab',
    });
  });

  it('detects visible errors and blank screens', () => {
    const error = analyzeScreen(
      input(tree([{ type: 'TextView', text: 'Không thể tải dữ liệu' }])),
    );
    expect(error.state).toBe('error');
    expect(error.issues.map((finding) => finding.code)).toContain(
      'runtime-error-text',
    );

    const blank = analyzeScreen(input(tree([]), { visuallyBlank: true }));
    expect(blank.state).toBe('blank');
    expect(blank.issues.map((finding) => finding.code)).toContain(
      'blank-screen',
    );
  });

  it('promotes an unchanged loading screen to loading-stuck', () => {
    const loadingTree = tree([{ type: 'TextView', text: 'Loading data...' }]);
    const first = analyzeScreen(input(loadingTree));
    expect(first.state).toBe('loading');
    expect(first.issues[0]?.code).toBe('loading-state');
    const second = analyzeScreen(
      input(loadingTree, {
        now: '2026-08-22T10:00:20.000Z',
        prior: {
          state: first.state,
          fingerprint: first.fingerprint,
          firstSeenAt: first.stateSince,
        },
      }),
    );
    expect(second.issues[0]?.code).toBe('loading-stuck');
    expect(second.issues[0]?.severity).toBe('warning');
  });

  it('redacts editable values before persistence or snapshot creation', () => {
    const original = tree([
      {
        type: 'EditText',
        className: 'android.widget.EditText',
        id: 'password',
        text: 'do-not-persist',
        contentDescription: 'do-not-persist',
        clickable: true,
      },
      { type: 'TextView', text: 'mail user@example.test' },
    ]);
    const redacted = redactSensitiveUiTree(original);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('do-not-persist');
    expect(serialized).not.toContain('user@example.test');
    expect(serialized).toContain('[REDACTED]');
    expect(serialized).toContain('[REDACTED_EMAIL]');
    const snapshot = buildSnapshot(redacted);
    expect(snapshot.elements[0]).toMatchObject({
      label: 'password',
      value: null,
    });
  });

  it('computes visual blankness without returning image bytes', () => {
    const white = analyzePixels({
      width: 2,
      height: 2,
      data: new Uint8Array([
        255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
        255, 255,
      ]),
    });
    expect(white.dominantColorRatio).toBe(1);
    expect(white.luminanceStdDev).toBe(0);
  });
});
