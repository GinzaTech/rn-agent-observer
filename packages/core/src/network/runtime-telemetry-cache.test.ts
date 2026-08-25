import { describe, expect, it } from 'vitest';
import type { LogEntry } from '@rn-agent-observer/schemas';
import {
  mergeRuntimeTelemetry,
  readRuntimeTelemetryCache,
} from './runtime-telemetry-cache.js';

function entry(message: string, timestamp: string): LogEntry {
  return {
    level: 'info',
    source: 'ReactNativeJS',
    timestamp,
    message,
  };
}

describe('runtime telemetry cache', () => {
  it('clears process-owned evidence when the pid changes', () => {
    const firstTimestamp = '2026-08-24T00:00:00.000Z';
    const initial = readRuntimeTelemetryCache('missing-runtime-cache.json');
    const first = mergeRuntimeTelemetry(
      initial,
      [
        entry(
          `RN_AGENT_OBSERVER_ROUTE {"route":"PerformanceLab","timestamp":"${firstTimestamp}"}`,
          firstTimestamp,
        ),
        entry(
          `RN_AGENT_OBSERVER_UI_ELEMENT {"elementId":"trigger","testId":"trigger-js-block","componentName":"Button","mounted":true,"visible":true,"enabled":true,"timestamp":"${firstTimestamp}"}`,
          firstTimestamp,
        ),
        entry(
          `RN_AGENT_OBSERVER_JS_TASK {"durationMs":100,"label":"intentional-block","timestamp":"${firstTimestamp}","source":"rn-instrumentation"}`,
          firstTimestamp,
        ),
        entry(
          `RN_AGENT_OBSERVER_PERFORMANCE_MARK {"name":"screenInteractive","startupId":"cold-1","timestamp":"${firstTimestamp}","startupType":"cold","foreground":true,"source":"rn-instrumentation"}`,
          firstTimestamp,
        ),
      ],
      10,
    );

    const restarted = mergeRuntimeTelemetry(first.cache, [], 11);

    expect(restarted.processChanged).toBe(true);
    expect(restarted.cache.processId).toBe(11);
    expect(restarted.cache.routes).toEqual([]);
    expect(restarted.cache.uiElements).toEqual([]);
    expect(restarted.cache.jsTasks).toEqual([]);
    expect(restarted.cache.performanceMarks).toEqual([]);
  });
});
