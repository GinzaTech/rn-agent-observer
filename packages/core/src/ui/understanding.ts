import { createHash } from 'node:crypto';
import type {
  AppState,
  LogEntry,
  ScreenSnapshot,
  ScreenState,
  ScreenUnderstanding,
  UIElement,
  UiIssue,
  UITree,
} from '@rn-agent-observer/schemas';
import { flattenUiTree } from '../adb/parsers.js';
import type { UiSnapshot } from '../refs/snapshot.js';

const REDACTED = '[REDACTED]';
const GENERIC_LABELS = new Set([
  'view',
  'textview',
  'imageview',
  'scrollview',
  'horizontalscrollview',
  'webview',
  'button',
  'edittext',
]);
const ERROR_TEXT =
  /(?:^error(?:\s*[:!.-]|$)|exception|uncaught|crash(?:ed)?|fatal error|failed to|request failed|network error|something went wrong|unable to|timed? out|timeout|đã xảy ra lỗi|không thể|thất bại|(?:^|\s)lỗi(?:\s|:|$))/i;
const LOADING_TEXT =
  /(?:^|\s)(?:loading|connecting|please wait|syncing|đang tải|đang kết nối|vui lòng chờ|đang đồng bộ)(?:\s|[.!…]|$)/i;
const EMPTY_TEXT =
  /(?:no data|nothing here|no results|list is empty|empty state|không có dữ liệu|không tìm thấy kết quả|danh sách (?:đang )?trống|chưa có dữ liệu)/i;

export interface PixelStatistics {
  sampledPixels: number;
  dominantColorRatio: number;
  luminanceStdDev: number;
}

export interface AccessibilityIssue {
  className: string;
  issue: 'unlabeled' | 'small-touch-target';
  bounds?: unknown;
}

export interface AccessibilityAuditResult {
  totalInteractive: number;
  unlabeledCount: number;
  smallTouchTargets: number;
  issues: AccessibilityIssue[];
}

export interface PriorUnderstandingState {
  state: ScreenState;
  fingerprint: string;
  firstSeenAt: string;
}

export interface AnalyzeScreenInput {
  tree: UITree;
  snapshot: UiSnapshot;
  screen: ScreenSnapshot;
  screenshotPath: string;
  pixelStatistics: PixelStatistics;
  densityDpi: number;
  appState: AppState;
  errorLogs: LogEntry[];
  route: string | null;
  stuckAfterMs: number;
  prior?: PriorUnderstandingState;
  now?: string;
}

function isTextField(element: UIElement): boolean {
  return /EditText|TextInput/i.test(
    `${element.type} ${element.className ?? ''}`,
  );
}

/**
 * UI text is useful agent evidence, but editable controls are fail-closed:
 * their current value and content description are never persisted or returned.
 */
export function sanitizeUiText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(
      /\b(token|password|passwd|secret|authorization|cookie|jwt|session|sid)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]',
    )
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]{40,}\b/gi, REDACTED)
    .slice(0, 240);
}

export function redactSensitiveUiTree(tree: UITree): UITree {
  const redactElement = (element: UIElement): UIElement => {
    const {
      text: originalText,
      contentDescription: originalDescription,
      children,
      ...rest
    } = element;
    const sensitive = isTextField(element);
    return {
      ...rest,
      ...(originalText
        ? { text: sensitive ? REDACTED : sanitizeUiText(originalText) }
        : {}),
      ...(originalDescription
        ? {
            contentDescription: sensitive
              ? REDACTED
              : sanitizeUiText(originalDescription),
          }
        : {}),
      children: children.map(redactElement),
    };
  };
  return { ...tree, roots: tree.roots.map(redactElement) };
}

export function analyzePixels(input: {
  width: number;
  height: number;
  data: Uint8Array;
}): PixelStatistics {
  const targetSamples = 12_000;
  const step = Math.max(
    1,
    Math.floor(Math.sqrt((input.width * input.height) / targetSamples)),
  );
  const colors = new Map<number, number>();
  let count = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  for (let y = 0; y < input.height; y += step) {
    for (let x = 0; x < input.width; x += step) {
      const index = (y * input.width + x) * 4;
      const red = input.data[index] ?? 0;
      const green = input.data[index + 1] ?? 0;
      const blue = input.data[index + 2] ?? 0;
      const color = (red >> 4) * 256 + (green >> 4) * 16 + (blue >> 4);
      colors.set(color, (colors.get(color) ?? 0) + 1);
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      luminanceSum += luminance;
      luminanceSquaredSum += luminance * luminance;
      count += 1;
    }
  }
  const dominant = Math.max(0, ...colors.values());
  const mean = count ? luminanceSum / count : 0;
  const variance = count
    ? Math.max(0, luminanceSquaredSum / count - mean * mean)
    : 0;
  return {
    sampledPixels: count,
    dominantColorRatio: count ? dominant / count : 0,
    luminanceStdDev: Math.sqrt(variance),
  };
}

export function auditAccessibility(
  tree: UITree,
  densityDpi: number,
): AccessibilityAuditResult {
  const interactive = flattenUiTree(tree.roots).filter(
    (element) => (element.clickable ?? false) && element.visible !== false,
  );
  const issues: AccessibilityIssue[] = [];
  const density = densityDpi > 0 ? densityDpi : 420;
  const dp = (px: number) => (px * 160) / density;
  for (const element of interactive) {
    const label = element.text ?? element.contentDescription ?? element.id;
    const hasLabel = Boolean(label) && label !== REDACTED;
    if (!hasLabel) {
      issues.push({
        className: element.className ?? element.type,
        issue: 'unlabeled',
        ...(element.bounds ? { bounds: element.bounds } : {}),
      });
    } else if (element.bounds) {
      const widthDp = dp(element.bounds.width);
      const heightDp = dp(element.bounds.height);
      if (widthDp < 48 || heightDp < 48) {
        issues.push({
          className: element.className ?? element.type,
          issue: 'small-touch-target',
          bounds: {
            ...element.bounds,
            widthDp: Math.round(widthDp),
            heightDp: Math.round(heightDp),
          },
        });
      }
    }
  }
  return {
    totalInteractive: interactive.length,
    unlabeledCount: issues.filter((issue) => issue.issue === 'unlabeled')
      .length,
    smallTouchTargets: issues.filter(
      (issue) => issue.issue === 'small-touch-target',
    ).length,
    issues,
  };
}

function genericLabel(value: string): boolean {
  return GENERIC_LABELS.has(value.trim().toLowerCase());
}

function textFor(element: UIElement): string | null {
  if (isTextField(element)) return null;
  const value = element.text ?? element.contentDescription;
  if (!value || value === REDACTED) return null;
  const sanitized = sanitizeUiText(value).trim();
  return sanitized && !genericLabel(sanitized) ? sanitized : null;
}

function fingerprint(input: {
  state: ScreenState;
  texts: string[];
  snapshot: UiSnapshot;
  visual: PixelStatistics;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        state: input.state,
        texts: input.texts,
        actions: input.snapshot.elements
          .filter((element) => element.interactive)
          .map((element) => [element.kind, element.label, element.testId]),
        dominant: Math.round(input.visual.dominantColorRatio * 20) / 20,
      }),
    )
    .digest('hex')
    .slice(0, 16);
}

function issue(
  code: UiIssue['code'],
  severity: UiIssue['severity'],
  title: string,
  description: string,
  suggestion: string,
  artifacts: string[],
  labels: string[] = [],
  refs: string[] = [],
): UiIssue {
  return {
    code,
    severity,
    title,
    description,
    suggestion,
    evidence: { refs, labels, artifactIds: artifacts },
  };
}

export function analyzeScreen(input: AnalyzeScreenInput): ScreenUnderstanding {
  const now = input.now ?? new Date().toISOString();
  const flat = flattenUiTree(input.tree.roots).filter(
    (element) => element.visible !== false,
  );
  const orderedText = flat
    .map((element) => ({
      value: textFor(element),
      y: element.bounds?.y ?? Number.MAX_SAFE_INTEGER,
      x: element.bounds?.x ?? Number.MAX_SAFE_INTEGER,
    }))
    .filter(
      (entry): entry is { value: string; y: number; x: number } =>
        entry.value !== null,
    )
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const texts = [...new Set(orderedText.map((entry) => entry.value))];
  const actions = input.snapshot.elements.filter(
    (element) => element.interactive && element.visible,
  );
  const meaningfulActions = actions.filter(
    (element) => element.label && !genericLabel(element.label),
  );
  const errorTexts = texts.filter((value) => ERROR_TEXT.test(value));
  const loadingTexts = texts.filter((value) => LOADING_TEXT.test(value));
  const emptyTexts = texts.filter((value) => EMPTY_TEXT.test(value));
  const looksVisuallyBlank =
    input.pixelStatistics.dominantColorRatio >= 0.9 &&
    input.pixelStatistics.luminanceStdDev <= 24;

  let state: ScreenState;
  if (!input.appState.processRunning) state = 'not-running';
  else if (!input.appState.appInForeground) state = 'background';
  else if (errorTexts.length > 0) state = 'error';
  else if (loadingTexts.length > 0) state = 'loading';
  else if (emptyTexts.length > 0) state = 'empty';
  else if (
    texts.length === 0 &&
    meaningfulActions.length === 0 &&
    looksVisuallyBlank
  )
    state = 'blank';
  else state = 'content';

  const screenFingerprint = fingerprint({
    state,
    texts,
    snapshot: input.snapshot,
    visual: input.pixelStatistics,
  });
  const sameAsPrior =
    input.prior?.state === state &&
    input.prior.fingerprint === screenFingerprint;
  const stateSince = sameAsPrior && input.prior ? input.prior.firstSeenAt : now;
  const stateAgeMs = Math.max(
    0,
    new Date(now).getTime() - new Date(stateSince).getTime(),
  );
  const artifactIds = [input.screen.artifactId, input.tree.artifactId].filter(
    (value): value is string => value !== undefined,
  );
  const issues: UiIssue[] = [];
  const refsForLabels = (labels: string[]) =>
    actions
      .filter((element) => labels.includes(element.label))
      .map((element) => element.ref);

  if (errorTexts.length > 0) {
    issues.push(
      issue(
        'runtime-error-text',
        'error',
        'Visible error state',
        'The current screen contains text that looks like a user-facing error.',
        'Inspect the cited labels, filtered runtime logs, and the screenshot; reproduce before editing the smallest owning component.',
        artifactIds,
        errorTexts.slice(0, 5),
        refsForLabels(errorTexts),
      ),
    );
  }
  if (state === 'blank') {
    issues.push(
      issue(
        'blank-screen',
        'error',
        'Screen appears blank',
        `No meaningful text or actions were exposed and ${(input.pixelStatistics.dominantColorRatio * 100).toFixed(1)}% of sampled pixels share the dominant color.`,
        'Check navigation/render guards and recent reload errors; compare this screenshot with the last known-good screen.',
        artifactIds,
      ),
    );
  }
  if (state === 'loading') {
    const stuck = stateAgeMs >= input.stuckAfterMs;
    issues.push(
      issue(
        stuck ? 'loading-stuck' : 'loading-state',
        stuck ? 'warning' : 'info',
        stuck ? 'Loading state has not changed' : 'Loading state visible',
        stuck
          ? `The same loading screen has persisted for ${stateAgeMs}ms.`
          : 'A loading indicator or loading message is visible.',
        stuck
          ? 'Inspect in-flight network evidence, timeout/error handling, and the state transition that should dismiss loading.'
          : 'Call understand-screen again after the configured threshold to distinguish normal loading from a stuck state.',
        artifactIds,
        loadingTexts.slice(0, 5),
        refsForLabels(loadingTexts),
      ),
    );
  }
  if (state === 'empty') {
    issues.push(
      issue(
        'empty-state',
        'info',
        'Empty state visible',
        'The screen explicitly reports that no content or results are available.',
        'Verify that this is expected for the current account/filter and that the empty state offers a useful recovery action.',
        artifactIds,
        emptyTexts.slice(0, 5),
        refsForLabels(emptyTexts),
      ),
    );
  }

  const recentErrors = input.errorLogs.filter((entry) => {
    const age = new Date(now).getTime() - new Date(entry.timestamp).getTime();
    return age >= 0 && age <= 60_000;
  });
  if (recentErrors.length > 0) {
    const labels = recentErrors
      .map((entry) => sanitizeUiText(entry.message.split(/\r?\n/)[0] ?? ''))
      .filter(Boolean)
      .slice(-5);
    issues.push(
      issue(
        'runtime-log-error',
        'warning',
        'Recent runtime errors observed',
        `${recentErrors.length} error/fatal log entries were emitted in the last 60 seconds.`,
        'Correlate timestamps with the current interaction; system/ReactHost soft errors are evidence, not proof of an app defect.',
        artifactIds,
        labels,
      ),
    );
  }

  const a11y = auditAccessibility(input.tree, input.densityDpi);
  if (a11y.unlabeledCount > 0) {
    issues.push(
      issue(
        'unlabeled-control',
        'warning',
        'Interactive controls lack labels',
        `${a11y.unlabeledCount} visible clickable controls have no text, accessibility label, or testID.`,
        'Add accessibilityLabel and a stable testID to the owning React Native control.',
        artifactIds,
      ),
    );
  }
  if (a11y.smallTouchTargets > 0) {
    issues.push(
      issue(
        'small-touch-target',
        'warning',
        'Touch targets below 48dp',
        `${a11y.smallTouchTargets} labeled controls are narrower or shorter than 48dp.`,
        'Increase the pressable hit area or use hitSlop, then repeat the audit on-device.',
        artifactIds,
      ),
    );
  }

  const ids = new Map<string, string[]>();
  for (const action of actions) {
    if (!action.testId) continue;
    const refs = ids.get(action.testId) ?? [];
    refs.push(action.ref);
    ids.set(action.testId, refs);
  }
  const duplicates = [...ids.entries()].filter(([, refs]) => refs.length > 1);
  if (duplicates.length > 0) {
    issues.push(
      issue(
        'duplicate-test-id',
        'warning',
        'Duplicate visible testIDs',
        `${duplicates.length} testIDs identify more than one visible action.`,
        'Make each simultaneously visible testID unique so agents cannot target the wrong control.',
        artifactIds,
        duplicates.map(([id]) => id),
        duplicates.flatMap(([, refs]) => refs),
      ),
    );
  }
  const zeroSize = actions.filter(
    (action) =>
      action.bounds !== null &&
      (action.bounds.width === 0 || action.bounds.height === 0),
  );
  if (zeroSize.length > 0) {
    issues.push(
      issue(
        'zero-size-control',
        'warning',
        'Visible controls have zero-sized bounds',
        `${zeroSize.length} controls are marked visible but cannot receive a coordinate tap.`,
        'Inspect conditional layout and remove hidden controls from the accessibility tree.',
        artifactIds,
        zeroSize.map((action) => action.label),
        zeroSize.map((action) => action.ref),
      ),
    );
  }
  const offscreen = actions.filter((action) => {
    const bounds = action.bounds;
    return (
      bounds !== null &&
      (bounds.x >= input.screen.width ||
        bounds.y >= input.screen.height ||
        bounds.x + bounds.width <= 0 ||
        bounds.y + bounds.height <= 0)
    );
  });
  if (offscreen.length > 0) {
    issues.push(
      issue(
        'offscreen-control',
        'warning',
        'Visible controls are outside the screen',
        `${offscreen.length} controls are marked visible but their bounds do not intersect the screen.`,
        'Fix clipping/translation or mark off-screen virtualized content as not visible.',
        artifactIds,
        offscreen.map((action) => action.label),
        offscreen.map((action) => action.ref),
      ),
    );
  }

  const visibleText = texts.slice(0, 60);
  const visibleActions = actions.slice(0, 50).map((element) => ({
    ref: element.ref,
    kind: element.kind,
    label: element.label,
    testId: element.testId,
    bounds: element.bounds,
  }));
  const headline =
    flat
      .map((element) => ({
        value: element.clickable || element.focusable ? null : textFor(element),
        y: element.bounds?.y ?? Number.MAX_SAFE_INTEGER,
        x: element.bounds?.x ?? Number.MAX_SAFE_INTEGER,
      }))
      .filter(
        (entry): entry is { value: string; y: number; x: number } =>
          entry.value !== null,
      )
      .sort((left, right) => left.y - right.y || left.x - right.x)[0]?.value ??
    visibleText[0] ??
    null;
  const summary = `Screen${headline ? ` "${headline}"` : ''}: ${state}; ${flat.length} visible elements, ${actions.length} actions, ${issues.length} findings.`;
  const limitations = [
    'UI state classification is deterministic heuristic evidence, not a vision-model conclusion.',
    'UIAutomator cannot expose off-screen FlatList items, React props/component ownership, contrast, or focus order.',
    'Use screenshotPath for visual review and compare screenshots before/after any fix.',
    ...(texts.length > visibleText.length ||
    actions.length > visibleActions.length
      ? [
          'Text/actions were truncated in this response; counts still cover the full visible tree.',
        ]
      : []),
  ];
  return {
    timestamp: now,
    source: 'android-uiautomator+screenshot+app-state+logcat',
    state,
    stateSince,
    fingerprint: screenFingerprint,
    route: input.route,
    headline,
    summary,
    visibleText,
    actions: visibleActions,
    counts: {
      visibleElements: flat.length,
      textElements: texts.length,
      interactiveElements: actions.length,
      unlabeledControls: a11y.unlabeledCount,
      smallTouchTargets: a11y.smallTouchTargets,
      runtimeErrors: recentErrors.length,
    },
    visual: input.pixelStatistics,
    issues,
    artifacts: {
      screenshotId: input.screen.artifactId ?? '',
      screenshotPath: input.screenshotPath,
      uiTreeId: input.tree.artifactId ?? '',
      uiTreePath: input.tree.artifactPath ?? '',
    },
    limitations,
  };
}
