import type {
  Diagnosis,
  LogEntry,
  NetworkRequest,
  PerformanceSnapshot,
  ReactRenderStat,
} from '@rn-agent-observer/schemas';
import { isNonActionablePlatformLog } from './runtime-errors.js';

export interface DiagnosisThresholds {
  /** UI FPS below this flags a frame-rate finding. Default 45. */
  uiFpsLow: number;
  /** UI FPS below this escalates severity to high. Default 30. */
  uiFpsCritical: number;
  /** JS blocking above this (ms) is meaningful. Default 40. */
  jsBlockingMs: number;
  /** JS blocking above this (ms) escalates to high. Default 100. */
  jsBlockingHighMs: number;
  /** Requests slower than this (ms) are slow. Default 1000. */
  slowRequestMs: number;
  /** Requests slower than this (ms) escalate to high. Default 2000. */
  verySlowRequestMs: number;
  /** Per-component render count at or above this is noisy. Default 10. */
  renderCount: number;
}

export const DEFAULT_THRESHOLDS: DiagnosisThresholds = {
  uiFpsLow: 45,
  uiFpsCritical: 30,
  jsBlockingMs: 40,
  jsBlockingHighMs: 100,
  slowRequestMs: 1_000,
  verySlowRequestMs: 2_000,
  renderCount: 10,
};

export function mergeThresholds(
  overrides?: Partial<DiagnosisThresholds>,
): DiagnosisThresholds {
  const merged = { ...DEFAULT_THRESHOLDS, ...(overrides ?? {}) };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`Diagnosis threshold ${name} must be positive`);
    }
  }
  if (merged.uiFpsCritical >= merged.uiFpsLow) {
    throw new RangeError('uiFpsCritical must be lower than uiFpsLow');
  }
  if (merged.jsBlockingHighMs <= merged.jsBlockingMs) {
    throw new RangeError('jsBlockingHighMs must exceed jsBlockingMs');
  }
  if (merged.verySlowRequestMs <= merged.slowRequestMs) {
    throw new RangeError('verySlowRequestMs must exceed slowRequestMs');
  }
  return merged;
}

function metric(
  snapshot: PerformanceSnapshot | undefined,
  name: string,
): number | null {
  return snapshot?.metrics.find((item) => item.name === name)?.value ?? null;
}

function metricEvidence(
  snapshot: PerformanceSnapshot | undefined,
  name: string,
): { value: number | null; confidence: number | null } {
  const found = snapshot?.metrics.find((item) => item.name === name);
  if (!found || !found.available || found.value === null) {
    return { value: null, confidence: null };
  }
  return {
    value: found.value,
    confidence: found.confidence ?? null,
  };
}

function clamp(value: number, low = 0.05, high = 0.99): number {
  return Math.min(high, Math.max(low, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function ratio(value: number, low: number, high: number): number {
  return clamp((value - low) / Math.max(high - low, 0.01), 0, 1);
}

/**
 * This is an explicitly heuristic score, not a statistical probability.
 * Signal strength represents distance past a configured threshold; evidence
 * strength represents sample volume or source confidence.
 */
function heuristicConfidence(
  signalStrength: number,
  evidenceStrength: number,
): number {
  const signal = 0.2 + 0.79 * clamp(signalStrength, 0, 1);
  const evidenceGate = 0.35 + 0.65 * clamp(evidenceStrength, 0, 1);
  return clamp(signal * evidenceGate);
}

export function diagnoseEvidence(
  input: {
    performance?: PerformanceSnapshot;
    network?: NetworkRequest[];
    renders?: ReactRenderStat[];
    logs?: LogEntry[];
  },
  thresholdOverrides?: Partial<DiagnosisThresholds>,
): Diagnosis {
  const refreshHz = metric(input.performance, 'display_refresh_hz');
  // Device-aware FPS budget: 45fps means very different things on a 60Hz and
  // a 120Hz panel. Unless the caller pinned uiFps explicitly, derive the
  // thresholds from the measured refresh rate (75% low / 50% critical).
  const derivedThresholds =
    thresholdOverrides?.uiFpsLow === undefined &&
    thresholdOverrides?.uiFpsCritical === undefined &&
    refreshHz !== null &&
    refreshHz > 0
      ? {
          uiFpsLow: Math.round(refreshHz * 0.75),
          uiFpsCritical: Math.round(refreshHz * 0.5),
        }
      : {};
  const thresholds = mergeThresholds({
    ...thresholdOverrides,
    ...derivedThresholds,
  });
  const findings: Diagnosis['findings'] = [];
  const uiFps = metric(input.performance, 'ui_fps');
  const jsBlockingEvidence = metricEvidence(
    input.performance,
    'js_blocking_ms',
  );
  const jsBlocking = jsBlockingEvidence.value;
  const frameSampleCount = metric(input.performance, 'frame_sample_count');

  if (uiFps !== null && uiFps < thresholds.uiFpsLow) {
    const signalStrength = ratio(
      thresholds.uiFpsLow - uiFps,
      0,
      thresholds.uiFpsLow - thresholds.uiFpsCritical,
    );
    const evidenceStrength =
      frameSampleCount === null ? 0.35 : 1 - Math.exp(-frameSampleCount / 60);
    const confidence = heuristicConfidence(signalStrength, evidenceStrength);
    findings.push({
      title:
        jsBlocking !== null && jsBlocking > thresholds.jsBlockingMs
          ? 'JS thread blocking likely contributes to frame drops'
          : 'Low UI frame rate observed',
      severity: uiFps < thresholds.uiFpsCritical ? 'high' : 'medium',
      confidence: round(confidence),
      confidenceBasis: [
        `heuristic-v1 signal=${round(signalStrength)}`,
        `frame-sample-strength=${round(evidenceStrength)}`,
        'Score is not a statistical probability',
      ],
      evidence: [
        `UI FPS measured ${uiFps.toFixed(1)} (threshold ${thresholds.uiFpsLow})`,
        ...(frameSampleCount !== null
          ? [`Based on ${frameSampleCount} sampled frames`]
          : []),
        ...(jsBlocking !== null
          ? [`JS blocking measured ${jsBlocking.toFixed(1)}ms`]
          : []),
      ],
      recommendation:
        jsBlocking !== null
          ? 'Move expensive synchronous work off the interaction path.'
          : 'Capture a JS trace to distinguish JS blocking from native rendering cost.',
    });
  }
  if (
    jsBlocking !== null &&
    jsBlocking > thresholds.jsBlockingMs &&
    (uiFps === null || uiFps >= thresholds.uiFpsLow)
  ) {
    const signalStrength = ratio(
      jsBlocking,
      thresholds.jsBlockingMs,
      thresholds.jsBlockingHighMs,
    );
    const evidenceStrength = jsBlockingEvidence.confidence ?? 0.6;
    const confidence = heuristicConfidence(signalStrength, evidenceStrength);
    findings.push({
      title: 'Long JS task observed',
      severity: jsBlocking > thresholds.jsBlockingHighMs ? 'high' : 'medium',
      confidence: round(confidence),
      confidenceBasis: [
        `heuristic-v1 signal=${round(signalStrength)}`,
        `source-strength=${round(evidenceStrength)}`,
        'Score is not a statistical probability',
      ],
      evidence: [
        `JS blocking measured ${jsBlocking.toFixed(1)}ms (threshold ${thresholds.jsBlockingMs}ms)`,
        ...(uiFps !== null
          ? [
              `Sustained UI FPS remained ${uiFps.toFixed(1)} in the sampled window`,
            ]
          : []),
      ],
      recommendation:
        'Split or defer synchronous JS work, then repeat the same interaction and compare the blocking duration.',
    });
  }
  const slow = (input.network ?? []).filter(
    (request) => (request.durationMs ?? 0) > thresholds.slowRequestMs,
  );
  if (slow.length) {
    const worst = Math.max(...slow.map((request) => request.durationMs ?? 0));
    const totalRequests = (input.network ?? []).length || 1;
    const share = slow.length / totalRequests;
    const signalStrength =
      ratio(worst, thresholds.slowRequestMs, thresholds.verySlowRequestMs) *
        0.7 +
      share * 0.3;
    const evidenceStrength = 1 - Math.exp(-totalRequests / 10);
    const confidence = heuristicConfidence(signalStrength, evidenceStrength);
    findings.push({
      title: 'Slow network requests observed',
      severity: slow.some(
        (request) => (request.durationMs ?? 0) > thresholds.verySlowRequestMs,
      )
        ? 'high'
        : 'medium',
      confidence: round(confidence),
      confidenceBasis: [
        `heuristic-v1 signal=${round(signalStrength)}`,
        `${slow.length}/${totalRequests} requests exceeded ${thresholds.slowRequestMs}ms`,
        `request-sample-strength=${round(evidenceStrength)}`,
        'Score is not a statistical probability',
      ],
      evidence: slow
        .slice(0, 5)
        .map(
          (request) =>
            `${request.method} ${request.url}: ${request.durationMs}ms`,
        ),
      recommendation:
        'Inspect the slowest endpoint and separate loading UX from UI-thread performance.',
    });
  }
  const latestRenderByComponent = new Map<string, ReactRenderStat>();
  for (const render of input.renders ?? []) {
    const previous = latestRenderByComponent.get(render.componentName);
    if (!previous || render.renderCount > previous.renderCount) {
      latestRenderByComponent.set(render.componentName, render);
    }
  }
  const noisy = [...latestRenderByComponent.values()].filter(
    (render) => render.renderCount >= thresholds.renderCount,
  );
  if (noisy.length) {
    const worstRenders = Math.max(...noisy.map((render) => render.renderCount));
    const signalStrength = ratio(
      worstRenders,
      thresholds.renderCount,
      thresholds.renderCount * 3,
    );
    const evidenceStrength = 1 - Math.exp(-(input.renders?.length ?? 0) / 10);
    const confidence = heuristicConfidence(signalStrength, evidenceStrength);
    findings.push({
      title: 'Potential unnecessary React re-renders',
      severity: 'medium',
      confidence: round(confidence),
      confidenceBasis: [
        `heuristic-v1 signal=${round(signalStrength)}`,
        `render-observation-strength=${round(evidenceStrength)}`,
        'Score is not a statistical probability',
      ],
      evidence: noisy.map(
        (render) => `${render.componentName}: ${render.renderCount} renders`,
      ),
      recommendation:
        'Profile prop/state changes and stabilize selectors or memoized boundaries where measured.',
    });
  }
  const ignoredSystemSources = new Set(['FramePredict']);
  const errors = (input.logs ?? []).filter(
    (entry) =>
      (entry.level === 'error' || entry.level === 'fatal') &&
      !ignoredSystemSources.has(entry.source) &&
      !isNonActionablePlatformLog(entry) &&
      !/^\s*at\s/.test(entry.message),
  );
  if (errors.length) {
    const fatalCount = errors.filter((entry) => entry.level === 'fatal').length;
    const signalStrength = fatalCount > 0 ? 1 : Math.min(errors.length / 5, 1);
    const evidenceStrength = 1 - Math.exp(-errors.length / 3);
    const confidence = heuristicConfidence(signalStrength, evidenceStrength);
    findings.push({
      title: 'Runtime errors captured',
      severity: fatalCount > 0 ? 'critical' : 'high',
      confidence: round(confidence),
      confidenceBasis: [
        `heuristic-v1 signal=${round(signalStrength)}`,
        `${errors.length} causal-looking error entries; ${fatalCount} fatal`,
        'Score is not a statistical probability',
      ],
      evidence: errors.slice(0, 5).map((entry) => entry.message),
      recommendation:
        'Resolve the first causal error and repeat the same scenario.',
    });
  }
  return { timestamp: new Date().toISOString(), findings };
}
