import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { SuiteReporter, SuiteRunResult } from '@rn-agent-observer/schemas';
import type { ObserverCore } from '../index.js';
import { authorizeSecurityAction } from '../config/observer-config.js';
import { runDoctor, type DoctorOptions } from '../doctor/doctor.js';
import { observerSuiteCapabilities } from './capabilities.js';
import { loadSuiteDefinition } from './loader.js';
import { createObserverSuiteExecutor } from './observer-executor.js';
import { getBuiltinSuite } from './presets.js';
import { writeSuiteReports, type WrittenSuiteReport } from './reporters.js';
import { runSuite, type SuiteRunProgress } from './runner.js';

export interface RunObserverSuiteWorkflowOptions {
  suiteReference: string;
  reporters?: readonly SuiteReporter[];
  outputDirectory?: string;
  /** Required for suites that contain intentionally persistent permission changes. */
  confirmPersistentPermissionChange?: boolean;
  createRunId?: () => string;
  doctor?: Omit<DoctorOptions, 'projectRoot'>;
  signal?: AbortSignal;
  onProgress?: (progress: SuiteRunProgress) => void | Promise<void>;
}

export interface ObserverSuiteWorkflowResult {
  suite: {
    path: string;
    format: 'json' | 'yaml';
    sha256: string;
    builtin: boolean;
  };
  readiness: {
    overall: 'ready' | 'degraded' | 'blocked';
    capabilities: string[];
  };
  result: SuiteRunResult;
  reports: WrittenSuiteReport[];
}

export const runObserverSuiteWorkflow = async (
  core: ObserverCore,
  options: RunObserverSuiteWorkflowOptions,
): Promise<ObserverSuiteWorkflowResult> => {
  const builtin = getBuiltinSuite(options.suiteReference);
  const loaded = builtin
    ? {
        path: `builtin:${options.suiteReference}`,
        format: 'json' as const,
        sha256: createHash('sha256')
          .update(JSON.stringify(builtin))
          .digest('hex'),
        definition: builtin,
      }
    : await loadSuiteDefinition(options.suiteReference);
  const doctor = await runDoctor({
    projectRoot: core.projectRoot,
    ...options.doctor,
  });
  const capabilities = observerSuiteCapabilities(doctor);
  const device = doctor.capabilities.device
    ? await core.deviceInfo().catch(() => undefined)
    : undefined;
  let appId = core.config.target.appId;
  if (!appId) {
    try {
      appId = core.appId;
    } catch {
      appId = 'unresolved-app';
    }
  }
  const result = await runSuite(loaded.definition, {
    target: {
      platform: 'android',
      deviceId:
        device?.id ??
        core.config.target.deviceId ??
        core.adb.deviceId ??
        'unresolved-device',
      appId,
      ...(device?.osVersion
        ? { operatingSystem: `Android ${device.osVersion}` }
        : {}),
      ...(device?.model ? { deviceClass: device.model } : {}),
    },
    capabilities,
    executor: createObserverSuiteExecutor(core, {
      confirmPersistentPermissionChange:
        options.confirmPersistentPermissionChange === true,
    }),
    authorize: (risk) =>
      authorizeSecurityAction(core.config, risk, appId, core.adb.deviceId),
    ...(options.createRunId ? { createRunId: options.createRunId } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  const reports = await writeSuiteReports(result, {
    outputDirectory:
      options.outputDirectory ??
      join(core.artifacts.root, 'reports', result.id),
    reporters: options.reporters ?? loaded.definition.reporters,
  });
  return {
    suite: {
      path: loaded.path,
      format: loaded.format,
      sha256: loaded.sha256,
      builtin: builtin !== undefined,
    },
    readiness: { overall: doctor.overall, capabilities },
    result,
    reports,
  };
};
