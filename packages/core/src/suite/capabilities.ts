import type { DoctorReport } from '../doctor/doctor.js';

export const observerSuiteCapabilities = (report: DoctorReport): string[] => {
  const capabilities = new Set<string>([
    'local-analysis',
    'routes',
    'reporting',
    'security-passive',
    report.capabilities.projectType,
  ]);
  if (report.capabilities.adb) capabilities.add('adb');
  if (report.capabilities.device) {
    for (const capability of [
      'device',
      'app-state',
      'device-network',
      'screenshot',
      'ui-tree',
      'screen-understanding',
      'runtime-ui-model',
      'logs',
      'performance',
      'accessibility',
    ]) {
      capabilities.add(capability);
    }
  }
  if (report.capabilities.metro) capabilities.add('metro');
  if (report.capabilities.instrumentation) {
    capabilities.add('instrumentation');
    capabilities.add('app-data');
    capabilities.add('react-render-stats');
  }
  if (report.capabilities.securityMode === 'authorized-active') {
    capabilities.add('authorized-active');
  }
  return [...capabilities].sort();
};
