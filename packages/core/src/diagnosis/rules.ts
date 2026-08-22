import type {
  Diagnosis,
  LogEntry,
  NetworkRequest,
  PerformanceSnapshot,
  ReactRenderStat,
} from '@rn-agent-observer/schemas';

function metric(
  snapshot: PerformanceSnapshot | undefined,
  name: string,
): number | null {
  return snapshot?.metrics.find((item) => item.name === name)?.value ?? null;
}

export function diagnoseEvidence(input: {
  performance?: PerformanceSnapshot;
  network?: NetworkRequest[];
  renders?: ReactRenderStat[];
  logs?: LogEntry[];
}): Diagnosis {
  const findings: Diagnosis['findings'] = [];
  const uiFps = metric(input.performance, 'ui_fps');
  const jsBlocking = metric(input.performance, 'js_blocking_ms');
  if (uiFps !== null && uiFps < 45) {
    findings.push({
      title:
        jsBlocking !== null && jsBlocking > 40
          ? 'JS thread blocking likely contributes to frame drops'
          : 'Low UI frame rate observed',
      severity: uiFps < 30 ? 'high' : 'medium',
      confidence: jsBlocking !== null ? 0.9 : 0.72,
      evidence: [
        `UI FPS measured ${uiFps.toFixed(1)}`,
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
    jsBlocking > 40 &&
    (uiFps === null || uiFps >= 45)
  ) {
    findings.push({
      title: 'Long JS task observed',
      severity: jsBlocking > 100 ? 'high' : 'medium',
      confidence: 0.97,
      evidence: [
        `JS blocking measured ${jsBlocking.toFixed(1)}ms`,
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
    (request) => (request.durationMs ?? 0) > 1000,
  );
  if (slow.length) {
    findings.push({
      title: 'Slow network requests observed',
      severity: slow.some((request) => (request.durationMs ?? 0) > 2000)
        ? 'high'
        : 'medium',
      confidence: 0.95,
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
    (render) => render.renderCount >= 10,
  );
  if (noisy.length) {
    findings.push({
      title: 'Potential unnecessary React re-renders',
      severity: 'medium',
      confidence: 0.82,
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
      !/^\s*at\s/.test(entry.message),
  );
  if (errors.length) {
    findings.push({
      title: 'Runtime errors captured',
      severity: errors.some((entry) => entry.level === 'fatal')
        ? 'critical'
        : 'high',
      confidence: 0.99,
      evidence: errors.slice(0, 5).map((entry) => entry.message),
      recommendation:
        'Resolve the first causal error and repeat the same scenario.',
    });
  }
  return { timestamp: new Date().toISOString(), findings };
}
