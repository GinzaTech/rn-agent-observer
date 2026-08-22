import { describe, expect, it } from 'vitest';
import { diagnoseEvidence } from '../diagnosis/rules.js';
import {
  appDataFromLogs,
  networkRequestsFromLogs,
  summarizeNetwork,
} from './network.js';

describe('network evidence', () => {
  it('parses instrumentation events and computes percentiles', () => {
    const requests = networkRequestsFromLogs([
      {
        level: 'info',
        source: 'ReactNativeJS',
        timestamp: '2026-08-21T00:00:00.000Z',
        message:
          'RN_AGENT_OBSERVER_NETWORK {"id":"1","method":"GET","url":"/fast","status":200,"durationMs":100,"timestamp":"2026-08-21T00:00:00.000Z","source":"rn-instrumentation"}',
      },
      {
        level: 'info',
        source: 'ReactNativeJS',
        timestamp: '2026-08-21T00:00:01.000Z',
        message:
          'RN_AGENT_OBSERVER_NETWORK {"id":"2","method":"GET","url":"/slow","status":503,"durationMs":2000,"timestamp":"2026-08-21T00:00:01.000Z","source":"rn-instrumentation"}',
      },
    ]);
    expect(summarizeNetwork(requests)).toMatchObject({
      requestCount: 2,
      failedRequests: 1,
      averageLatencyMs: 1050,
      p50Ms: 100,
      p95Ms: 2000,
    });
  });

  it('produces deterministic evidence-based findings', () => {
    const diagnosis = diagnoseEvidence({
      performance: {
        timestamp: '2026-08-21T00:00:00.000Z',
        metrics: [
          {
            name: 'ui_fps',
            value: 40,
            unit: 'fps',
            source: 'test',
            timestamp: '2026-08-21T00:00:00.000Z',
            available: true,
          },
          {
            name: 'js_blocking_ms',
            value: 64,
            unit: 'ms',
            source: 'test',
            timestamp: '2026-08-21T00:00:00.000Z',
            available: true,
          },
        ],
      },
    });
    expect(diagnosis.findings[0]?.title).toContain('JS thread blocking');
    expect(diagnosis.findings[0]?.confidence).toBeGreaterThan(0.2);
    expect(diagnosis.findings[0]?.confidence).toBeLessThanOrEqual(0.99);
    expect(diagnosis.findings[0]?.confidenceBasis).toContain(
      'Score is not a statistical probability',
    );
  });

  it('reports a long JS task even when sustained UI FPS stays normal', () => {
    const diagnosis = diagnoseEvidence({
      performance: {
        timestamp: '2026-08-21T00:00:00.000Z',
        metrics: [
          {
            name: 'ui_fps',
            value: 60,
            unit: 'fps',
            source: 'test',
            timestamp: '2026-08-21T00:00:00.000Z',
            available: true,
          },
          {
            name: 'js_blocking_ms',
            value: 100,
            unit: 'ms',
            source: 'test',
            timestamp: '2026-08-21T00:00:00.000Z',
            available: true,
          },
        ],
      },
    });
    expect(diagnosis.findings[0]?.title).toBe('Long JS task observed');
    // Worse violations should yield higher confidence than marginal ones.
    const severe = diagnoseEvidence({
      performance: {
        timestamp: '2026-08-21T00:00:00.000Z',
        metrics: [
          {
            name: 'ui_fps',
            value: 60,
            unit: 'fps',
            source: 'test',
            timestamp: '2026-08-21T00:00:00.000Z',
            available: true,
          },
          {
            name: 'js_blocking_ms',
            value: 400,
            unit: 'ms',
            source: 'test',
            timestamp: '2026-08-21T00:00:00.000Z',
            available: true,
          },
        ],
      },
    });
    expect(
      (severe.findings[0]?.confidence ?? 0) >=
        (diagnosis.findings[0]?.confidence ?? 1),
    ).toBe(true);
  });

  it('honors custom thresholds', () => {
    const diagnosis = diagnoseEvidence(
      {
        performance: {
          timestamp: '2026-08-21T00:00:00.000Z',
          metrics: [
            {
              name: 'ui_fps',
              value: 50,
              unit: 'fps',
              source: 'test',
              timestamp: '2026-08-21T00:00:00.000Z',
              available: true,
            },
          ],
        },
      },
      { uiFpsLow: 60 },
    );
    expect(diagnosis.findings[0]?.title).toBe('Low UI frame rate observed');
  });

  it('rejects invalid threshold relationships', () => {
    expect(() =>
      diagnoseEvidence({}, { uiFpsLow: 30, uiFpsCritical: 45 }),
    ).toThrow(/uiFpsCritical/);
  });

  it('gates confidence when a frame-rate finding has too few samples', () => {
    const performance = (samples: number) => ({
      timestamp: '2026-08-21T00:00:00.000Z',
      metrics: [
        {
          name: 'ui_fps',
          value: 20,
          unit: 'fps',
          source: 'test',
          timestamp: '2026-08-21T00:00:00.000Z',
          available: true,
        },
        {
          name: 'frame_sample_count',
          value: samples,
          unit: 'frames',
          source: 'test',
          timestamp: '2026-08-21T00:00:00.000Z',
          available: true,
        },
      ],
    });
    const weak = diagnoseEvidence({ performance: performance(1) });
    const strong = diagnoseEvidence({ performance: performance(120) });
    expect(weak.findings[0]?.confidence).toBeLessThan(
      strong.findings[0]?.confidence ?? 0,
    );
    expect(weak.findings[0]?.confidence).toBeLessThan(0.5);
  });

  it('keeps only the latest app-data snapshot per namespace', () => {
    const events = appDataFromLogs([
      {
        level: 'info',
        source: 'ReactNativeJS',
        timestamp: '2026-08-22T00:00:00.000Z',
        message:
          'RN_AGENT_OBSERVER_APP_DATA {"namespace":"render-lab","data":{"tick":1},"timestamp":"2026-08-22T00:00:00.000Z"}',
      },
      {
        level: 'info',
        source: 'ReactNativeJS',
        timestamp: '2026-08-22T00:00:01.000Z',
        message:
          'RN_AGENT_OBSERVER_APP_DATA {"namespace":"render-lab","data":{"tick":5},"timestamp":"2026-08-22T00:00:01.000Z"}',
      },
      {
        level: 'info',
        source: 'ReactNativeJS',
        timestamp: '2026-08-22T00:00:02.000Z',
        message:
          'RN_AGENT_OBSERVER_APP_DATA {"namespace":"nav","data":{"route":"Home"},"timestamp":"2026-08-22T00:00:02.000Z"}',
      },
    ]);
    expect(events).toEqual([
      {
        namespace: 'nav',
        data: { route: 'Home' },
        timestamp: '2026-08-22T00:00:02.000Z',
      },
      {
        namespace: 'render-lab',
        data: { tick: 5 },
        timestamp: '2026-08-22T00:00:01.000Z',
      },
    ]);
  });
});
