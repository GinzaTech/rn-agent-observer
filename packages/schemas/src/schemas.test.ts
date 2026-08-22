import { describe, expect, it } from 'vitest';
import { DeviceSchema, MetricSchema, ObserverStatusSchema } from './index.js';

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
});
