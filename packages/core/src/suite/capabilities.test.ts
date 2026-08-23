import { describe, expect, it } from 'vitest';
import type { DoctorReport } from '../doctor/doctor.js';
import { observerSuiteCapabilities } from './capabilities.js';

const report = (overrides: Partial<DoctorReport['capabilities']>) =>
  ({
    capabilities: {
      projectType: 'expo',
      adb: false,
      device: false,
      metro: false,
      instrumentation: false,
      securityMode: 'read-only',
      ...overrides,
    },
  }) as DoctorReport;

describe('observer suite capabilities', () => {
  it('does not advertise runtime evidence without a device', () => {
    expect(observerSuiteCapabilities(report({}))).toEqual([
      'expo',
      'local-analysis',
      'reporting',
      'routes',
      'security-passive',
    ]);
  });

  it('adds device, Metro, instrumentation, and policy capabilities honestly', () => {
    const capabilities = observerSuiteCapabilities(
      report({
        adb: true,
        device: true,
        metro: true,
        instrumentation: true,
        securityMode: 'authorized-active',
      }),
    );

    expect(capabilities).toEqual(
      expect.arrayContaining([
        'adb',
        'device',
        'screen-understanding',
        'metro',
        'instrumentation',
        'authorized-active',
      ]),
    );
  });
});
