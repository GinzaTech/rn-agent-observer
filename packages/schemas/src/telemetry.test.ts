import { describe, expect, it } from 'vitest';
import {
  NetworkTelemetryPayloadSchema,
  RouteTelemetryPayloadSchema,
  TELEMETRY_VERSION,
} from './telemetry.js';

describe('telemetry contract', () => {
  it('accepts legacy and current telemetry but rejects unknown versions', () => {
    expect(
      RouteTelemetryPayloadSchema.safeParse({ route: 'Home' }).success,
    ).toBe(true);
    expect(
      RouteTelemetryPayloadSchema.safeParse({
        route: 'Home',
        telemetryVersion: TELEMETRY_VERSION,
      }).success,
    ).toBe(true);
    expect(
      RouteTelemetryPayloadSchema.safeParse({
        route: 'Home',
        telemetryVersion: 2,
      }).success,
    ).toBe(false);
  });

  it('validates payload fields rather than trusting parsed JSON', () => {
    expect(
      NetworkTelemetryPayloadSchema.safeParse({
        id: 'bad',
        method: 'GET',
        url: '/health',
        durationMs: 'fast',
        timestamp: 'not-a-timestamp',
        source: 'rn-instrumentation',
        telemetryVersion: TELEMETRY_VERSION,
      }).success,
    ).toBe(false);
  });
});
