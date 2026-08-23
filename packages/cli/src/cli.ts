import { readFileSync } from 'node:fs';
import {
  OBSERVER_VERSION,
  ExternalPluginHost,
  ExternalTargetProviderClient,
  ObserverCore,
  PLUGIN_PERMISSIONS,
  TARGET_PLATFORMS,
  TARGET_PROVIDER_OPERATIONS,
  auditOsvDependencies,
  asObserverError,
  buildDashboardReport,
  createPerformanceBaseline,
  createExternalPluginDescriptor,
  generateSupplyChainInventory,
  initObserverConfig,
  loadPerformanceBaseline,
  loadPerformanceBudgets,
  listBuiltinSuites,
  loadPluginManifestFile,
  runPassiveSecurityAudit,
  readAndVerifySessionShareBundle,
  runObserverMemoryGrowth,
  runObserverPerformanceExperiment,
  runObserverSuiteWorkflow,
  runDoctor,
  startReadOnlyDashboardServer,
  targetProviderSupportMatrix,
  writeOfflineDashboard,
  writePerformanceBaseline,
  type DiagnosisThresholds,
  type MalformedDeepLinkMutation,
  type ObserverSuiteWorkflowResult,
  type PluginPermission,
  type TargetPlatform,
  type TargetProviderOperation,
} from '@rn-agent-observer/core';

export const HELP_TEXT = `rn-observe ${OBSERVER_VERSION}

Local runtime observability bridge for React Native and Expo on Android.

Usage:
  rn-observe status
  rn-observe doctor
  rn-observe init [--dry-run] [--force]
  rn-observe suite list
  rn-observe suite run NAME|SUITE.{json,yaml} [--reporter json,html,junit,sarif,github] [--output DIR] [--confirm-persistent-permission] [--strict]
  rn-observe run NAME|SUITE.{json,yaml} [...same options]
  rn-observe ci [--suite NAME[,NAME]] [--reporter json,html,junit,sarif,github] [--output DIR] [--confirm-persistent-permission] [--allow-not-verified]
  rn-observe security audit [--manifest PATH] [--network-config PATH] [--text PATH] [--no-artifacts] [--strict]
  rn-observe security sbom [--lockfile pnpm-lock.yaml]
  rn-observe security dependencies [--lockfile pnpm-lock.yaml] [--strict]
  rn-observe security active deep-link --scenario ID --base-uri URI --probe ID:MUTATION:PARAM --allow-state STATE [--max-errors N] [--timeout MS] [--settle MS] [--strict]
  rn-observe security active permission --scenario ID --permission NAME --probe ID:grant|revoke --allow-state STATE [--max-errors N] [--timeout MS] [--cleanup-timeout MS] [--settle MS] [--strict]
  rn-observe performance experiment --scenario ID (--replay SCRIPT.json | --idle | --startup) [--samples N] [--warmup N] [--interval MS] [--budget FILE] [--baseline FILE] [--write-baseline FILE] [--strict]
  rn-observe performance memory --scenario ID --replay SCRIPT.json [--cycles N] [--settle MS] [--max-growth-mb N] [--strict]
  rn-observe coverage analyze INPUT.json [--strict]
  rn-observe plugin check MANIFEST.json
  rn-observe target support [--manifest MANIFEST.json]
  rn-observe target collect --manifest MANIFEST.json --operation NAME --platform NAME [--device-id ID] [--app-id ID] [--grant PERMISSION] [--env NAME] [--cwd DIR] [--host-capability NAME] [--max-evidence N] [--max-payload-bytes N] [--strict]
  rn-observe dashboard build [--session ID] [--limit N] [--output dashboard/name.html]
  rn-observe open [--session ID] [--limit N] [--port N]
  rn-observe devices | device-info | launch | reload [--fast]
  rn-observe app-state | device-network [--window MS] | routes
  rn-observe metro-network [--duration MS] [--metro URL]
  rn-observe screenshot | ui-tree | snapshot [--interactive] | understand-screen [--stuck-after MS] | ui-model
  rn-observe logs | performance | render-stats | network | observe
  rn-observe tap (--test-id ID | --ref E1 [--settle MS] | --x X --y Y)
  rn-observe swipe --from X,Y --to X,Y [--duration MS]
  rn-observe type-text --text VALUE | back | deep-link --uri URI
  rn-observe permissions [list] | permissions grant --perm NAME --confirm-persistent-permission | permissions revoke --perm NAME --confirm-persistent-permission
  rn-observe assert (--test-id ID | --text VALUE) [--visible true|false]
  rn-observe a11y-audit | resilience readiness | app-data [--namespace NAME]
  rn-observe trace start [--duration MS] | trace stop TRACE_ID
  rn-observe record start [--duration MS] | record stop RECORDING_ID
  rn-observe replay run SCRIPT.json
  rn-observe replay export SESSION_ID
  rn-observe artifacts cleanup [--days N] [--dry-run]
  rn-observe session start | session stop [SESSION_ID] | session list [--limit N] | session get SESSION_ID | session graph SESSION_ID | session share SESSION_ID [--output shares/name.rnobs] [--include-text] [--strict]
  rn-observe bundle verify BUNDLE.rnobs [--sha256 HEX]
  rn-observe diagnose [--ui-fps-low N --ui-fps-critical N --js-blocking N --js-blocking-high N --slow-request N --very-slow-request N --render-count N]
  rn-observe compare BEFORE.png AFTER.png [--before-ui TREE.json --after-ui TREE.json]
  rn-observe devtools-export [--duration MS] [--metro URL]
  rn-observe devtools-profile [--duration MS] [--metro URL]

Environment:
  RN_OBSERVER_PROJECT_ROOT   Target React Native project (defaults to cwd)
  RN_OBSERVER_DEVICE_ID      ADB device serial when more than one is ready
  RN_OBSERVER_APP_ID         Android package override
  RN_OBSERVER_SESSION_ID     Session receiving events/artifacts
  RN_OBSERVER_METRO_URL      Metro bundler base URL (default http://127.0.0.1:8081)

Options:
  -h, --help                Show help
  -v, --version             Show version
`;

export interface CliIO {
  stdout: (value: string) => void;
  stderr: (value: string) => void;
}

export interface CliRunOptions {
  signal?: AbortSignal;
  progress?: boolean;
  environment?: Readonly<Record<string, string | undefined>>;
}

const defaultIO: CliIO = {
  stdout: (value) => process.stdout.write(`${value}\n`),
  stderr: (value) => process.stderr.write(`${value}\n`),
};

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function repeatedFlags(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new TypeError(`${name} requires a value`);
    }
    values.push(value);
  }
  return values;
}

function numberFlag(
  args: readonly string[],
  name: string,
  fallback?: number,
): number | undefined {
  const value = flag(args, name);
  return value === undefined ? fallback : Number(value);
}

function point(value: string | undefined): { x: number; y: number } {
  const [x, y] = value?.split(',').map(Number) ?? [];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Expected coordinates in X,Y format');
  }
  return { x: x ?? 0, y: y ?? 0 };
}

function diagnosisThresholdFlags(
  args: readonly string[],
): Partial<DiagnosisThresholds> {
  const uiFpsLow = numberFlag(args, '--ui-fps-low');
  const uiFpsCritical = numberFlag(args, '--ui-fps-critical');
  const jsBlockingMs = numberFlag(args, '--js-blocking');
  const jsBlockingHighMs = numberFlag(args, '--js-blocking-high');
  const slowRequestMs = numberFlag(args, '--slow-request');
  const verySlowRequestMs = numberFlag(args, '--very-slow-request');
  const renderCount = numberFlag(args, '--render-count');
  return {
    ...(uiFpsLow !== undefined ? { uiFpsLow } : {}),
    ...(uiFpsCritical !== undefined ? { uiFpsCritical } : {}),
    ...(jsBlockingMs !== undefined ? { jsBlockingMs } : {}),
    ...(jsBlockingHighMs !== undefined ? { jsBlockingHighMs } : {}),
    ...(slowRequestMs !== undefined ? { slowRequestMs } : {}),
    ...(verySlowRequestMs !== undefined ? { verySlowRequestMs } : {}),
    ...(renderCount !== undefined ? { renderCount } : {}),
  };
}

function print(io: CliIO, value: unknown): void {
  io.stdout(JSON.stringify(value, null, 2));
}

function emitProgress(
  io: CliIO,
  enabled: boolean,
  scope: string,
  value: unknown,
): void {
  if (!enabled) return;
  io.stderr(JSON.stringify({ type: 'progress', scope, value }));
}

function externalPluginEnvironment(
  args: readonly string[],
  allowlist: readonly string[],
  source: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const requested = repeatedFlags(args, '--env');
  for (const name of requested) {
    if (!allowlist.includes(name)) {
      throw new TypeError(
        `Environment variable ${name} is not declared in the plugin allowlist`,
      );
    }
  }
  return Object.fromEntries(requested.map((name) => [name, source[name]]));
}

function pluginGrants(args: readonly string[]): PluginPermission[] {
  const grants = repeatedFlags(args, '--grant');
  for (const grant of grants) {
    if (!PLUGIN_PERMISSIONS.includes(grant as PluginPermission)) {
      throw new TypeError(`Unsupported plugin permission grant: ${grant}`);
    }
  }
  return [...new Set(grants)] as PluginPermission[];
}

const ACTIVE_SCREEN_STATES = [
  'not-running',
  'background',
  'blank',
  'loading',
  'error',
  'empty',
  'content',
] as const;

const ACTIVE_DEEP_LINK_MUTATIONS = [
  'empty-value',
  'duplicate-parameter',
  'invalid-percent-encoding',
  'oversized-value',
  'unexpected-parameter',
] as const;

type ActiveScreenState = (typeof ACTIVE_SCREEN_STATES)[number];

function activeScreenStates(args: readonly string[]): ActiveScreenState[] {
  const states = repeatedFlags(args, '--allow-state');
  if (states.length === 0) {
    throw new TypeError(
      'Active security scenarios require at least one explicit --allow-state',
    );
  }
  for (const state of states) {
    if (!ACTIVE_SCREEN_STATES.includes(state as ActiveScreenState)) {
      throw new TypeError(`Unsupported active-security screen state: ${state}`);
    }
  }
  return [...new Set(states)] as ActiveScreenState[];
}

function activeMaximumErrors(args: readonly string[]): number {
  const value = numberFlag(args, '--max-errors', 0);
  if (
    !Number.isInteger(value) ||
    value === undefined ||
    value < 0 ||
    value > 20
  ) {
    throw new RangeError('--max-errors must be an integer from 0 to 20');
  }
  return value;
}

function activeDeepLinkProbes(args: readonly string[]): Array<{
  id: string;
  mutation: MalformedDeepLinkMutation;
  parameter: string;
}> {
  const probes = repeatedFlags(args, '--probe');
  if (probes.length === 0) {
    throw new TypeError(
      'Active deep-link scenarios require at least one --probe',
    );
  }
  return probes.map((entry) => {
    const parts = entry.split(':');
    const [id, mutation, parameter] = parts;
    if (
      parts.length !== 3 ||
      !id ||
      !mutation ||
      !parameter ||
      !ACTIVE_DEEP_LINK_MUTATIONS.includes(
        mutation as MalformedDeepLinkMutation,
      )
    ) {
      throw new TypeError(
        `--probe must use ID:MUTATION:PARAM with a supported mutation; received ${entry}`,
      );
    }
    return {
      id,
      mutation: mutation as MalformedDeepLinkMutation,
      parameter,
    };
  });
}

function activePermissionProbes(
  args: readonly string[],
): Array<{ id: string; granted: boolean }> {
  const probes = repeatedFlags(args, '--probe');
  if (probes.length === 0) {
    throw new TypeError(
      'Active permission scenarios require at least one --probe',
    );
  }
  return probes.map((entry) => {
    const [id, transition, ...extra] = entry.split(':');
    if (
      !id ||
      extra.length > 0 ||
      !['grant', 'revoke'].includes(transition ?? '')
    ) {
      throw new TypeError(
        `--probe must use ID:grant or ID:revoke; received ${entry}`,
      );
    }
    return { id, granted: transition === 'grant' };
  });
}

type SuiteReporterName = Parameters<
  typeof runObserverSuiteWorkflow
>[1]['reporters'] extends readonly (infer Reporter)[] | undefined
  ? Reporter
  : never;

const SUITE_REPORTERS: readonly SuiteReporterName[] = [
  'json',
  'html',
  'junit',
  'sarif',
  'github',
];

function suiteReporters(
  args: readonly string[],
): SuiteReporterName[] | undefined {
  const configured = flag(args, '--reporter');
  if (!configured) return undefined;
  const reporters = configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const reporter of reporters) {
    if (!SUITE_REPORTERS.includes(reporter as SuiteReporterName)) {
      throw new TypeError(`Unsupported suite reporter: ${reporter}`);
    }
  }
  if (reporters.length === 0) {
    throw new TypeError('--reporter requires at least one reporter');
  }
  return reporters as SuiteReporterName[];
}

function dashboardReport(core: ObserverCore, args: readonly string[]) {
  const requested = repeatedFlags(args, '--session');
  const limit = numberFlag(args, '--limit') ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('--limit must be an integer from 1 to 100');
  }
  const sessionIds =
    requested.length > 0
      ? requested
      : core.listSessions({ limit }).map((session) => session.id);
  return buildDashboardReport(
    sessionIds.map((sessionId) => ({ session: core.getSession(sessionId) })),
  );
}

function inventorySummary(
  inventory: Awaited<ReturnType<typeof generateSupplyChainInventory>>,
) {
  return {
    schemaVersion: inventory.schemaVersion,
    analyzer: inventory.analyzer,
    lockfilePath: inventory.lockfilePath,
    componentCount: inventory.componentCount,
    sha256: inventory.sha256,
    limitations: inventory.limitations,
  };
}

export async function runCli(
  args: readonly string[],
  io: CliIO = defaultIO,
  core = new ObserverCore(),
  options: CliRunOptions = {},
): Promise<number> {
  const [command, subcommand, positional] = args;
  try {
    if (
      command === undefined ||
      command === 'help' ||
      command === '--help' ||
      command === '-h'
    ) {
      io.stdout(HELP_TEXT.trimEnd());
      return 0;
    }
    if (command === '--version' || command === '-v') {
      io.stdout(OBSERVER_VERSION);
      return 0;
    }
    if (command === 'status') print(io, core.getStatus());
    else if (command === 'doctor') {
      print(io, await runDoctor({ projectRoot: core.projectRoot }));
    } else if (command === 'init') {
      print(
        io,
        initObserverConfig(core.projectRoot, {
          ...(args.includes('--dry-run') ? { dryRun: true } : {}),
          ...(args.includes('--force') ? { overwrite: true } : {}),
        }),
      );
    } else if (command === 'plugin' && subcommand === 'check') {
      if (!positional)
        throw new TypeError('plugin check requires MANIFEST.json');
      const loaded = loadPluginManifestFile(core.projectRoot, positional);
      print(io, {
        valid: true,
        path: loaded.path,
        sha256: loaded.sha256,
        bytes: loaded.bytes,
        plugin: {
          id: loaded.manifest.id,
          displayName: loaded.manifest.displayName,
          version: loaded.manifest.version,
          kind: loaded.manifest.kind,
          risk: loaded.manifest.risk,
          permissions: loaded.manifest.permissions,
          capabilities: loaded.manifest.capabilities,
          executionMode: loaded.manifest.execution.mode,
        },
      });
    } else if (command === 'target' && subcommand === 'support') {
      const providers = repeatedFlags(args, '--manifest').map((path) => {
        const loaded = loadPluginManifestFile(core.projectRoot, path);
        const descriptor = createExternalPluginDescriptor(loaded.manifest);
        return new ExternalTargetProviderClient({
          descriptor,
          collect: async () => {
            throw new TypeError(
              'Support inspection does not execute provider processes',
            );
          },
        });
      });
      print(io, targetProviderSupportMatrix(providers));
    } else if (command === 'target' && subcommand === 'collect') {
      const manifestPath = flag(args, '--manifest');
      const operation = flag(args, '--operation');
      const platform = flag(args, '--platform');
      if (!manifestPath || !operation || !platform) {
        throw new TypeError(
          'target collect requires --manifest, --operation, and --platform',
        );
      }
      if (
        !TARGET_PROVIDER_OPERATIONS.includes(
          operation as TargetProviderOperation,
        )
      ) {
        throw new TypeError(
          `Unsupported target provider operation: ${operation}`,
        );
      }
      if (!TARGET_PLATFORMS.includes(platform as TargetPlatform)) {
        throw new TypeError(`Unsupported target platform: ${platform}`);
      }
      const loaded = loadPluginManifestFile(core.projectRoot, manifestPath);
      const descriptor = createExternalPluginDescriptor(loaded.manifest);
      const environment = externalPluginEnvironment(
        args,
        descriptor.manifest.execution.environmentAllowlist,
        options.environment ?? process.env,
      );
      const pluginCwd = flag(args, '--cwd');
      const host = new ExternalPluginHost(descriptor, {
        projectRoot: core.projectRoot,
        ...(pluginCwd ? { cwd: pluginCwd } : {}),
        environment,
        capabilities: [
          'host.evidence-v1',
          'host.provider-v1',
          ...repeatedFlags(args, '--host-capability'),
        ],
        grantedPermissions: pluginGrants(args),
      });
      const provider = new ExternalTargetProviderClient(host);
      let failed = false;
      try {
        const deviceId = flag(args, '--device-id');
        const appId = flag(args, '--app-id');
        const maxEvidence = numberFlag(args, '--max-evidence');
        const maxPayloadBytes = numberFlag(args, '--max-payload-bytes');
        const response = await provider.collect(
          {
            operation: operation as TargetProviderOperation,
            target: {
              platform: platform as TargetPlatform,
              ...(deviceId ? { deviceId } : {}),
              ...(appId ? { appId } : {}),
            },
            ...(maxEvidence !== undefined ? { maxEvidence } : {}),
            ...(maxPayloadBytes !== undefined ? { maxPayloadBytes } : {}),
          },
          options.signal ? { signal: options.signal } : {},
        );
        print(io, {
          provider: {
            id: descriptor.manifest.id,
            version: descriptor.manifest.version,
          },
          response,
        });
        if (args.includes('--strict') && response.status !== 'AVAILABLE') {
          return 1;
        }
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        if (failed) await host.dispose().catch(() => undefined);
        else
          await host.dispose(options.signal ? { signal: options.signal } : {});
      }
    } else if (command === 'suite' && subcommand === 'list') {
      print(io, { suites: listBuiltinSuites() });
    } else if (
      (command === 'suite' && subcommand === 'run') ||
      command === 'run'
    ) {
      const suiteReference = command === 'run' ? subcommand : positional;
      if (!suiteReference) {
        throw new Error(
          'suite run requires a built-in NAME or suite file path',
        );
      }
      const reporters = suiteReporters(args);
      const outputDirectory = flag(args, '--output');
      const workflow = await runObserverSuiteWorkflow(core, {
        suiteReference,
        ...(reporters ? { reporters } : {}),
        ...(outputDirectory ? { outputDirectory } : {}),
        ...(args.includes('--confirm-persistent-permission')
          ? { confirmPersistentPermissionChange: true }
          : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.progress
          ? {
              onProgress: (progress) =>
                emitProgress(io, true, `suite:${suiteReference}`, progress),
            }
          : {}),
      });
      print(io, workflow);
      if (
        workflow.result.outcome === 'FAIL' ||
        (args.includes('--strict') &&
          workflow.result.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (command === 'ci') {
      const configuredSuites =
        flag(args, '--suite') ?? core.config.packs.join(',');
      const suiteReferences = configuredSuites
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (suiteReferences.length === 0) {
        throw new TypeError('ci requires at least one suite');
      }
      const reporters: SuiteReporterName[] = suiteReporters(args) ?? [
        'json',
        'html',
        'junit',
        'sarif',
        'github',
      ];
      const outputDirectory = flag(args, '--output');
      const workflows: ObserverSuiteWorkflowResult[] = [];
      for (const suiteReference of suiteReferences) {
        if (options.signal?.aborted) break;
        workflows.push(
          await runObserverSuiteWorkflow(core, {
            suiteReference,
            reporters,
            ...(outputDirectory
              ? {
                  outputDirectory: `${outputDirectory}/${suiteReference.replace(/[^a-zA-Z0-9._-]/gu, '-')}`,
                }
              : {}),
            ...(args.includes('--confirm-persistent-permission')
              ? { confirmPersistentPermissionChange: true }
              : {}),
            ...(options.signal ? { signal: options.signal } : {}),
            ...(options.progress
              ? {
                  onProgress: (progress) =>
                    emitProgress(io, true, `ci:${suiteReference}`, progress),
                }
              : {}),
          }),
        );
      }
      const outcomes = workflows.map((workflow) => workflow.result.outcome);
      print(io, {
        schemaVersion: '1.0',
        suites: workflows,
        summary: {
          requested: suiteReferences.length,
          completed: workflows.length,
          outcomes: Object.fromEntries(
            ['PASS', 'FAIL', 'NA', 'NOT_VERIFIED'].map((outcome) => [
              outcome,
              outcomes.filter((candidate) => candidate === outcome).length,
            ]),
          ),
          cancelled: options.signal?.aborted ?? false,
        },
      });
      if (
        options.signal?.aborted ||
        workflows.length < suiteReferences.length
      ) {
        return 130;
      }
      if (
        outcomes.includes('FAIL') ||
        (!args.includes('--allow-not-verified') &&
          outcomes.includes('NOT_VERIFIED'))
      ) {
        return 1;
      }
    } else if (command === 'security' && subcommand === 'sbom') {
      const lockfilePath = flag(args, '--lockfile');
      const inventory = await generateSupplyChainInventory({
        projectRoot: core.projectRoot,
        ...(lockfilePath ? { lockfilePath } : {}),
      });
      const artifact = core.artifacts.write(
        'security-report',
        JSON.stringify(inventory.bom, null, 2),
        {
          extension: '.cdx.json',
          mimeType: 'application/vnd.cyclonedx+json',
        },
      );
      print(io, { inventory: inventorySummary(inventory), artifact });
    } else if (command === 'security' && subcommand === 'dependencies') {
      const lockfilePath = flag(args, '--lockfile');
      const inventory = await generateSupplyChainInventory({
        projectRoot: core.projectRoot,
        ...(lockfilePath ? { lockfilePath } : {}),
      });
      const sbomArtifact = core.artifacts.write(
        'security-report',
        JSON.stringify(inventory.bom, null, 2),
        {
          extension: '.cdx.json',
          mimeType: 'application/vnd.cyclonedx+json',
        },
      );
      const audit = await auditOsvDependencies({
        inventory,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      const auditArtifact = core.artifacts.write(
        'security-report',
        JSON.stringify(audit, null, 2),
        {
          extension: '.json',
          mimeType: 'application/json',
        },
      );
      print(io, {
        inventory: inventorySummary(inventory),
        audit,
        artifacts: { sbom: sbomArtifact, audit: auditArtifact },
      });
      if (
        audit.outcome === 'FAIL' ||
        (args.includes('--strict') && audit.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (command === 'security' && subcommand === 'audit') {
      const manifestPaths = repeatedFlags(args, '--manifest');
      const networkSecurityConfigPaths = repeatedFlags(
        args,
        '--network-config',
      );
      const textPaths = repeatedFlags(args, '--text');
      const result = runPassiveSecurityAudit({
        projectRoot: core.projectRoot,
        artifactRoot: core.artifacts.root,
        ...(manifestPaths.length > 0 ? { manifestPaths } : {}),
        ...(networkSecurityConfigPaths.length > 0
          ? { networkSecurityConfigPaths }
          : {}),
        ...(textPaths.length > 0 ? { textPaths } : {}),
        ...(args.includes('--no-artifacts') ? { scanArtifacts: false } : {}),
      });
      print(io, result);
      if (
        result.outcome === 'FAIL' ||
        (args.includes('--strict') && result.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (
      command === 'security' &&
      subcommand === 'active' &&
      positional === 'deep-link'
    ) {
      const scenarioId = flag(args, '--scenario');
      const baseUri = flag(args, '--base-uri');
      if (!scenarioId || !baseUri) {
        throw new TypeError(
          'security active deep-link requires --scenario ID and --base-uri URI',
        );
      }
      const timeoutMs = numberFlag(args, '--timeout', 10_000);
      const settleMs = numberFlag(args, '--settle', 0);
      const result = await core.runMalformedDeepLinkSecurityScenario(
        {
          scenarioId,
          kind: 'malformed-deep-link',
          appId: core.appId,
          risk: 'app-state',
          ownership: 'owned',
          baseUri,
          probes: activeDeepLinkProbes(args),
          allowedScreenStates: activeScreenStates(args),
          maximumErrorLogs: activeMaximumErrors(args),
          timeoutMs: timeoutMs ?? 10_000,
          ...(settleMs !== undefined ? { settleMs } : {}),
        },
        options.signal,
      );
      print(io, result);
      if (
        result.result.outcome === 'FAIL' ||
        (args.includes('--strict') && result.result.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (
      command === 'security' &&
      subcommand === 'active' &&
      positional === 'permission'
    ) {
      const scenarioId = flag(args, '--scenario');
      const permission = flag(args, '--permission');
      if (!scenarioId || !permission) {
        throw new TypeError(
          'security active permission requires --scenario ID and --permission NAME',
        );
      }
      const timeoutMs = numberFlag(args, '--timeout', 10_000);
      const cleanupTimeoutMs = numberFlag(args, '--cleanup-timeout', 5_000);
      const settleMs = numberFlag(args, '--settle', 0);
      const allowedScreenStates = activeScreenStates(args);
      const maximumErrorLogs = activeMaximumErrors(args);
      const result = await core.runPermissionTransitionSecurityScenario(
        {
          scenarioId,
          kind: 'permission-transition',
          appId: core.appId,
          risk: 'device-state',
          ownership: 'owned',
          permission,
          probes: activePermissionProbes(args).map((probe) => ({
            ...probe,
            allowedScreenStates,
            maximumErrorLogs,
          })),
          timeoutMs: timeoutMs ?? 10_000,
          cleanupTimeoutMs: cleanupTimeoutMs ?? 5_000,
          ...(settleMs !== undefined ? { settleMs } : {}),
        },
        options.signal,
      );
      print(io, result);
      if (
        result.result.outcome === 'FAIL' ||
        (args.includes('--strict') && result.result.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (command === 'coverage' && subcommand === 'analyze') {
      if (!positional) {
        throw new TypeError('coverage analyze requires INPUT.json');
      }
      const result = core.analyzeRouteActionCoverage(
        JSON.parse(readFileSync(positional, 'utf8')) as unknown,
      );
      print(io, result);
      if (
        result.result.outcome === 'FAIL' ||
        (args.includes('--strict') && result.result.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (command === 'dashboard' && subcommand === 'build') {
      const report = dashboardReport(core, args);
      const relativePath =
        flag(args, '--output') ??
        `dashboard/dashboard-${new Date()
          .toISOString()
          .replaceAll(':', '-')}.html`;
      const artifact = await writeOfflineDashboard({
        root: core.artifacts.root,
        relativePath,
        report,
      });
      print(io, { report, artifact });
    } else if (command === 'open') {
      if (!options.signal) {
        throw new TypeError(
          'open requires a managed AbortSignal so the local server can be stopped safely',
        );
      }
      const port = numberFlag(args, '--port') ?? 0;
      const report = dashboardReport(core, args);
      const server = await startReadOnlyDashboardServer(report, {
        port,
        signal: options.signal,
      });
      print(io, {
        dashboard: {
          url: server.url,
          host: server.host,
          port: server.port,
          readOnly: true,
        },
        report,
      });
      if (!options.signal.aborted) {
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      }
      await server.close();
    } else if (command === 'performance' && subcommand === 'memory') {
      const scenarioId = flag(args, '--scenario');
      const replayPath = flag(args, '--replay');
      if (!scenarioId || !replayPath) {
        throw new TypeError(
          'performance memory requires --scenario ID and --replay SCRIPT.json',
        );
      }
      core.assertActionAuthorized('performance-memory-growth');
      const cycles = numberFlag(args, '--cycles');
      const settleMs = numberFlag(args, '--settle');
      const maxGrowthMb = numberFlag(args, '--max-growth-mb');
      const result = await runObserverMemoryGrowth(core, {
        scenarioId,
        replayPath,
        ...(cycles !== undefined ? { cycles } : {}),
        ...(settleMs !== undefined ? { settleMs } : {}),
        ...(maxGrowthMb !== undefined ? { maxGrowthMb } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.progress
          ? {
              onProgress: (progress) =>
                emitProgress(io, true, `memory:${scenarioId}`, progress),
            }
          : {}),
      });
      print(io, result);
      if (
        result.outcome === 'FAIL' ||
        (args.includes('--strict') && result.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (command === 'performance' && subcommand === 'experiment') {
      const scenarioId = flag(args, '--scenario');
      if (!scenarioId) {
        throw new TypeError('performance experiment requires --scenario ID');
      }
      const replayPath = flag(args, '--replay');
      const idle = args.includes('--idle');
      const startup = args.includes('--startup');
      if ((idle && startup) || (replayPath && (idle || startup))) {
        throw new TypeError(
          'Choose exactly one of --replay, --idle, or --startup',
        );
      }
      const mode = startup ? 'startup' : idle ? 'idle' : 'interaction';
      if (mode === 'interaction' && !replayPath) {
        throw new TypeError(
          'interaction performance experiments require --replay SCRIPT.json',
        );
      }
      if (mode === 'interaction' || mode === 'startup') {
        core.assertActionAuthorized(
          mode === 'interaction'
            ? 'performance-interaction'
            : 'performance-startup',
        );
      }
      const budgetPath = flag(args, '--budget');
      const baselinePath = flag(args, '--baseline');
      const [budgets, baseline] = await Promise.all([
        budgetPath ? loadPerformanceBudgets(budgetPath) : undefined,
        baselinePath ? loadPerformanceBaseline(baselinePath) : undefined,
      ]);
      const samples = numberFlag(args, '--samples');
      const warmupSamples = numberFlag(args, '--warmup');
      const intervalMs = numberFlag(args, '--interval');
      const result = await runObserverPerformanceExperiment(core, {
        scenarioId,
        mode,
        ...(replayPath ? { replayPath } : {}),
        ...(samples !== undefined ? { samples } : {}),
        ...(warmupSamples !== undefined ? { warmupSamples } : {}),
        ...(intervalMs !== undefined ? { intervalMs } : {}),
        ...(budgets ? { budgets } : {}),
        ...(baseline ? { baseline } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.progress
          ? {
              onProgress: (progress) =>
                emitProgress(io, true, `performance:${scenarioId}`, progress),
            }
          : {}),
      });
      const writeBaselinePath = flag(args, '--write-baseline');
      const writtenBaseline = writeBaselinePath
        ? await writePerformanceBaseline(
            writeBaselinePath,
            createPerformanceBaseline(result),
          )
        : undefined;
      print(io, {
        result,
        ...(writtenBaseline ? { baseline: writtenBaseline } : {}),
      });
      if (
        result.outcome === 'FAIL' ||
        (args.includes('--strict') && result.outcome === 'NOT_VERIFIED')
      ) {
        return 1;
      }
    } else if (command === 'devices') print(io, await core.deviceList());
    else if (command === 'device-info') print(io, await core.deviceInfo());
    else if (command === 'launch') print(io, await core.appLaunch());
    else if (command === 'reload') {
      const metro = flag(args, '--metro');
      print(
        io,
        await core.appReload({
          ...(args.includes('--fast') ? { fast: true } : {}),
          ...(metro ? { metroUrl: metro } : {}),
        }),
      );
    } else if (command === 'app-state') print(io, await core.getAppState());
    else if (command === 'device-network') {
      print(
        io,
        await core.deviceNetworkDelta(numberFlag(args, '--window', 2_000)),
      );
    } else if (command === 'metro-network') {
      const metro = flag(args, '--metro');
      const duration = numberFlag(args, '--duration') ?? 5_000;
      print(
        io,
        await core.metroNetworkSnapshot({
          ...(metro ? { metroUrl: metro } : {}),
          durationMs: duration,
        }),
      );
    } else if (command === 'devtools-profile') {
      const metro = flag(args, '--metro');
      const duration = numberFlag(args, '--duration') ?? 5_000;
      print(
        io,
        await core.devtoolsProfile({
          ...(metro ? { metroUrl: metro } : {}),
          durationMs: duration,
        }),
      );
    } else if (command === 'record' && subcommand === 'start') {
      const duration = numberFlag(args, '--duration') ?? 10_000;
      print(io, await core.startRecording(duration));
    } else if (command === 'record' && subcommand === 'stop') {
      if (!positional) throw new Error('record stop requires RECORDING_ID');
      print(io, await core.stopRecording(positional));
    } else if (command === 'devtools-export') {
      const metro = flag(args, '--metro');
      const duration = numberFlag(args, '--duration') ?? 5_000;
      print(
        io,
        await core.devtoolsExport({
          ...(metro ? { metroUrl: metro } : {}),
          durationMs: duration,
        }),
      );
    } else if (command === 'screenshot') print(io, await core.screenshot());
    else if (command === 'ui-tree') print(io, await core.getUiTree());
    else if (command === 'snapshot') {
      print(
        io,
        await core.snapshot({
          ...(args.includes('-i') || args.includes('--interactive')
            ? { interactiveOnly: true }
            : {}),
        }),
      );
    } else if (command === 'understand-screen') {
      const stuckAfterMs = numberFlag(args, '--stuck-after');
      print(
        io,
        await core.understandScreen({
          ...(stuckAfterMs !== undefined ? { stuckAfterMs } : {}),
        }),
      );
    } else if (command === 'ui-model') {
      print(io, await core.runtimeUiModel());
    } else if (command === 'tap') {
      const testId = flag(args, '--test-id');
      const ref = flag(args, '--ref');
      const settle = numberFlag(args, '--settle');
      print(
        io,
        ref
          ? await core.press(ref, settle)
          : await core.tap(
              testId
                ? { testId }
                : {
                    x: numberFlag(args, '--x') ?? Number.NaN,
                    y: numberFlag(args, '--y') ?? Number.NaN,
                  },
            ),
      );
    } else if (command === 'deep-link') {
      const uri = flag(args, '--uri');
      if (uri === undefined) throw new Error('deep-link requires --uri');
      print(io, await core.deepLink(uri));
    } else if (command === 'permissions') {
      if (subcommand === 'grant' || subcommand === 'revoke') {
        const perm = flag(args, '--perm');
        if (perm === undefined) throw new Error('--perm is required');
        if (!args.includes('--confirm-persistent-permission')) {
          throw new TypeError(
            'permissions grant/revoke requires --confirm-persistent-permission',
          );
        }
        print(
          io,
          await core.setPermission(perm, subcommand === 'grant', {
            confirmed: true,
          }),
        );
      } else {
        print(io, await core.listPermissions());
      }
    } else if (command === 'assert') {
      const testId = flag(args, '--test-id');
      const text = flag(args, '--text');
      const visible = flag(args, '--visible');
      print(
        io,
        await core.assertElement({
          ...(testId ? { testId } : {}),
          ...(text ? { text } : {}),
          ...(visible !== undefined ? { visible: visible === 'true' } : {}),
        }),
      );
    } else if (command === 'a11y-audit') {
      print(io, await core.accessibilityAudit());
    } else if (command === 'resilience' && subcommand === 'readiness') {
      print(io, await core.resilienceReadiness());
    } else if (command === 'app-data') {
      const namespace = flag(args, '--namespace');
      const events = await core.getAppData();
      print(
        io,
        namespace
          ? events.filter((event) => event.namespace === namespace)
          : events,
      );
    } else if (command === 'routes') {
      print(io, core.listRoutes());
    } else if (command === 'replay' && subcommand === 'run') {
      if (!positional) throw new Error('replay run requires SCRIPT.json');
      print(io, await core.runReplay(positional));
    } else if (command === 'replay' && subcommand === 'export') {
      if (!positional) throw new Error('replay export requires SESSION_ID');
      print(io, core.exportReplayScript(positional));
    } else if (command === 'artifacts' && subcommand === 'cleanup') {
      const days = numberFlag(args, '--days') ?? 14;
      print(
        io,
        core.cleanupArtifacts({
          olderThanDays: days,
          ...(args.includes('--dry-run') ? { dryRun: true } : {}),
        }),
      );
    } else if (command === 'swipe') {
      print(
        io,
        await core.swipe(
          point(flag(args, '--from')),
          point(flag(args, '--to')),
          numberFlag(args, '--duration', 500),
        ),
      );
    } else if (command === 'type-text') {
      const text = flag(args, '--text');
      if (text === undefined) throw new Error('--text is required');
      print(io, await core.typeText(text));
    } else if (command === 'back') print(io, await core.back());
    else if (command === 'logs') {
      const level = flag(args, '--level') as
        'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | undefined;
      const keyword = flag(args, '--keyword');
      const limit = numberFlag(args, '--limit');
      print(
        io,
        await core.getLogs({
          ...(level ? { level } : {}),
          ...(keyword ? { keyword } : {}),
          ...(limit ? { limit } : {}),
        }),
      );
    } else if (command === 'performance')
      print(io, await core.performanceSnapshot());
    else if (command === 'render-stats') {
      print(io, { renders: await core.getReactRenderStats() });
    } else if (command === 'network') {
      print(
        io,
        subcommand === 'requests'
          ? await core.getNetworkRequests()
          : await core.getNetworkSummary(),
      );
    } else if (command === 'observe') print(io, await core.observeScreen());
    else if (command === 'trace' && subcommand === 'start') {
      print(io, await core.startTrace(numberFlag(args, '--duration', 10_000)));
    } else if (command === 'trace' && subcommand === 'stop') {
      if (!positional) throw new Error('trace stop requires TRACE_ID');
      print(io, await core.stopTrace(positional));
    } else if (command === 'session' && subcommand === 'start') {
      print(io, core.startSession());
    } else if (command === 'session' && subcommand === 'stop') {
      print(io, await core.stopSession(positional));
    } else if (command === 'session' && subcommand === 'get') {
      if (!positional) throw new Error('session get requires SESSION_ID');
      print(io, core.getSession(positional));
    } else if (command === 'session' && subcommand === 'list') {
      print(io, {
        sessions: core.listSessions({
          limit: numberFlag(args, '--limit') ?? 20,
          offset: numberFlag(args, '--offset') ?? 0,
        }),
      });
    } else if (command === 'session' && subcommand === 'graph') {
      if (!positional) throw new Error('session graph requires SESSION_ID');
      print(io, core.exportEvidenceGraph(positional));
    } else if (command === 'session' && subcommand === 'share') {
      if (!positional) throw new Error('session share requires SESSION_ID');
      const outputPath = flag(args, '--output');
      const result = core.exportSessionShareBundle(positional, {
        ...(outputPath === undefined ? {} : { relativePath: outputPath }),
        ...(args.includes('--include-text')
          ? { includeTextArtifacts: true }
          : {}),
      });
      print(io, result);
      if (
        args.includes('--strict') &&
        result.bundle.outcome === 'NOT_VERIFIED'
      ) {
        return 1;
      }
    } else if (command === 'bundle' && subcommand === 'verify') {
      if (!positional) throw new Error('bundle verify requires BUNDLE.rnobs');
      const expectedSha256 = flag(args, '--sha256');
      print(
        io,
        readAndVerifySessionShareBundle(positional, {
          ...(expectedSha256 === undefined ? {} : { expectedSha256 }),
        }),
      );
    } else if (command === 'diagnose') {
      print(io, await core.diagnose(diagnosisThresholdFlags(args)));
    } else if (command === 'compare') {
      if (!subcommand || !positional) {
        throw new Error('compare requires BEFORE.png AFTER.png');
      }
      const beforeUi = flag(args, '--before-ui');
      const afterUi = flag(args, '--after-ui');
      if ((beforeUi && !afterUi) || (!beforeUi && afterUi)) {
        throw new Error('--before-ui and --after-ui must be provided together');
      }
      print(
        io,
        core.compareScreens(
          subcommand,
          positional,
          beforeUi && afterUi
            ? { before: beforeUi, after: afterUi }
            : undefined,
        ),
      );
    } else {
      throw new Error(`Unknown command: ${args.join(' ')}`);
    }
    return options.signal?.aborted ? 130 : 0;
  } catch (error) {
    if (options.signal?.aborted) {
      io.stderr(
        JSON.stringify(
          {
            code: 'CANCELLED',
            message: 'Command was cancelled',
          },
          null,
          2,
        ),
      );
      return 130;
    }
    io.stderr(JSON.stringify(asObserverError(error).toJSON(), null, 2));
    return 2;
  }
}
