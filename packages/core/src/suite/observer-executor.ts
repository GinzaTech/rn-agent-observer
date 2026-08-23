import {
  PerformanceBudgetSchema,
  type AssuranceFinding,
  type EvidenceReference,
  type ScreenState,
  type SuiteRisk,
} from '@rn-agent-observer/schemas';
import type { ObserverCore } from '../index.js';
import { loadPerformanceBaseline } from '../performance/experiment.js';
import { runObserverMemoryGrowth } from '../performance/memory-growth.js';
import {
  runObserverPerformanceExperiment,
  type ObserverPerformanceExperimentOptions,
} from '../performance/observer-experiment.js';
import {
  runPassiveSecurityAudit,
  type PassiveSecurityAuditResult,
} from '../security/passive-audit.js';
import type {
  ActiveSecurityScenarioResult,
  MalformedDeepLinkMutation,
} from '../security/active-scenario.js';
import {
  auditOsvDependencies,
  generateSupplyChainInventory,
} from '../security/supply-chain.js';
import type {
  SuiteCommandContext,
  SuiteCommandExecutor,
  SuiteCommandResult,
} from './runner.js';

export interface ObserverSuiteCommandDescriptor {
  risk: SuiteRisk;
  capabilities: readonly string[];
}

/**
 * Per-workflow confirmation for persistent permission changes. A suite file
 * cannot grant this on its own, which keeps a reviewed declarative suite from
 * silently changing a device when it is run through another adapter.
 */
export interface ObserverSuiteExecutorOptions {
  readonly confirmPersistentPermissionChange?: boolean;
}

export const OBSERVER_SUITE_COMMANDS = {
  status: { risk: 'read', capabilities: [] },
  devices: { risk: 'read', capabilities: ['adb'] },
  'device-info': { risk: 'read', capabilities: ['device'] },
  'app-state': { risk: 'read', capabilities: ['device'] },
  'device-network': { risk: 'read', capabilities: ['device'] },
  screenshot: { risk: 'read', capabilities: ['screenshot'] },
  'ui-tree': { risk: 'read', capabilities: ['ui-tree'] },
  snapshot: { risk: 'read', capabilities: ['ui-tree'] },
  'understand-screen': {
    risk: 'read',
    capabilities: ['screen-understanding'],
  },
  'ui-model': { risk: 'read', capabilities: ['runtime-ui-model'] },
  logs: { risk: 'read', capabilities: ['logs'] },
  performance: { risk: 'read', capabilities: ['performance'] },
  'performance-idle': { risk: 'read', capabilities: ['performance'] },
  'performance-replay': {
    risk: 'app-state',
    capabilities: ['performance', 'device'],
  },
  'performance-startup': {
    risk: 'app-state',
    capabilities: ['device'],
  },
  'performance-memory-growth': {
    risk: 'app-state',
    capabilities: ['performance', 'device'],
  },
  'metro-network': { risk: 'read', capabilities: ['metro'] },
  'devtools-profile': { risk: 'read', capabilities: ['metro'] },
  'devtools-export': { risk: 'read', capabilities: ['metro'] },
  'render-stats': { risk: 'read', capabilities: ['instrumentation'] },
  'network-requests': { risk: 'read', capabilities: ['logs'] },
  'network-summary': { risk: 'read', capabilities: ['logs'] },
  observe: { risk: 'read', capabilities: ['device'] },
  'a11y-audit': { risk: 'read', capabilities: ['ui-tree'] },
  'resilience-readiness': {
    risk: 'read',
    capabilities: ['device', 'screen-understanding', 'logs'],
  },
  'app-data': { risk: 'read', capabilities: ['instrumentation'] },
  routes: { risk: 'read', capabilities: [] },
  assert: { risk: 'read', capabilities: ['ui-tree'] },
  diagnose: { risk: 'read', capabilities: ['device'] },
  compare: { risk: 'read', capabilities: [] },
  'coverage-analyze': { risk: 'read', capabilities: [] },
  'security-audit': { risk: 'read', capabilities: ['security-passive'] },
  'security-sbom': { risk: 'read', capabilities: ['security-passive'] },
  'security-dependencies': {
    risk: 'read',
    capabilities: ['security-passive'],
  },
  'security-active-deep-link': {
    risk: 'app-state',
    capabilities: ['device', 'screen-understanding', 'logs'],
  },
  'security-active-permission': {
    risk: 'device-state',
    capabilities: ['device', 'screen-understanding', 'logs'],
  },
  'session-get': { risk: 'read', capabilities: [] },
  'replay-export': { risk: 'read', capabilities: [] },
  launch: { risk: 'app-state', capabilities: ['device'] },
  reload: { risk: 'app-state', capabilities: ['device'] },
  tap: { risk: 'app-state', capabilities: ['device'] },
  press: { risk: 'app-state', capabilities: ['device'] },
  swipe: { risk: 'app-state', capabilities: ['device'] },
  'type-text': { risk: 'app-state', capabilities: ['device'] },
  back: { risk: 'app-state', capabilities: ['device'] },
  'deep-link': { risk: 'app-state', capabilities: ['device'] },
  'replay-run': { risk: 'app-state', capabilities: ['device'] },
  'permission-grant': {
    risk: 'persistent-permission',
    capabilities: ['device'],
  },
  'permission-revoke': {
    risk: 'persistent-permission',
    capabilities: ['device'],
  },
  'trace-start': { risk: 'device-state', capabilities: ['device'] },
  'trace-stop': { risk: 'device-state', capabilities: ['device'] },
  'record-start': { risk: 'device-state', capabilities: ['device'] },
  'record-stop': { risk: 'device-state', capabilities: ['device'] },
  'session-start': { risk: 'read', capabilities: [] },
  'session-stop': { risk: 'read', capabilities: [] },
} as const satisfies Record<string, ObserverSuiteCommandDescriptor>;

export type ObserverSuiteCommand = keyof typeof OBSERVER_SUITE_COMMANDS;

const ensureKnownKeys = (
  input: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void => {
  const unknown = Object.keys(input).filter((key) => !keys.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(`Unknown command input keys: ${unknown.join(', ')}`);
  }
};

const stringInput = (
  input: Readonly<Record<string, unknown>>,
  key: string,
  required = false,
): string | undefined => {
  const value = input[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${key} must be a non-empty string`);
  }
  return value;
};

const numberInput = (
  input: Readonly<Record<string, unknown>>,
  key: string,
  required = false,
): number | undefined => {
  const value = input[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${key} must be a finite number`);
  }
  return value;
};

const booleanInput = (
  input: Readonly<Record<string, unknown>>,
  key: string,
): boolean | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new TypeError(`${key} must be a boolean`);
  }
  return value;
};

const stringArrayInput = (
  input: Readonly<Record<string, unknown>>,
  key: string,
): string[] | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${key} must be an array of strings`);
  }
  return value;
};

const recordArrayInput = (
  input: Readonly<Record<string, unknown>>,
  key: string,
  required = false,
): Readonly<Record<string, unknown>>[] | undefined => {
  const value = input[key];
  if (value === undefined && !required) return undefined;
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) =>
        typeof entry !== 'object' || entry === null || Array.isArray(entry),
    )
  ) {
    throw new TypeError(`${key} must be an array of objects`);
  }
  return value as Readonly<Record<string, unknown>>[];
};

const ACTIVE_SCREEN_STATES = new Set<ScreenState>([
  'not-running',
  'background',
  'blank',
  'loading',
  'error',
  'empty',
  'content',
]);

const activeScreenStatesInput = (
  input: Readonly<Record<string, unknown>>,
): ScreenState[] => {
  const states = stringArrayInput(input, 'allowedScreenStates');
  if (!states || states.length === 0) {
    throw new TypeError('allowedScreenStates must be a non-empty array');
  }
  if (states.some((state) => !ACTIVE_SCREEN_STATES.has(state as ScreenState))) {
    throw new TypeError(
      'allowedScreenStates contains an unsupported screen state',
    );
  }
  return [...new Set(states)] as ScreenState[];
};

const evidenceKindForKey = (key: string, fallback: string): string => {
  const normalized = key.toLowerCase();
  if (normalized.includes('screenshot')) return 'screenshot';
  if (normalized.includes('uitree')) return 'ui-tree';
  if (normalized.includes('understanding')) return 'screen-understanding';
  if (normalized.includes('model')) return 'runtime-ui-model';
  if (normalized.includes('profile')) return 'profile';
  if (normalized.includes('trace')) return 'trace';
  if (normalized.includes('recording')) return 'recording';
  if (normalized.includes('comparison')) return 'comparison';
  return fallback;
};

const evidenceFromOutput = (
  command: string,
  output: unknown,
): EvidenceReference[] => {
  if (typeof output !== 'object' || output === null) return [];
  const record = output as Record<string, unknown>;
  const references = new Map<string, EvidenceReference>();
  const artifact = record.artifact;
  if (typeof artifact === 'object' && artifact !== null) {
    const value = artifact as Record<string, unknown>;
    if (typeof value.id === 'string') {
      references.set(value.id, {
        id: value.id,
        kind: typeof value.kind === 'string' ? value.kind : command,
        relation: 'supports',
        ...(typeof value.path === 'string' ? { uri: value.path } : {}),
      });
    }
  }
  const artifacts = record.artifacts;
  if (typeof artifacts === 'object' && artifacts !== null) {
    const values = artifacts as Record<string, unknown>;
    for (const [key, value] of Object.entries(values)) {
      if (!key.endsWith('Id') || typeof value !== 'string') continue;
      const pathKey = `${key.slice(0, -2)}Path`;
      const uri = values[pathKey];
      references.set(value, {
        id: value,
        kind: evidenceKindForKey(key, command),
        relation: 'supports',
        ...(typeof uri === 'string' ? { uri } : {}),
      });
    }
  }
  if (typeof record.artifactId === 'string') {
    references.set(record.artifactId, {
      id: record.artifactId,
      kind: evidenceKindForKey('artifactId', command),
      relation: 'supports',
    });
  }
  return [...references.values()];
};

const withEvidence = (
  command: string,
  output: unknown,
): SuiteCommandResult => ({
  output,
  evidence: (() => {
    const artifacts = evidenceFromOutput(command, output);
    if (artifacts.length > 0) return artifacts;
    try {
      const sha256 = createHash('sha256')
        .update(JSON.stringify(output))
        .digest('hex');
      return [
        {
          id: `${command}-${sha256.slice(0, 16)}`,
          kind: command,
          relation: 'supports' as const,
          sha256,
        },
      ];
    } catch {
      return [];
    }
  })(),
});

const executeObserverCommand = async (
  core: ObserverCore,
  command: ObserverSuiteCommand,
  input: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
  options: ObserverSuiteExecutorOptions = {},
): Promise<unknown> => {
  if (command === 'status') {
    ensureKnownKeys(input, []);
    return core.getStatus();
  }
  if (command === 'devices') {
    ensureKnownKeys(input, []);
    return core.deviceList();
  }
  if (command === 'device-info') {
    ensureKnownKeys(input, []);
    return core.deviceInfo();
  }
  if (command === 'app-state') {
    ensureKnownKeys(input, []);
    return core.getAppState();
  }
  if (command === 'device-network') {
    ensureKnownKeys(input, ['windowMs']);
    return core.deviceNetworkDelta(numberInput(input, 'windowMs'));
  }
  if (command === 'screenshot') {
    ensureKnownKeys(input, []);
    return core.screenshot();
  }
  if (command === 'ui-tree') {
    ensureKnownKeys(input, []);
    return core.getUiTree();
  }
  if (command === 'snapshot') {
    ensureKnownKeys(input, ['interactiveOnly']);
    const interactiveOnly = booleanInput(input, 'interactiveOnly');
    return core.snapshot({
      ...(interactiveOnly !== undefined ? { interactiveOnly } : {}),
    });
  }
  if (command === 'understand-screen') {
    ensureKnownKeys(input, ['stuckAfterMs']);
    const stuckAfterMs = numberInput(input, 'stuckAfterMs');
    return core.understandScreen({
      ...(stuckAfterMs !== undefined ? { stuckAfterMs } : {}),
    });
  }
  if (command === 'ui-model') {
    ensureKnownKeys(input, []);
    return core.runtimeUiModel();
  }
  if (command === 'logs') {
    ensureKnownKeys(input, ['level', 'keyword', 'source', 'limit', 'since']);
    const level = stringInput(input, 'level');
    if (
      level !== undefined &&
      !['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(level)
    ) {
      throw new TypeError('level is not a supported log level');
    }
    const keyword = stringInput(input, 'keyword');
    const source = stringInput(input, 'source');
    const limit = numberInput(input, 'limit');
    const since = stringInput(input, 'since');
    return core.getLogs({
      ...(level
        ? {
            level: level as
              'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
          }
        : {}),
      ...(keyword ? { keyword } : {}),
      ...(source ? { source } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(since ? { since } : {}),
    });
  }
  if (command === 'performance') {
    ensureKnownKeys(input, []);
    return core.performanceSnapshot();
  }
  if (command === 'performance-memory-growth') {
    ensureKnownKeys(input, [
      'scenarioId',
      'replayPath',
      'cycles',
      'settleMs',
      'maxGrowthMb',
    ]);
    const scenarioId = stringInput(input, 'scenarioId', true) ?? '';
    const replayPath = stringInput(input, 'replayPath', true) ?? '';
    const cycles = numberInput(input, 'cycles');
    const settleMs = numberInput(input, 'settleMs');
    const maxGrowthMb = numberInput(input, 'maxGrowthMb');
    return runObserverMemoryGrowth(core, {
      scenarioId,
      replayPath,
      ...(cycles !== undefined ? { cycles } : {}),
      ...(settleMs !== undefined ? { settleMs } : {}),
      ...(maxGrowthMb !== undefined ? { maxGrowthMb } : {}),
      ...(signal ? { signal } : {}),
    });
  }
  if (
    command === 'performance-idle' ||
    command === 'performance-replay' ||
    command === 'performance-startup'
  ) {
    ensureKnownKeys(input, [
      'scenarioId',
      'replayPath',
      'samples',
      'warmupSamples',
      'intervalMs',
      'budgets',
      'baselinePath',
    ]);
    const scenarioId = stringInput(input, 'scenarioId', true) ?? '';
    const replayPath = stringInput(input, 'replayPath');
    if (command === 'performance-replay' && !replayPath) {
      throw new TypeError('performance-replay requires replayPath');
    }
    const rawBudgets = input.budgets;
    if (rawBudgets !== undefined && !Array.isArray(rawBudgets)) {
      throw new TypeError('budgets must be an array');
    }
    const budgets = rawBudgets?.map((budget) =>
      PerformanceBudgetSchema.parse(budget),
    );
    const baselinePath = stringInput(input, 'baselinePath');
    const baseline = baselinePath
      ? await loadPerformanceBaseline(baselinePath)
      : undefined;
    const samples = numberInput(input, 'samples');
    const warmupSamples = numberInput(input, 'warmupSamples');
    const intervalMs = numberInput(input, 'intervalMs');
    const experimentOptions: ObserverPerformanceExperimentOptions = {
      scenarioId,
      mode:
        command === 'performance-replay'
          ? 'interaction'
          : command === 'performance-startup'
            ? 'startup'
            : 'idle',
      ...(replayPath ? { replayPath } : {}),
      ...(samples !== undefined ? { samples } : {}),
      ...(warmupSamples !== undefined ? { warmupSamples } : {}),
      ...(intervalMs !== undefined ? { intervalMs } : {}),
      ...(budgets ? { budgets } : {}),
      ...(baseline ? { baseline } : {}),
      ...(signal ? { signal } : {}),
    };
    return runObserverPerformanceExperiment(core, experimentOptions);
  }
  if (
    command === 'metro-network' ||
    command === 'devtools-profile' ||
    command === 'devtools-export'
  ) {
    ensureKnownKeys(input, ['metroUrl', 'durationMs']);
    const metroUrl = stringInput(input, 'metroUrl');
    const durationMs = numberInput(input, 'durationMs');
    const options = {
      ...(metroUrl ? { metroUrl } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
    if (command === 'metro-network') return core.metroNetworkSnapshot(options);
    if (command === 'devtools-profile') return core.devtoolsProfile(options);
    return core.devtoolsExport(options);
  }
  if (command === 'render-stats') {
    ensureKnownKeys(input, []);
    return { renders: await core.getReactRenderStats() };
  }
  if (command === 'network-requests') {
    ensureKnownKeys(input, []);
    return core.getNetworkRequests();
  }
  if (command === 'network-summary') {
    ensureKnownKeys(input, []);
    return core.getNetworkSummary();
  }
  if (command === 'observe') {
    ensureKnownKeys(input, ['include']);
    const include = stringArrayInput(input, 'include');
    const supported = [
      'screenshot',
      'ui_tree',
      'route',
      'performance',
      'network',
      'logs',
      'app_state',
    ] as const;
    if (include?.some((item) => !supported.includes(item as never))) {
      throw new TypeError('include contains an unsupported observation');
    }
    return core.observeScreen(
      include as Array<(typeof supported)[number]> | undefined,
    );
  }
  if (command === 'a11y-audit') {
    ensureKnownKeys(input, []);
    return core.accessibilityAudit();
  }
  if (command === 'resilience-readiness') {
    ensureKnownKeys(input, []);
    return core.resilienceReadiness();
  }
  if (command === 'app-data') {
    ensureKnownKeys(input, ['namespace']);
    const namespace = stringInput(input, 'namespace');
    const events = await core.getAppData();
    return namespace
      ? events.filter((event) => event.namespace === namespace)
      : events;
  }
  if (command === 'routes') {
    ensureKnownKeys(input, []);
    return core.listRoutes();
  }
  if (command === 'assert') {
    ensureKnownKeys(input, ['testId', 'text', 'visible']);
    const testId = stringInput(input, 'testId');
    const text = stringInput(input, 'text');
    const visible = booleanInput(input, 'visible');
    return core.assertElement({
      ...(testId ? { testId } : {}),
      ...(text ? { text } : {}),
      ...(visible !== undefined ? { visible } : {}),
    });
  }
  if (command === 'diagnose') {
    ensureKnownKeys(input, [
      'uiFpsLow',
      'uiFpsCritical',
      'jsBlockingMs',
      'jsBlockingHighMs',
      'slowRequestMs',
      'verySlowRequestMs',
      'renderCount',
    ]);
    return core.diagnose(
      Object.fromEntries(
        Object.keys(input).map((key) => [key, numberInput(input, key, true)]),
      ),
    );
  }
  if (command === 'compare') {
    ensureKnownKeys(input, ['before', 'after', 'beforeUi', 'afterUi']);
    const before = stringInput(input, 'before', true) ?? '';
    const after = stringInput(input, 'after', true) ?? '';
    const beforeUi = stringInput(input, 'beforeUi');
    const afterUi = stringInput(input, 'afterUi');
    if ((beforeUi && !afterUi) || (!beforeUi && afterUi)) {
      throw new TypeError('beforeUi and afterUi must be provided together');
    }
    return core.compareScreens(
      before,
      after,
      beforeUi && afterUi ? { before: beforeUi, after: afterUi } : undefined,
    );
  }
  if (command === 'coverage-analyze') {
    ensureKnownKeys(input, ['coverage']);
    if (input.coverage === undefined) {
      throw new TypeError('coverage is required');
    }
    return core.analyzeRouteActionCoverage(input.coverage);
  }
  if (command === 'security-active-deep-link') {
    ensureKnownKeys(input, [
      'scenarioId',
      'baseUri',
      'probes',
      'allowedScreenStates',
      'maximumErrorLogs',
      'timeoutMs',
      'settleMs',
    ]);
    const probes = recordArrayInput(input, 'probes', true) ?? [];
    const parsedProbes = probes.map((probe) => {
      ensureKnownKeys(probe, ['id', 'mutation', 'parameter']);
      return {
        id: stringInput(probe, 'id', true) ?? '',
        mutation: (stringInput(probe, 'mutation', true) ??
          '') as MalformedDeepLinkMutation,
        parameter: stringInput(probe, 'parameter', true) ?? '',
      };
    });
    const maximumErrorLogs = numberInput(input, 'maximumErrorLogs');
    const timeoutMs = numberInput(input, 'timeoutMs');
    const settleMs = numberInput(input, 'settleMs');
    return core.runMalformedDeepLinkSecurityScenario(
      {
        scenarioId: stringInput(input, 'scenarioId', true) ?? '',
        kind: 'malformed-deep-link',
        appId: core.appId,
        risk: 'app-state',
        ownership: 'owned',
        baseUri: stringInput(input, 'baseUri', true) ?? '',
        probes: parsedProbes,
        allowedScreenStates: activeScreenStatesInput(input),
        maximumErrorLogs: maximumErrorLogs ?? 0,
        timeoutMs: timeoutMs ?? 10_000,
        ...(settleMs !== undefined ? { settleMs } : {}),
      },
      signal,
    );
  }
  if (command === 'security-active-permission') {
    ensureKnownKeys(input, [
      'scenarioId',
      'permission',
      'probes',
      'allowedScreenStates',
      'maximumErrorLogs',
      'timeoutMs',
      'cleanupTimeoutMs',
      'settleMs',
    ]);
    const probes = recordArrayInput(input, 'probes', true) ?? [];
    const allowedScreenStates = activeScreenStatesInput(input);
    const maximumErrorLogs = numberInput(input, 'maximumErrorLogs');
    const timeoutMs = numberInput(input, 'timeoutMs');
    const cleanupTimeoutMs = numberInput(input, 'cleanupTimeoutMs');
    const settleMs = numberInput(input, 'settleMs');
    return core.runPermissionTransitionSecurityScenario(
      {
        scenarioId: stringInput(input, 'scenarioId', true) ?? '',
        kind: 'permission-transition',
        appId: core.appId,
        risk: 'device-state',
        ownership: 'owned',
        permission: stringInput(input, 'permission', true) ?? '',
        probes: probes.map((probe) => {
          ensureKnownKeys(probe, ['id', 'granted']);
          const granted = booleanInput(probe, 'granted');
          if (granted === undefined) {
            throw new TypeError('probes[].granted must be a boolean');
          }
          return {
            id: stringInput(probe, 'id', true) ?? '',
            granted,
            allowedScreenStates,
            maximumErrorLogs: maximumErrorLogs ?? 0,
          };
        }),
        timeoutMs: timeoutMs ?? 10_000,
        cleanupTimeoutMs: cleanupTimeoutMs ?? 5_000,
        ...(settleMs !== undefined ? { settleMs } : {}),
      },
      signal,
    );
  }
  if (command === 'security-audit') {
    ensureKnownKeys(input, [
      'manifestPaths',
      'networkSecurityConfigPaths',
      'textPaths',
      'scanArtifacts',
      'maxFiles',
      'maxTotalBytes',
    ]);
    const manifestPaths = stringArrayInput(input, 'manifestPaths');
    const networkSecurityConfigPaths = stringArrayInput(
      input,
      'networkSecurityConfigPaths',
    );
    const textPaths = stringArrayInput(input, 'textPaths');
    const scanArtifacts = booleanInput(input, 'scanArtifacts');
    const maxFiles = numberInput(input, 'maxFiles');
    const maxTotalBytes = numberInput(input, 'maxTotalBytes');
    return runPassiveSecurityAudit({
      projectRoot: core.projectRoot,
      artifactRoot: core.artifacts.root,
      ...(manifestPaths ? { manifestPaths } : {}),
      ...(networkSecurityConfigPaths ? { networkSecurityConfigPaths } : {}),
      ...(textPaths ? { textPaths } : {}),
      ...(scanArtifacts !== undefined ? { scanArtifacts } : {}),
      ...(maxFiles !== undefined ? { maxFiles } : {}),
      ...(maxTotalBytes !== undefined ? { maxTotalBytes } : {}),
    });
  }
  if (command === 'security-sbom' || command === 'security-dependencies') {
    ensureKnownKeys(input, ['lockfilePath']);
    const lockfilePath = stringInput(input, 'lockfilePath');
    let inventory: Awaited<ReturnType<typeof generateSupplyChainInventory>>;
    try {
      inventory = await generateSupplyChainInventory({
        projectRoot: core.projectRoot,
        ...(lockfilePath ? { lockfilePath } : {}),
      });
    } catch {
      const limitation =
        'A bounded pnpm lockfile inventory could not be generated for this project';
      const sha256 = createHash('sha256').update(limitation).digest('hex');
      const evidence: EvidenceReference[] = [
        {
          id: `supply-chain-unavailable-${sha256.slice(0, 16)}`,
          kind: 'supply-chain-inventory-status',
          relation: 'supports',
          sha256,
        },
      ];
      const findings: AssuranceFinding[] = [
        {
          schemaVersion: '1.0',
          id: 'security.supply-chain.inventory-unavailable',
          ruleId: 'security.supply-chain.inventory',
          title: 'Locked dependency inventory was not verified',
          description: limitation,
          outcome: 'NOT_VERIFIED',
          severity: 'info',
          confidence: 1,
          category: 'security',
          controls: ['MASVS-CODE-1'],
          evidence,
          limitations: [limitation],
        },
      ];
      return {
        inventory: { available: false, limitation },
        ...(command === 'security-dependencies'
          ? {
              audit: {
                outcome: 'NOT_VERIFIED',
                findings,
                evidence,
                limitations: [limitation],
              },
            }
          : {}),
      };
    }
    const sbomArtifact = core.artifacts.write(
      'security-report',
      JSON.stringify(inventory.bom, null, 2),
      {
        extension: '.cdx.json',
        mimeType: 'application/vnd.cyclonedx+json',
      },
    );
    if (command === 'security-sbom') {
      return {
        inventory: {
          componentCount: inventory.componentCount,
          sha256: inventory.sha256,
          limitations: inventory.limitations,
        },
        artifact: sbomArtifact,
      };
    }
    const audit = await auditOsvDependencies({
      inventory,
      ...(signal ? { signal } : {}),
    });
    const auditArtifact = core.artifacts.write(
      'security-report',
      JSON.stringify(audit, null, 2),
      { extension: '.json', mimeType: 'application/json' },
    );
    return {
      inventory: {
        componentCount: inventory.componentCount,
        sha256: inventory.sha256,
        limitations: inventory.limitations,
      },
      audit,
      artifact: auditArtifact,
      artifacts: { sbom: sbomArtifact, audit: auditArtifact },
    };
  }
  if (command === 'session-get') {
    ensureKnownKeys(input, ['sessionId']);
    return core.getSession(stringInput(input, 'sessionId', true) ?? '');
  }
  if (command === 'replay-export') {
    ensureKnownKeys(input, ['sessionId']);
    return core.exportReplayScript(stringInput(input, 'sessionId', true) ?? '');
  }
  if (command === 'launch') {
    ensureKnownKeys(input, []);
    return core.appLaunch();
  }
  if (command === 'reload') {
    ensureKnownKeys(input, ['fast', 'metroUrl']);
    const fast = booleanInput(input, 'fast');
    const metroUrl = stringInput(input, 'metroUrl');
    return core.appReload({
      ...(fast !== undefined ? { fast } : {}),
      ...(metroUrl ? { metroUrl } : {}),
    });
  }
  if (command === 'tap') {
    ensureKnownKeys(input, ['testId', 'x', 'y']);
    const testId = stringInput(input, 'testId');
    if (testId) return core.tap({ testId });
    return core.tap({
      x: numberInput(input, 'x', true) ?? 0,
      y: numberInput(input, 'y', true) ?? 0,
    });
  }
  if (command === 'press') {
    ensureKnownKeys(input, ['ref', 'settleMs']);
    return core.press(
      stringInput(input, 'ref', true) ?? '',
      numberInput(input, 'settleMs'),
    );
  }
  if (command === 'swipe') {
    ensureKnownKeys(input, ['fromX', 'fromY', 'toX', 'toY', 'durationMs']);
    return core.swipe(
      {
        x: numberInput(input, 'fromX', true) ?? 0,
        y: numberInput(input, 'fromY', true) ?? 0,
      },
      {
        x: numberInput(input, 'toX', true) ?? 0,
        y: numberInput(input, 'toY', true) ?? 0,
      },
      numberInput(input, 'durationMs'),
    );
  }
  if (command === 'type-text') {
    ensureKnownKeys(input, ['text']);
    return core.typeText(stringInput(input, 'text', true) ?? '');
  }
  if (command === 'back') {
    ensureKnownKeys(input, []);
    return core.back();
  }
  if (command === 'deep-link') {
    ensureKnownKeys(input, ['uri']);
    return core.deepLink(stringInput(input, 'uri', true) ?? '');
  }
  if (command === 'replay-run') {
    ensureKnownKeys(input, ['path']);
    return core.runReplay(stringInput(input, 'path', true) ?? '');
  }
  if (command === 'permission-grant' || command === 'permission-revoke') {
    ensureKnownKeys(input, ['permission']);
    if (options.confirmPersistentPermissionChange !== true) {
      throw new TypeError(
        'Persistent permission suite commands require explicit per-run confirmation',
      );
    }
    return core.setPermission(
      stringInput(input, 'permission', true) ?? '',
      command === 'permission-grant',
      { confirmed: true },
    );
  }
  if (command === 'trace-start' || command === 'record-start') {
    ensureKnownKeys(input, ['durationMs']);
    const durationMs = numberInput(input, 'durationMs');
    return command === 'trace-start'
      ? core.startTrace(durationMs)
      : core.startRecording(durationMs);
  }
  if (command === 'trace-stop' || command === 'record-stop') {
    ensureKnownKeys(input, ['id']);
    const id = stringInput(input, 'id', true) ?? '';
    return command === 'trace-stop'
      ? core.stopTrace(id)
      : core.stopRecording(id);
  }
  if (command === 'session-start') {
    ensureKnownKeys(input, []);
    return core.startSession();
  }
  ensureKnownKeys(input, ['sessionId']);
  return core.stopSession(stringInput(input, 'sessionId'));
};

export const createObserverSuiteExecutor = (
  core: ObserverCore,
  options: ObserverSuiteExecutorOptions = {},
): SuiteCommandExecutor => ({
  execute: async (command, input, context: SuiteCommandContext) => {
    if (!(command in OBSERVER_SUITE_COMMANDS)) {
      throw new TypeError(`Unsupported observer suite command: ${command}`);
    }
    const supportedCommand = command as ObserverSuiteCommand;
    const descriptor = OBSERVER_SUITE_COMMANDS[supportedCommand];
    if (context.risk !== descriptor.risk) {
      throw new TypeError(
        `Command ${command} requires risk ${descriptor.risk}, received ${context.risk}`,
      );
    }
    if (context.signal.aborted) {
      throw new Error(`Command ${command} was aborted before execution`);
    }
    const output = await executeObserverCommand(
      core,
      supportedCommand,
      input,
      context.signal,
      options,
    );
    const result = withEvidence(command, output);
    if (supportedCommand === 'security-audit') {
      result.findings = (output as PassiveSecurityAuditResult).findings;
      result.evidence = (output as PassiveSecurityAuditResult).evidence;
    } else if (supportedCommand === 'coverage-analyze') {
      const coverage = output as Awaited<
        ReturnType<ObserverCore['analyzeRouteActionCoverage']>
      >;
      result.findings = [...coverage.result.findings];
      const references = new Map(
        (result.evidence ?? []).map((reference) => [reference.id, reference]),
      );
      for (const reference of coverage.result.evidence) {
        references.set(reference.id, reference);
      }
      result.evidence = [...references.values()];
    } else if (
      supportedCommand === 'security-active-deep-link' ||
      supportedCommand === 'security-active-permission'
    ) {
      const active = (output as { result: ActiveSecurityScenarioResult })
        .result;
      result.findings = active.findings;
      const references = new Map(
        (result.evidence ?? []).map((reference) => [reference.id, reference]),
      );
      for (const reference of active.evidence) {
        references.set(reference.id, reference);
      }
      result.evidence = [...references.values()];
    } else if (supportedCommand === 'a11y-audit') {
      const audit = output as Awaited<
        ReturnType<ObserverCore['accessibilityAudit']>
      >;
      result.findings = audit.findings;
      result.evidence = audit.evidence;
    } else if (supportedCommand === 'resilience-readiness') {
      const readiness = output as Awaited<
        ReturnType<ObserverCore['resilienceReadiness']>
      >;
      result.findings = readiness.findings;
      result.evidence = readiness.evidence;
    } else if (supportedCommand === 'security-dependencies') {
      const audit = (
        output as {
          audit: {
            findings: AssuranceFinding[];
            evidence: EvidenceReference[];
          };
        }
      ).audit;
      result.findings = audit.findings;
      result.evidence = audit.evidence;
    } else if (
      supportedCommand === 'performance-idle' ||
      supportedCommand === 'performance-replay' ||
      supportedCommand === 'performance-startup'
    ) {
      const experiment = output as Awaited<
        ReturnType<typeof runObserverPerformanceExperiment>
      >;
      result.findings = experiment.findings;
      result.evidence = experiment.findings.flatMap(
        (finding) => finding.evidence,
      );
    } else if (supportedCommand === 'performance-memory-growth') {
      const experiment = output as Awaited<
        ReturnType<typeof runObserverMemoryGrowth>
      >;
      result.findings = experiment.findings;
      result.evidence = experiment.evidence;
    }
    return result;
  },
});
import { createHash } from 'node:crypto';
