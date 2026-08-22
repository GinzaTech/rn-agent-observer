import { describe, expect, it } from 'vitest';
import {
  DeviceSchema,
  MetricSchema,
  ObserverStatusSchema,
  ScreenUnderstandingSchema,
} from './index.js';

describe('shared schemas', () => {
  it('validates a device record', () => {
    expect(
      DeviceSchema.parse({
        id: 'emulator-5554',
        platform: 'android',
        state: 'device',
      }),
    ).toEqual({ id: 'emulator-5554', platform: 'android', state: 'device' });
  });

  it('rejects unsupported device platforms', () => {
    expect(
      DeviceSchema.safeParse({
        id: 'unsupported-device',
        platform: 'unsupported-native',
        state: 'device',
      }).success,
    ).toBe(false);
  });

  it('requires unavailable metrics to remain explicit', () => {
    const metric = MetricSchema.parse({
      name: 'js_fps',
      value: null,
      unit: 'fps',
      source: 'adb',
      timestamp: '2026-08-21T00:00:00.000Z',
      available: false,
      reason: 'Not exposed by ADB',
    });
    expect(metric.available).toBe(false);
  });

  it('validates foundation status', () => {
    expect(
      ObserverStatusSchema.safeParse({
        name: 'rn-agent-observer',
        version: '0.1.0',
        phase: 'foundation',
        projectRoot: 'C:\\app',
        implementedCommands: ['help'],
        plannedCommands: [],
      }).success,
    ).toBe(true);
  });

  it('validates structured screen understanding without image bytes', () => {
    expect(
      ScreenUnderstandingSchema.safeParse({
        timestamp: '2026-08-22T00:00:00.000Z',
        source: 'android-uiautomator+screenshot+app-state+logcat',
        state: 'content',
        stateSince: '2026-08-22T00:00:00.000Z',
        fingerprint: 'abc123',
        route: '/home',
        headline: 'Home',
        summary: 'Home screen',
        visibleText: ['Home'],
        actions: [],
        counts: {
          visibleElements: 1,
          textElements: 1,
          interactiveElements: 0,
          unlabeledControls: 0,
          smallTouchTargets: 0,
          runtimeErrors: 0,
        },
        visual: {
          sampledPixels: 100,
          dominantColorRatio: 0.5,
          luminanceStdDev: 20,
        },
        issues: [],
        artifacts: {
          screenshotId: 'shot',
          screenshotPath: 'C:\\shot.png',
          uiTreeId: 'tree',
          uiTreePath: 'C:\\tree.json',
        },
        limitations: ['heuristic'],
      }).success,
    ).toBe(true);
  });
});
