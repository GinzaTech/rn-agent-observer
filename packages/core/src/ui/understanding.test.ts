import { describe, expect, it } from 'vitest';
import type { AppState, UITree } from '@rn-agent-observer/schemas';
import { buildSnapshot } from '../refs/snapshot.js';
import {
  analyzePixels,
  analyzeScreen,
  auditAccessibility,
  isNonActionablePlatformLog,
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
    screen?: { width: number; height: number };
    errorLogs?: AnalyzeScreenInput['errorLogs'];
  } = {},
): AnalyzeScreenInput {
  const redacted = redactSensitiveUiTree(uiTree);
  return {
    tree: redacted,
    snapshot: buildSnapshot(redacted),
    screen: {
      width: options.screen?.width ?? 1080,
      height: options.screen?.height ?? 2400,
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
    errorLogs: options.errorLogs ?? [],
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

  it('classifies localized error/empty states across languages', () => {
    const japanese = analyzeScreen(
      input(tree([{ type: 'TextView', text: '読み込みに失敗しました' }])),
    );
    expect(japanese.state).toBe('error');
    expect(japanese.textLanguage).toBe('ja');
    const korean = analyzeScreen(
      input(tree([{ type: 'TextView', text: '오류가 발생했습니다' }])),
    );
    expect(korean.state).toBe('error');
    expect(korean.textLanguage).toBe('ko');
    const chinese = analyzeScreen(
      input(tree([{ type: 'TextView', text: '暂无数据' }])),
    );
    expect(chinese.state).toBe('empty');
    expect(chinese.textLanguage).toBe('zh');
    const spanish = analyzeScreen(
      input(tree([{ type: 'TextView', text: 'Ha ocurrido un error' }])),
    );
    expect(spanish.state).toBe('error');
  });

  it('flags unknown languages instead of guessing state semantics', () => {
    const result = analyzeScreen(
      input(tree([{ type: 'TextView', text: 'Загрузка не удалась' }])),
    );
    expect(result.state).toBe('content');
    expect(result.textLanguage).toBe('unknown');
    expect(result.issues.map((finding) => finding.code)).toContain(
      'text-language-unknown',
    );
  });

  it('matches decomposed Vietnamese text through NFC normalization', () => {
    // "Không thể tải dữ liệu" in NFD form (base letter + combining marks).
    const decomposed =
      'Kh\u00f4ng th\u1ec3 t\u1ea3i d\u1eef li\u1ec7u'.normalize('NFD');
    const result = analyzeScreen(
      input(tree([{ type: 'TextView', text: decomposed }])),
    );
    expect(result.state).toBe('error');
    expect(result.textLanguage).toBe('vi');
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

  it('keeps a viewport-clipped control distinct from an intrinsic small target', () => {
    const clippedTree = tree([
      {
        type: 'android.widget.Button',
        text: 'SecurityLab',
        clickable: true,
        bounds: { x: 20, y: 769, width: 440, height: 31 },
      },
    ]);
    const audit = auditAccessibility(clippedTree, 160, {
      width: 480,
      height: 800,
    });
    expect(audit.smallTouchTargets).toBe(0);
    expect(audit.partiallyObservedTouchTargets).toBe(1);

    const result = analyzeScreen(
      input(clippedTree, { screen: { width: 480, height: 800 } }),
    );
    expect(result.counts.smallTouchTargets).toBe(0);
    expect(result.issues.map((finding) => finding.code)).toContain(
      'partially-observed-touch-target',
    );
  });

  it('still reports a fully observed intrinsic small touch target', () => {
    const audit = auditAccessibility(
      tree([
        {
          type: 'android.widget.Button',
          text: 'Compact action',
          clickable: true,
          bounds: { x: 100, y: 100, width: 120, height: 32 },
        },
      ]),
      160,
      { width: 480, height: 800 },
    );
    expect(audit.smallTouchTargets).toBe(1);
    expect(audit.partiallyObservedTouchTargets).toBe(0);
  });

  it('preserves ReactHost soft exceptions without counting them as app errors', () => {
    const softException = {
      level: 'error' as const,
      source: 'unknown',
      timestamp: NOW,
      message:
        'ReactHost: com.facebook.react.bridge.ReactNoCrashSoftException: onWindowFocusChange before context ready',
    };
    expect(isNonActionablePlatformLog(softException)).toBe(true);
    const result = analyzeScreen(
      input(tree([{ type: 'TextView', text: 'Home' }]), {
        errorLogs: [
          softException,
          {
            level: 'error',
            source: 'unknown',
            timestamp: NOW,
            message:
              'ReactHost: \tat com.facebook.react.runtime.ReactHostImpl.focus(Host.kt:1)',
          },
        ],
      }),
    );
    expect(result.counts.runtimeErrors).toBe(0);
    expect(result.issues.map((finding) => finding.code)).toContain(
      'runtime-platform-warning',
    );
    expect(result.issues.map((finding) => finding.code)).not.toContain(
      'runtime-log-error',
    );
  });

  it('keeps independent window errors actionable', () => {
    const result = analyzeScreen(
      input(tree([{ type: 'TextView', text: 'Home' }]), {
        errorLogs: [
          {
            level: 'error',
            source: 'WindowManager',
            timestamp: NOW,
            message: 'BadTokenException while adding application window',
          },
        ],
      }),
    );
    expect(result.counts.runtimeErrors).toBe(1);
    expect(result.issues.map((finding) => finding.code)).toContain(
      'runtime-log-error',
    );
  });
});
