import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTERNAL_MAX_MESSAGE_BYTES,
  DEFAULT_PLUGIN_TIMEOUT_MS,
  EXTERNAL_PLUGIN_METHODS,
  EXTERNAL_PLUGIN_PROTOCOL,
  PluginManifestError,
  PluginRegistry,
  PluginRegistryError,
  PluginTimeoutError,
  createExternalPluginDescriptor,
  inspectPluginConformance,
  validatePluginManifest,
  type AnalyzerExtension,
  type AnalyzerPluginManifest,
  type PluginHostContext,
  type PluginPermission,
  type ReporterExtension,
} from './index.js';

function analyzerManifest() {
  return {
    manifestVersion: 1,
    apiVersion: 1,
    id: 'community.performance-analyzer',
    displayName: 'Performance analyzer',
    version: '1.2.3',
    kind: 'analyzer',
    capabilities: {
      provides: ['analysis.performance'],
      requires: ['evidence.session'],
    },
    permissions: ['evidence:read'],
    risk: 'read-only',
    execution: {
      mode: 'in-process',
      trusted: true,
    },
  } as const;
}

function reporterManifest() {
  return {
    manifestVersion: 1,
    apiVersion: 1,
    id: 'community.html-reporter',
    displayName: 'HTML reporter',
    version: '1.0.0',
    kind: 'reporter',
    capabilities: {
      provides: ['report.html'],
      requires: ['evidence.session'],
    },
    permissions: ['evidence:read', 'artifacts:write'],
    risk: 'low',
    execution: {
      mode: 'in-process',
      trusted: true,
      timeoutMs: 1_000,
    },
  } as const;
}

function actionManifest() {
  return {
    manifestVersion: 1,
    apiVersion: 1,
    id: 'community.android-actions',
    displayName: 'Android actions',
    version: '1.0.0-beta.1',
    kind: 'action',
    capabilities: {
      provides: ['action.device-tap'],
      requires: ['device.android'],
    },
    permissions: ['device:control'],
    risk: 'high',
    execution: {
      mode: 'external-process',
      protocol: EXTERNAL_PLUGIN_PROTOCOL,
      command: 'node',
      args: ['plugin.js'],
      shell: false,
      environmentAllowlist: ['RN_OBSERVER_DEVICE_ID'],
      requestTimeoutMs: 2_000,
    },
  } as const;
}

function host(
  grantedPermissions: readonly PluginPermission[] = [
    'evidence:read',
    'artifacts:write',
  ],
): PluginHostContext {
  return {
    projectRoot: 'C:\\app',
    artifactRoot: 'C:\\app\\.artifacts',
    capabilities: ['evidence.session', 'device.android'],
    grantedPermissions,
  };
}

function emptySession() {
  return {
    id: 'session-1',
    projectRoot: 'C:\\app',
    startedAt: '2026-08-22T00:00:00.000Z',
    status: 'complete' as const,
    artifactIds: [],
    artifacts: [],
    timeline: [],
  };
}

function parsedAnalyzerManifest(): AnalyzerPluginManifest {
  const result = validatePluginManifest(analyzerManifest());
  if (!result.success || result.value.kind !== 'analyzer') {
    throw new Error('fixture manifest invalid');
  }
  return result.value;
}

describe('plugin manifest conformance', () => {
  it('normalizes a versioned trusted analyzer manifest', () => {
    const result = validatePluginManifest(analyzerManifest());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.value).toMatchObject({
      manifestVersion: 1,
      apiVersion: 1,
      kind: 'analyzer',
      execution: {
        mode: 'in-process',
        trusted: true,
        timeoutMs: DEFAULT_PLUGIN_TIMEOUT_MS,
      },
    });
  });

  it('rejects incompatible isolation and underdeclared risk', () => {
    const providerInProcess = {
      ...analyzerManifest(),
      id: 'community.adb-provider',
      kind: 'provider',
    };
    const providerResult = validatePluginManifest(providerInProcess);
    expect(providerResult.success).toBe(false);
    if (!providerResult.success) {
      expect(providerResult.issues.map((entry) => entry.code)).toContain(
        'in_process_kind_forbidden',
      );
    }

    const lowRiskAction = {
      ...actionManifest(),
      risk: 'read-only',
    };
    const actionResult = validatePluginManifest(lowRiskAction);
    expect(actionResult.success).toBe(false);
    if (!actionResult.success) {
      expect(actionResult.issues.map((entry) => entry.code)).toContain(
        'risk_underdeclared',
      );
    }
  });

  it('rejects unsupported versions, duplicates and unsafe shell execution', () => {
    const result = validatePluginManifest({
      ...actionManifest(),
      manifestVersion: 2,
      permissions: ['device:control', 'device:control'],
      execution: { ...actionManifest().execution, shell: true },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.issues.map((entry) => entry.code);
      expect(codes).toContain('unsupported_manifest_version');
      expect(codes).toContain('duplicate');
      expect(codes).toContain('shell_forbidden');
    }
  });

  it('describes the isolated external action protocol without executing it', () => {
    const descriptor = createExternalPluginDescriptor(actionManifest());
    expect(descriptor.methods).toContain(EXTERNAL_PLUGIN_METHODS.actionExecute);
    expect(descriptor.methods).not.toContain(
      EXTERNAL_PLUGIN_METHODS.providerCollect,
    );
    expect(descriptor.manifest.execution).toMatchObject({
      shell: false,
      maxMessageBytes: DEFAULT_EXTERNAL_MAX_MESSAGE_BYTES,
    });
  });

  it('checks extension method shape in addition to its manifest', () => {
    const report = inspectPluginConformance({ manifest: analyzerManifest() });
    expect(report).toMatchObject({
      valid: false,
      kind: 'analyzer',
      pluginId: 'community.performance-analyzer',
    });
    expect(report.issues.map((entry) => entry.code)).toContain(
      'missing_analyze',
    );
  });
});

describe('plugin registry lifecycle and isolation', () => {
  it('registers a raw conforming extension with normalized manifest defaults', async () => {
    const registry = new PluginRegistry(host());
    const manifest = registry.register({
      manifest: analyzerManifest(),
      analyze: () => ({ findings: [] }),
    });
    expect(manifest.execution.timeoutMs).toBe(DEFAULT_PLUGIN_TIMEOUT_MS);
    await expect(
      registry.analyze(manifest.id, { evidence: [], configuration: {} }),
    ).resolves.toEqual({ findings: [] });
  });

  it('initializes once, invokes an analyzer and disposes it', async () => {
    const lifecycle: string[] = [];
    const extension: AnalyzerExtension = {
      manifest: parsedAnalyzerManifest(),
      initialize: () => {
        lifecycle.push('initialize');
      },
      analyze: (_request, context) => {
        lifecycle.push(context.phase);
        return {
          findings: [
            {
              schemaVersion: '1.0',
              id: 'performance.regression',
              ruleId: 'performance.regression',
              title: 'Regression observed',
              description: 'The repeated UI FPS experiment breached policy.',
              outcome: 'FAIL',
              severity: 'medium',
              confidence: 0.8,
              category: 'performance',
              controls: [],
              evidence: [
                {
                  id: 'metric-ui-fps',
                  kind: 'performance-samples',
                  relation: 'supports',
                },
              ],
              limitations: [],
            },
          ],
        };
      },
      dispose: () => {
        lifecycle.push('dispose');
      },
    };
    const registry = new PluginRegistry(host());
    registry.register(extension);
    await Promise.all([
      registry.initialize(extension.manifest.id),
      registry.initialize(extension.manifest.id),
    ]);
    const result = await registry.analyze(extension.manifest.id, {
      evidence: [],
      configuration: {},
    });
    expect(result.findings[0]?.title).toBe('Regression observed');
    expect(lifecycle).toEqual(['initialize', 'analyze']);
    await registry.disposeAll();
    expect(lifecycle).toEqual(['initialize', 'analyze', 'dispose']);
    expect(registry.list()[0]?.state).toBe('disposed');
  });

  it('fails closed when a declared permission was not granted', async () => {
    const manifestResult = validatePluginManifest(reporterManifest());
    if (!manifestResult.success || manifestResult.value.kind !== 'reporter') {
      throw new Error('fixture manifest invalid');
    }
    const reporter: ReporterExtension = {
      manifest: manifestResult.value,
      report: () => ({ artifacts: [] }),
    };
    const registry = new PluginRegistry(host(['evidence:read']));
    registry.register(reporter);
    await expect(registry.initialize(reporter.manifest.id)).rejects.toThrow(
      PluginManifestError,
    );
    expect(registry.list()[0]?.state).toBe('failed');
  });

  it('validates reporter output at the runtime boundary', async () => {
    const manifestResult = validatePluginManifest(reporterManifest());
    if (!manifestResult.success || manifestResult.value.kind !== 'reporter') {
      throw new Error('fixture manifest invalid');
    }
    const reporter: ReporterExtension = {
      manifest: manifestResult.value,
      report: () => ({
        artifacts: [
          {
            path: 'report.html',
            mimeType: 'text/html',
            label: 'HTML report',
          },
        ],
        summary: '1 finding',
      }),
    };
    const registry = new PluginRegistry(host());
    registry.register(reporter);
    const result = await registry.report(reporter.manifest.id, {
      session: emptySession(),
      findings: [],
      outputDirectory: 'reports',
      configuration: {},
    });
    expect(result.artifacts[0]).toMatchObject({
      path: 'report.html',
      mimeType: 'text/html',
    });
  });

  it('rejects malformed analyzer output from untyped community code', async () => {
    const registry = new PluginRegistry(host());
    const manifest = registry.register({
      manifest: analyzerManifest(),
      analyze: () => ({ findings: [{ title: '' }] }),
    });
    await expect(
      registry.analyze(manifest.id, { evidence: [], configuration: {} }),
    ).rejects.toThrow(PluginManifestError);
  });

  it('cooperatively aborts a timed-out trusted extension', async () => {
    let observedAbort = false;
    const analyzer: AnalyzerExtension = {
      manifest: parsedAnalyzerManifest(),
      analyze: (_request, context) =>
        new Promise((_resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              observedAbort = true;
              reject(context.signal.reason);
            },
            { once: true },
          );
        }),
    };
    const registry = new PluginRegistry(host());
    registry.register(analyzer);
    await expect(
      registry.analyze(
        analyzer.manifest.id,
        { evidence: [], configuration: {} },
        { timeoutMs: 10 },
      ),
    ).rejects.toThrow(PluginTimeoutError);
    expect(observedAbort).toBe(true);
  });

  it('stores external descriptors but refuses in-process invocation', async () => {
    const registry = new PluginRegistry(host());
    const descriptor = registry.registerExternal(actionManifest());
    expect(registry.getExternal(descriptor.manifest.id)).toEqual(descriptor);
    expect(registry.list()[0]).toMatchObject({
      state: 'external',
      isolation: 'external-process',
    });
    await expect(
      registry.initialize(descriptor.manifest.id),
    ).rejects.toMatchObject({
      code: 'PLUGIN_EXTERNAL_ONLY',
    } satisfies Partial<PluginRegistryError>);
  });

  it('rejects duplicate IDs across in-process and external plugins', () => {
    const manifest = parsedAnalyzerManifest();
    const registry = new PluginRegistry(host());
    registry.register({
      manifest,
      analyze: () => ({ findings: [] }),
    });
    expect(() =>
      registry.register({
        manifest,
        analyze: () => ({ findings: [] }),
      }),
    ).toThrow(PluginRegistryError);
  });
});
