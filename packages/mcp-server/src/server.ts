#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';
import {
  OBSERVER_VERSION,
  ObserverCore,
  auditOsvDependencies,
  authorizeSecurityAction,
  asObserverError,
  buildDashboardReport,
  createPerformanceBaseline,
  generateSupplyChainInventory,
  inspectSuiteFile,
  listBuiltinSuites,
  loadPerformanceBaseline,
  loadPerformanceBudgets,
  observerSuiteCapabilities,
  runDoctor,
  runObserverMemoryGrowth,
  runObserverPerformanceExperiment,
  runObserverSuiteWorkflow,
  runPassiveSecurityAudit,
  resolveContainedReadFile,
  resolveNewArtifactOutputFile,
  writeOfflineDashboard,
  writePerformanceBaseline,
  type ActionRisk,
  type SuiteRunProgress,
} from '@rn-agent-observer/core';
import { z } from 'zod';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolRequestExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

async function sendProgress(
  extra: ToolRequestExtra,
  progress: number,
  total: number | undefined,
  message: string,
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined) return;
  await extra
    .sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress,
        ...(total !== undefined ? { total } : {}),
        message,
      },
    })
    .catch(() => undefined);
}

function suiteProgressNotifier(
  extra: ToolRequestExtra,
): (progress: SuiteRunProgress) => Promise<void> {
  let stepTotal = 0;
  return async (progress) => {
    if (progress.phase === 'steps') stepTotal = progress.total;
    const completed =
      progress.phase === 'steps'
        ? progress.completed
        : stepTotal + progress.completed;
    const total =
      progress.phase === 'steps' ? progress.total : stepTotal + progress.total;
    await sendProgress(
      extra,
      completed,
      total,
      `${progress.phase}: ${progress.stepId}`,
    );
  };
}

function success(value: object): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

async function safe(
  action: () => object | Promise<object>,
): Promise<ToolResult> {
  try {
    return success(await action());
  } catch (error) {
    const normalized = asObserverError(error).toJSON() as Record<
      string,
      unknown
    >;
    return {
      content: [{ type: 'text', text: JSON.stringify(normalized) }],
      structuredContent: normalized,
      isError: true,
    };
  }
}

function jsonResource(uri: URL | string, value: unknown) {
  return {
    contents: [
      {
        uri: String(uri),
        mimeType: 'application/json',
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function templateValue(
  values: Record<string, string | string[]>,
  name: string,
): string {
  const value = values[name];
  const resolved = Array.isArray(value) ? value[0] : value;
  if (!resolved) throw new TypeError(`Resource URI requires ${name}`);
  return resolved;
}

async function authorized<T extends object>(
  core: ObserverCore,
  risk: ActionRisk,
  action: () => T | Promise<T>,
): Promise<T> {
  let appId: string | undefined;
  try {
    appId = core.appId;
  } catch {
    appId = undefined;
  }
  const decision = authorizeSecurityAction(
    core.config,
    risk,
    appId,
    core.adb.deviceId,
  );
  if (!decision.allowed) throw new TypeError(decision.reason);
  return action();
}

function dashboardReportFor(
  core: ObserverCore,
  sessionIds?: readonly string[],
) {
  const ids =
    sessionIds ??
    core.listSessions({ limit: 100 }).map((session) => session.id);
  return buildDashboardReport(
    ids.map((sessionId) => ({ session: core.getSession(sessionId) })),
  );
}

function supplyChainSummary(
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

export function createMcpServer(core = new ObserverCore()): McpServer {
  const server = new McpServer({
    name: 'rn-agent-observer',
    version: OBSERVER_VERSION,
  });

  server.registerResource(
    'observer-capabilities',
    'rnobs://capabilities',
    {
      title: 'RN Observer capabilities',
      description:
        'Current project/device capabilities and policy-filtered readiness.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const report = await runDoctor({ projectRoot: core.projectRoot });
      return jsonResource(uri, {
        readiness: report.overall,
        capabilities: observerSuiteCapabilities(report),
        checks: report.checks,
        securityMode: core.config.security.mode,
      });
    },
  );
  server.registerResource(
    'quality-suites',
    'rnobs://suites',
    {
      title: 'RN Observer quality suites',
      description: 'Built-in executable assurance suites.',
      mimeType: 'application/json',
    },
    (uri) => jsonResource(uri, { suites: listBuiltinSuites() }),
  );
  server.registerResource(
    'observer-dashboard',
    'rnobs://dashboard',
    {
      title: 'RN Observer aggregate dashboard',
      description:
        'Redacted aggregate session counters and compatible target trends; no payloads or binary artifacts.',
      mimeType: 'application/json',
    },
    (uri) => jsonResource(uri, dashboardReportFor(core)),
  );
  server.registerResource(
    'observer-session',
    new ResourceTemplate('rnobs://sessions/{sessionId}', {
      list: () => ({
        resources: core.listSessions({ limit: 100 }).map((session) => ({
          uri: `rnobs://sessions/${encodeURIComponent(session.id)}`,
          name: `session-${session.id}`,
          title: `Observer session ${session.startedAt}`,
          description: `${session.status} · ${session.projectRoot}`,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Observer session',
      description: 'A persisted evidence timeline and artifact manifest.',
      mimeType: 'application/json',
    },
    (uri, variables) =>
      jsonResource(
        uri,
        core.getSession(
          decodeURIComponent(templateValue(variables, 'sessionId')),
        ),
      ),
  );
  server.registerResource(
    'session-evidence-graph',
    new ResourceTemplate('rnobs://sessions/{sessionId}/graph', {
      list: undefined,
    }),
    {
      title: 'Session evidence graph',
      description:
        'Redacted deterministic links between events, artifacts, routes, and findings.',
      mimeType: 'application/json',
    },
    (uri, variables) =>
      jsonResource(
        uri,
        core.getEvidenceGraph(
          decodeURIComponent(templateValue(variables, 'sessionId')),
        ),
      ),
  );
  server.registerResource(
    'artifact-metadata',
    new ResourceTemplate('rnobs://artifacts/{artifactId}', {
      list: undefined,
    }),
    {
      title: 'Artifact metadata',
      description:
        'Metadata only; binary and base64 artifact content is never returned.',
      mimeType: 'application/json',
    },
    (uri, variables) =>
      jsonResource(
        uri,
        core.getArtifact(
          decodeURIComponent(templateValue(variables, 'artifactId')),
        ),
      ),
  );

  server.registerPrompt(
    'inspect-current-screen',
    {
      title: 'Inspect current React Native screen',
      description:
        'Evidence-first recipe for understanding a screen without guessing.',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Run observer_doctor, then inspect_current_screen. Use route only when instrumentation reports it; use the returned screenshot/UI tree/runtime model evidence, preserve unknown visibility states, and report limitations.',
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    'verify-fix',
    {
      title: 'Verify a React Native fix',
      description: 'Repeat the same evidenced scenario before and after a fix.',
      argsSchema: { suite: z.string().default('smoke') },
    },
    ({ suite }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Run verify_fix with suite_reference=${suite}. Compare the same target fingerprint and exact scenario, treat NOT_VERIFIED as non-pass, and cite report/evidence graph artifact paths.`,
          },
        },
      ],
    }),
  );

  server.registerTool(
    'observer_doctor',
    {
      title: 'Observer doctor',
      description:
        'Probe project, ADB, device, Metro, instrumentation, and safety policy readiness.',
      inputSchema: z.object({ check_metro: z.boolean().default(true) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ check_metro }) =>
      safe(() =>
        runDoctor({ projectRoot: core.projectRoot, checkMetro: check_metro }),
      ),
  );
  server.registerTool(
    'list_quality_suites',
    {
      description:
        'List built-in smoke, visual, performance, network, accessibility, security, and resilience suites.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    () => safe(() => ({ suites: listBuiltinSuites() })),
  );
  server.registerTool(
    'run_quality_suite',
    {
      description:
        'Run a built-in or JSON/YAML suite with capability/risk gates and JSON/HTML/JUnit/SARIF/GitHub reports.',
      inputSchema: z.object({
        suite_reference: z.string().min(1).default('smoke'),
        reporters: z
          .array(z.enum(['json', 'html', 'junit', 'sarif', 'github']))
          .optional(),
        output_directory: z.string().min(1).optional(),
        confirm_persistent_permission_change: z.literal(true).optional(),
      }),
    },
    (
      {
        suite_reference,
        reporters,
        output_directory,
        confirm_persistent_permission_change,
      },
      extra,
    ) =>
      safe(async () => {
        await sendProgress(extra, 0, undefined, 'Loading quality suite');
        const workflow = await runObserverSuiteWorkflow(core, {
          suiteReference: suite_reference,
          ...(reporters ? { reporters } : {}),
          ...(output_directory ? { outputDirectory: output_directory } : {}),
          ...(confirm_persistent_permission_change
            ? { confirmPersistentPermissionChange: true }
            : {}),
          signal: extra.signal,
          onProgress: suiteProgressNotifier(extra),
        });
        const total =
          workflow.result.steps.length + workflow.result.cleanup.length;
        await sendProgress(extra, total, total, 'Quality suite complete');
        return workflow;
      }),
  );
  server.registerTool(
    'inspect_current_screen',
    {
      description:
        'High-level read-only workflow returning screen understanding plus compact source/runtime UI correlation.',
      inputSchema: z.object({
        stuck_after_ms: z
          .number()
          .int()
          .min(1_000)
          .max(300_000)
          .default(15_000),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ stuck_after_ms }) =>
      safe(async () => {
        const screen = await core.understandScreen({
          stuckAfterMs: stuck_after_ms,
        });
        const model = await core.runtimeUiModel();
        return {
          screen,
          runtimeUi: {
            availability: model.availability,
            route: model.route,
            counts: model.counts,
            issues: model.issues,
            interactions: model.interactions,
            artifacts: model.artifacts,
            limitations: model.limitations,
          },
        };
      }),
  );
  server.registerTool(
    'security_audit',
    {
      description:
        'Run passive MASVS-aligned Android manifest/network config and redacted artifact secret checks. The result reports its selected input scope and is NOT_VERIFIED when no manifest is available.',
      inputSchema: z.object({
        manifest_paths: z.array(z.string()).optional(),
        network_config_paths: z.array(z.string()).optional(),
        text_paths: z.array(z.string()).optional(),
        scan_artifacts: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: true },
    },
    ({ manifest_paths, network_config_paths, text_paths, scan_artifacts }) =>
      safe(() =>
        runPassiveSecurityAudit({
          projectRoot: core.projectRoot,
          artifactRoot: core.artifacts.root,
          ...(manifest_paths ? { manifestPaths: manifest_paths } : {}),
          ...(network_config_paths
            ? { networkSecurityConfigPaths: network_config_paths }
            : {}),
          ...(text_paths ? { textPaths: text_paths } : {}),
          scanArtifacts: scan_artifacts,
        }),
      ),
  );
  server.registerTool(
    'security_sbom',
    {
      description:
        'Generate a bounded CycloneDX 1.6 inventory from pnpm-lock.yaml and persist it as a local artifact.',
      inputSchema: z.object({ lockfile_path: z.string().min(1).optional() }),
    },
    ({ lockfile_path }) =>
      safe(async () => {
        const inventory = await generateSupplyChainInventory({
          projectRoot: core.projectRoot,
          ...(lockfile_path ? { lockfilePath: lockfile_path } : {}),
        });
        const artifact = core.artifacts.write(
          'security-report',
          JSON.stringify(inventory.bom, null, 2),
          {
            extension: '.cdx.json',
            mimeType: 'application/vnd.cyclonedx+json',
          },
        );
        return { inventory: supplyChainSummary(inventory), artifact };
      }),
  );
  server.registerTool(
    'security_active_deep_link',
    {
      description:
        'Run bounded malformed-query deep-link probes only against the explicitly owned and allowlisted Android app. Login, purchase, account, credential, and network-interception semantics are rejected before mutation.',
      inputSchema: z.object({
        scenario_id: z.string().min(1).max(81),
        base_uri: z.string().min(1).max(1_024),
        probes: z
          .array(
            z.object({
              id: z.string().min(1).max(81),
              mutation: z.enum([
                'empty-value',
                'duplicate-parameter',
                'invalid-percent-encoding',
                'oversized-value',
                'unexpected-parameter',
              ]),
              parameter: z.string().min(1).max(128),
            }),
          )
          .min(1)
          .max(6),
        allowed_screen_states: z
          .array(
            z.enum([
              'not-running',
              'background',
              'blank',
              'loading',
              'error',
              'empty',
              'content',
            ]),
          )
          .min(1)
          .max(7),
        maximum_error_logs: z.number().int().min(0).max(20).default(0),
        timeout_ms: z.number().int().min(25).max(30_000).default(10_000),
        settle_ms: z.number().int().min(0).max(2_000).default(0),
      }),
    },
    (input, extra) =>
      safe(async () => {
        await sendProgress(
          extra,
          0,
          input.probes.length,
          'Authorizing deep-link probes',
        );
        const result = await authorized(core, 'app-state', () =>
          core.runMalformedDeepLinkSecurityScenario(
            {
              scenarioId: input.scenario_id,
              kind: 'malformed-deep-link',
              appId: core.appId,
              risk: 'app-state',
              ownership: 'owned',
              baseUri: input.base_uri,
              probes: input.probes,
              allowedScreenStates: input.allowed_screen_states,
              maximumErrorLogs: input.maximum_error_logs,
              timeoutMs: input.timeout_ms,
              settleMs: input.settle_ms,
            },
            extra.signal,
          ),
        );
        await sendProgress(
          extra,
          input.probes.length,
          input.probes.length,
          `Deep-link probes complete: ${result.result.outcome}`,
        );
        return result;
      }),
  );
  server.registerTool(
    'security_active_permission_transition',
    {
      description:
        'Temporarily exercise bounded grant/revoke transitions for one non-account Android runtime permission on the explicitly owned and allowlisted app. Original permission state is restored by an independent cleanup path and any unverified cleanup prevents a PASS.',
      inputSchema: z.object({
        scenario_id: z.string().min(1).max(81),
        permission: z.string().min(1).max(200),
        probes: z
          .array(
            z.object({
              id: z.string().min(1).max(81),
              granted: z.boolean(),
            }),
          )
          .min(1)
          .max(4),
        allowed_screen_states: z
          .array(
            z.enum([
              'not-running',
              'background',
              'blank',
              'loading',
              'error',
              'empty',
              'content',
            ]),
          )
          .min(1)
          .max(7),
        maximum_error_logs: z.number().int().min(0).max(20).default(0),
        timeout_ms: z.number().int().min(25).max(30_000).default(10_000),
        cleanup_timeout_ms: z.number().int().min(25).max(10_000).default(5_000),
        settle_ms: z.number().int().min(0).max(2_000).default(0),
      }),
    },
    (input, extra) =>
      safe(async () => {
        await sendProgress(
          extra,
          0,
          input.probes.length,
          'Authorizing permission transition probes',
        );
        const result = await authorized(core, 'device-state', () =>
          core.runPermissionTransitionSecurityScenario(
            {
              scenarioId: input.scenario_id,
              kind: 'permission-transition',
              appId: core.appId,
              risk: 'device-state',
              ownership: 'owned',
              permission: input.permission,
              probes: input.probes.map((probe) => ({
                ...probe,
                allowedScreenStates: input.allowed_screen_states,
                maximumErrorLogs: input.maximum_error_logs,
              })),
              timeoutMs: input.timeout_ms,
              cleanupTimeoutMs: input.cleanup_timeout_ms,
              settleMs: input.settle_ms,
            },
            extra.signal,
          ),
        );
        await sendProgress(
          extra,
          input.probes.length,
          input.probes.length,
          `Permission transition probes complete: ${result.result.outcome}`,
        );
        return result;
      }),
  );
  server.registerTool(
    'security_dependency_audit',
    {
      description:
        'Explicitly query OSV for locked npm dependency versions, persist the SBOM and audit, and never treat an incomplete query as PASS.',
      inputSchema: z.object({ lockfile_path: z.string().min(1).optional() }),
    },
    ({ lockfile_path }, extra) =>
      safe(async () => {
        await sendProgress(
          extra,
          0,
          undefined,
          'Generating dependency inventory',
        );
        const inventory = await generateSupplyChainInventory({
          projectRoot: core.projectRoot,
          ...(lockfile_path ? { lockfilePath: lockfile_path } : {}),
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
          signal: extra.signal,
          onProgress: ({ completed, total }) =>
            sendProgress(
              extra,
              completed,
              total,
              'Querying OSV dependency advisories',
            ),
        });
        const auditArtifact = core.artifacts.write(
          'security-report',
          JSON.stringify(audit, null, 2),
          { extension: '.json', mimeType: 'application/json' },
        );
        return {
          inventory: supplyChainSummary(inventory),
          audit,
          artifacts: { sbom: sbomArtifact, audit: auditArtifact },
        };
      }),
  );
  server.registerTool(
    'dashboard_snapshot',
    {
      description:
        'Return a redacted aggregate dashboard model without raw event, evidence, finding, source, or artifact payloads.',
      inputSchema: z.object({
        session_ids: z.array(z.string().min(1)).max(100).optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ session_ids }) => safe(() => dashboardReportFor(core, session_ids)),
  );
  server.registerTool(
    'build_dashboard',
    {
      description:
        'Write a new CSP-locked offline aggregate dashboard inside the artifact root without overwriting an existing file.',
      inputSchema: z.object({
        session_ids: z.array(z.string().min(1)).max(100).optional(),
        relative_path: z.string().min(1).optional(),
      }),
    },
    ({ session_ids, relative_path }) =>
      safe(async () => {
        const report = dashboardReportFor(core, session_ids);
        const artifact = await writeOfflineDashboard({
          root: core.artifacts.root,
          relativePath:
            relative_path ?? `dashboard/dashboard-${Date.now()}.html`,
          report,
        });
        return { report, artifact };
      }),
  );
  server.registerTool(
    'coverage_analyze',
    {
      description:
        'Analyze declared semantic route/action coverage from a closed, evidence-only input. Raw payloads, source paths, screenshot data, and arbitrary metadata are rejected; the resulting redacted report is saved locally.',
      inputSchema: z.object({ input: z.unknown() }),
    },
    ({ input }) => safe(() => core.analyzeRouteActionCoverage(input)),
  );
  server.registerTool(
    'validate_quality_suite',
    {
      description:
        'Validate and summarize a project-contained Observer JSON/YAML suite without probing a device or executing steps.',
      inputSchema: z.object({ relative_path: z.string().min(1).max(512) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ relative_path }) =>
      safe(() => inspectSuiteFile(core.projectRoot, relative_path)),
  );
  server.registerTool(
    'import_runner_result',
    {
      description:
        'Normalize a project-contained JUnit report from Maestro, Detox, Appium, or another runner into privacy-reduced session evidence. Raw XML, test names, paths, and failure bodies are not persisted.',
      inputSchema: z.object({
        relative_path: z.string().min(1).max(512),
        runner: z
          .enum(['maestro', 'detox', 'appium', 'generic'])
          .default('generic'),
      }),
    },
    ({ relative_path, runner }) =>
      safe(() => core.importExternalRunnerResult(relative_path, runner)),
  );
  server.registerTool(
    'compare_runner_results',
    {
      description:
        'Compare two project-contained normalized runner-result JSON artifacts by stable case hash. Reports new failures, recoveries, persistent failures, count/duration deltas, and incomplete evidence without retaining test names or failure bodies.',
      inputSchema: z.object({
        baseline_path: z.string().min(1).max(512),
        current_path: z.string().min(1).max(512),
      }),
    },
    ({ baseline_path, current_path }) =>
      safe(() =>
        core.compareExternalRunnerResultFiles(baseline_path, current_path),
      ),
  );
  server.registerTool(
    'performance_startup_timing',
    {
      description:
        'Measure React Native time-to-interactive only from matching app-provided nativeLaunchStart and screenInteractive marks for a confirmed foreground cold start. Missing, warm, background, or mismatched marks remain NOT_VERIFIED.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    () => safe(() => core.startupTiming()),
  );
  server.registerTool(
    'performance_experiment',
    {
      description:
        'Repeat an exact replay or bounded idle sampling, evaluate statistical budgets, and compare a target-compatible baseline. MCP inputs must be existing regular project files; a baseline write is limited to one new relative artifact file.',
      inputSchema: z.object({
        scenario_id: z.string().min(1),
        mode: z.enum(['interaction', 'startup', 'idle']).default('interaction'),
        replay_path: z.string().min(1).optional(),
        samples: z.number().int().min(3).max(50).default(5),
        warmup_samples: z.number().int().min(0).max(10).default(1),
        interval_ms: z.number().int().min(0).max(60_000).default(250),
        budget_path: z.string().min(1).optional(),
        baseline_path: z.string().min(1).optional(),
        write_baseline_path: z.string().min(1).optional(),
      }),
    },
    (input, extra) =>
      safe(async () => {
        const replayPath = input.replay_path
          ? resolveContainedReadFile(
              core.projectRoot,
              input.replay_path,
              'replay_path',
            )
          : undefined;
        const budgetPath = input.budget_path
          ? resolveContainedReadFile(
              core.projectRoot,
              input.budget_path,
              'budget_path',
            )
          : undefined;
        const baselinePath = input.baseline_path
          ? resolveContainedReadFile(
              core.projectRoot,
              input.baseline_path,
              'baseline_path',
            )
          : undefined;
        const outputPath = input.write_baseline_path
          ? resolveNewArtifactOutputFile(
              core.projectRoot,
              core.artifacts.root,
              input.write_baseline_path,
              'write_baseline_path',
            )
          : undefined;
        if (input.mode === 'interaction' || input.mode === 'startup') {
          await authorized(core, 'app-state', async () => ({}));
          if (input.mode === 'interaction' && !replayPath) {
            throw new TypeError('interaction mode requires replay_path');
          }
        }
        const [budgets, baseline] = await Promise.all([
          budgetPath ? loadPerformanceBudgets(budgetPath) : undefined,
          baselinePath ? loadPerformanceBaseline(baselinePath) : undefined,
        ]);
        const result = await runObserverPerformanceExperiment(core, {
          scenarioId: input.scenario_id,
          mode: input.mode,
          ...(replayPath ? { replayPath } : {}),
          samples: input.samples,
          warmupSamples: input.warmup_samples,
          intervalMs: input.interval_ms,
          ...(budgets ? { budgets } : {}),
          ...(baseline ? { baseline } : {}),
          signal: extra.signal,
          onProgress: (progress) =>
            sendProgress(
              extra,
              progress.completed,
              progress.total,
              `${progress.phase} sample ${progress.sampleIndex + 1}`,
            ),
        });
        const writtenBaseline = outputPath
          ? await writePerformanceBaseline(
              outputPath,
              createPerformanceBaseline(result),
              { noOverwrite: true, createParentDirectory: false },
            )
          : undefined;
        return {
          result,
          ...(writtenBaseline ? { baseline: writtenBaseline } : {}),
        };
      }),
  );
  server.registerTool(
    'performance_memory_growth',
    {
      description:
        'Replay one exact interaction cycle before each Android process-PSS sample, evaluate an explicit growth budget, and preserve that PSS is not JavaScript heap or proof of a leak.',
      inputSchema: z.object({
        scenario_id: z.string().min(1),
        replay_path: z.string().min(1),
        cycles: z.number().int().min(5).max(50).default(10),
        settle_ms: z.number().int().min(0).max(60_000).default(500),
        max_growth_mb: z.number().min(0).optional(),
      }),
    },
    (input, extra) =>
      safe(async () => {
        await authorized(core, 'app-state', async () => ({}));
        const result = await runObserverMemoryGrowth(core, {
          scenarioId: input.scenario_id,
          replayPath: input.replay_path,
          cycles: input.cycles,
          settleMs: input.settle_ms,
          ...(input.max_growth_mb !== undefined
            ? { maxGrowthMb: input.max_growth_mb }
            : {}),
          signal: extra.signal,
          onProgress: ({ completed, total }) =>
            sendProgress(
              extra,
              completed,
              total,
              'Replaying and sampling Android process memory',
            ),
        });
        const artifact = core.artifacts.write(
          'suite-report',
          JSON.stringify(result, null, 2),
          { extension: '.json', mimeType: 'application/json' },
        );
        return { result, artifact };
      }),
  );
  server.registerTool(
    'list_sessions',
    {
      description:
        'List persisted observer sessions without loading timelines.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ limit, offset }) =>
      safe(() => ({ sessions: core.listSessions({ limit, offset }) })),
  );
  server.registerTool(
    'get_evidence_graph',
    {
      description:
        'Build the redacted evidence graph for a persisted session without copying sensitive event payloads.',
      inputSchema: z.object({ session_id: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ session_id }) => safe(() => core.getEvidenceGraph(session_id)),
  );
  server.registerTool(
    'get_artifact_metadata',
    {
      description:
        'Return artifact metadata only; never return binary or base64 payloads.',
      inputSchema: z.object({ artifact_id: z.string().min(1) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ artifact_id }) => safe(() => core.getArtifact(artifact_id)),
  );
  server.registerTool(
    'export_session_share_bundle',
    {
      description:
        'Create a new, non-overwriting .rnobs evidence bundle inside the local artifact root. Sharing must be explicitly enabled in project config; binary content is never embedded and requested text is bounded and secret-scanned.',
      inputSchema: z.object({
        session_id: z.string().min(1),
        relative_path: z.string().min(1).max(512).optional(),
        include_text_artifacts: z.boolean().default(false),
      }),
    },
    ({ session_id, relative_path, include_text_artifacts }) =>
      safe(() =>
        core.exportSessionShareBundle(session_id, {
          ...(relative_path === undefined
            ? {}
            : { relativePath: relative_path }),
          includeTextArtifacts: include_text_artifacts,
        }),
      ),
  );
  server.registerTool(
    'verify_session_share_bundle',
    {
      description:
        'Read and cryptographically verify an existing .rnobs bundle inside the local artifact root without extracting it or returning embedded contents.',
      inputSchema: z.object({
        relative_path: z.string().min(1).max(512),
        expected_sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/u)
          .optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    ({ relative_path, expected_sha256 }) =>
      safe(() => core.verifySessionShareBundle(relative_path, expected_sha256)),
  );
  server.registerTool(
    'verify_fix',
    {
      description:
        'Run the same suite after a change and optionally compare before/after PNG plus UI trees.',
      inputSchema: z.object({
        suite_reference: z.string().min(1).default('smoke'),
        before_png: z.string().optional(),
        after_png: z.string().optional(),
        before_ui_tree: z.string().optional(),
        after_ui_tree: z.string().optional(),
        confirm_persistent_permission_change: z.literal(true).optional(),
      }),
    },
    (input, extra) =>
      safe(async () => {
        if (Boolean(input.before_png) !== Boolean(input.after_png)) {
          throw new TypeError(
            'Provide both before_png and after_png or neither',
          );
        }
        if (Boolean(input.before_ui_tree) !== Boolean(input.after_ui_tree)) {
          throw new TypeError(
            'Provide both before_ui_tree and after_ui_tree or neither',
          );
        }
        const beforePng = input.before_png
          ? resolveContainedReadFile(
              core.projectRoot,
              input.before_png,
              'before_png',
            )
          : undefined;
        const afterPng = input.after_png
          ? resolveContainedReadFile(
              core.projectRoot,
              input.after_png,
              'after_png',
            )
          : undefined;
        const beforeUiTree = input.before_ui_tree
          ? resolveContainedReadFile(
              core.projectRoot,
              input.before_ui_tree,
              'before_ui_tree',
            )
          : undefined;
        const afterUiTree = input.after_ui_tree
          ? resolveContainedReadFile(
              core.projectRoot,
              input.after_ui_tree,
              'after_ui_tree',
            )
          : undefined;
        const workflow = await runObserverSuiteWorkflow(core, {
          suiteReference: input.suite_reference,
          ...(input.confirm_persistent_permission_change
            ? { confirmPersistentPermissionChange: true }
            : {}),
          signal: extra.signal,
          onProgress: suiteProgressNotifier(extra),
        });
        const comparison =
          beforePng && afterPng
            ? core.compareScreens(
                beforePng,
                afterPng,
                beforeUiTree && afterUiTree
                  ? {
                      before: beforeUiTree,
                      after: afterUiTree,
                    }
                  : undefined,
              )
            : undefined;
        return { workflow, ...(comparison ? { comparison } : {}) };
      }),
  );

  server.registerTool(
    'observer_status',
    {
      title: 'Observer status',
      description: 'Return implementation status and target project root.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.getStatus()),
  );
  server.registerTool(
    'device_list',
    {
      description: 'List Android devices and emulators.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.deviceList()),
  );
  server.registerTool(
    'device_info',
    {
      description: 'Inspect the selected Android device.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.deviceInfo()),
  );
  server.registerTool(
    'app_launch',
    {
      description: 'Launch the configured Android app.',
      inputSchema: z.object({}),
    },
    () => safe(() => authorized(core, 'app-state', () => core.appLaunch())),
  );
  server.registerTool(
    'app_reload',
    {
      description:
        'Reload the app. Mode "metro" does a fast JS reload via CDP (keeps native state); default "app" force-stops and relaunches.',
      inputSchema: z.object({
        mode: z.enum(['app', 'metro']).optional(),
        metro_url: z.string().optional(),
      }),
    },
    ({ mode, metro_url }) =>
      safe(() =>
        authorized(core, 'app-state', () =>
          core.appReload({
            ...(mode === 'metro' ? { fast: true } : {}),
            ...(metro_url ? { metroUrl: metro_url } : {}),
          }),
        ),
      ),
  );
  server.registerTool(
    'get_metro_network',
    {
      description:
        'Collect per-request network evidence via the Metro CDP Network domain — works without app instrumentation.',
      inputSchema: z.object({
        duration_ms: z.number().int().min(1_000).max(30_000).default(5_000),
        metro_url: z.string().optional(),
      }),
    },
    ({ duration_ms, metro_url }) =>
      safe(() =>
        core.metroNetworkSnapshot({
          durationMs: duration_ms,
          ...(metro_url ? { metroUrl: metro_url } : {}),
        }),
      ),
  );
  server.registerTool(
    'devtools_profile',
    {
      description:
        'Record a JS CPU profile via the CDP Profiler domain and save a .cpuprofile artifact.',
      inputSchema: z.object({
        duration_ms: z.number().int().min(1_000).max(60_000).default(5_000),
        metro_url: z.string().optional(),
      }),
    },
    ({ duration_ms, metro_url }) =>
      safe(() =>
        core.devtoolsProfile({
          durationMs: duration_ms,
          ...(metro_url ? { metroUrl: metro_url } : {}),
        }),
      ),
  );
  server.registerTool(
    'start_recording',
    {
      description:
        'Start an Android screen recording (max 180s per clip) as an mp4 artifact.',
      inputSchema: z.object({
        duration_ms: z.number().int().min(1_000).max(180_000).default(10_000),
      }),
    },
    ({ duration_ms }) =>
      safe(() =>
        authorized(core, 'device-state', () =>
          core.startRecording(duration_ms),
        ),
      ),
  );
  server.registerTool(
    'stop_recording',
    {
      description: 'Stop a screen recording and pull the mp4 artifact.',
      inputSchema: z.object({ recording_id: z.string() }),
    },
    ({ recording_id }) =>
      safe(() =>
        authorized(core, 'device-state', () =>
          core.stopRecording(recording_id),
        ),
      ),
  );
  server.registerTool(
    'app_state',
    {
      description:
        'Report process state and foreground activity for apps without instrumentation.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.getAppState()),
  );
  server.registerTool(
    'get_device_network',
    {
      description:
        'Sample device-level network counters and report the delta over a window (not app-attributed).',
      inputSchema: z.object({
        window_ms: z.number().int().min(500).max(30_000).default(2_000),
      }),
    },
    ({ window_ms }) => safe(() => core.deviceNetworkDelta(window_ms)),
  );
  server.registerTool(
    'devtools_export',
    {
      description:
        'Attach to the React Native runtime via Metro CDP and export console entries, exceptions, and heap usage.',
      inputSchema: z.object({
        duration_ms: z.number().int().min(1_000).max(60_000).default(5_000),
        metro_url: z.string().optional(),
      }),
    },
    ({ duration_ms, metro_url }) =>
      safe(() =>
        core.devtoolsExport({
          durationMs: duration_ms,
          ...(metro_url ? { metroUrl: metro_url } : {}),
        }),
      ),
  );
  server.registerTool(
    'snapshot',
    {
      description:
        'Build a token-efficient ref snapshot (e1..eN) of visible elements for agent interaction.',
      inputSchema: z.object({
        interactive_only: z.boolean().default(false),
      }),
    },
    ({ interactive_only }) =>
      safe(() =>
        core.snapshot(interactive_only ? { interactiveOnly: true } : {}),
      ),
  );
  server.registerTool(
    'understand_screen',
    {
      description:
        'Explain the current Android screen for an agent: instrumented route when available, semantic state/headline/text/actions, visible UI and recent runtime error findings, screenshot/UI-tree evidence, and stable loading detection across calls. Text-field values are redacted.',
      inputSchema: z.object({
        stuck_after_ms: z
          .number()
          .int()
          .min(1_000)
          .max(300_000)
          .default(15_000),
      }),
    },
    ({ stuck_after_ms }) =>
      safe(() => core.understandScreen({ stuckAfterMs: stuck_after_ms })),
  );
  server.registerTool(
    'runtime_ui_model',
    {
      description:
        'Correlate actionable React Native JSX source locations, instrumentation mount/press events, and the current Android native tree. Returns target-not-running or target-not-foreground instead of attributing another app UI to the target.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.runtimeUiModel()),
  );
  server.registerTool(
    'press',
    {
      description:
        'Act on a snapshot ref and optionally settle+diff (added/removed/changed lines).',
      inputSchema: z.object({
        ref: z.string().min(1),
        settle_ms: z.number().int().min(0).max(30_000).optional(),
      }),
    },
    ({ ref, settle_ms }) =>
      safe(() =>
        authorized(core, 'app-state', () => core.press(ref, settle_ms)),
      ),
  );
  server.registerTool(
    'wait_for_element',
    {
      description:
        'Poll an element assertion until it passes or the timeout elapses (default 10s, max 60s). passed=false means not observed in time.',
      inputSchema: z
        .object({
          test_id: z.string().optional(),
          text: z.string().optional(),
          visible: z.boolean().optional(),
          text_equals: z.string().optional(),
          timeout_ms: z.number().int().min(500).max(60_000).optional(),
          interval_ms: z.number().int().min(250).max(5_000).optional(),
        })
        .refine(
          (value) => value.test_id !== undefined || value.text !== undefined,
          { message: 'Provide test_id or text' },
        ),
    },
    ({ test_id, text, visible, text_equals, timeout_ms, interval_ms }) =>
      safe(() =>
        core.waitForElement(
          {
            ...(test_id !== undefined ? { testId: test_id } : {}),
            ...(text !== undefined ? { text } : {}),
            ...(visible !== undefined ? { visible } : {}),
            ...(text_equals !== undefined ? { textEquals: text_equals } : {}),
          },
          {
            ...(timeout_ms !== undefined ? { timeoutMs: timeout_ms } : {}),
            ...(interval_ms !== undefined ? { intervalMs: interval_ms } : {}),
          },
        ),
      ),
  );
  server.registerTool(
    'replay_run',
    {
      description:
        'Run a replay script JSON (steps: tap/swipe/type-text/back/deep-link/reload/assert/wait/screenshot).',
      inputSchema: z.object({ path: z.string().min(1) }),
    },
    ({ path }) =>
      safe(() => authorized(core, 'app-state', () => core.runReplay(path))),
  );
  server.registerTool(
    'replay_export',
    {
      description:
        'Turn a recorded session timeline into a replayable script JSON artifact.',
      inputSchema: z.object({ session_id: z.string().min(1) }),
    },
    ({ session_id }) => safe(() => core.exportReplayScript(session_id)),
  );
  server.registerTool(
    'cleanup_artifacts',
    {
      description:
        'Delete observer sessions and artifacts older than N days (default 14). Use dry_run first.',
      inputSchema: z.object({
        older_than_days: z.number().int().min(0).max(365).default(14),
        dry_run: z.boolean().default(false),
      }),
    },
    ({ older_than_days, dry_run }) =>
      safe(() =>
        core.cleanupArtifacts({
          olderThanDays: older_than_days,
          dryRun: dry_run,
        }),
      ),
  );
  server.registerTool(
    'open_deep_link',
    {
      description: 'Open an Android deep link in the configured app.',
      inputSchema: z.object({ uri: z.string().min(1) }),
    },
    ({ uri }) =>
      safe(() => authorized(core, 'app-state', () => core.deepLink(uri))),
  );
  server.registerTool(
    'list_permissions',
    {
      description: 'List runtime permissions and their grant state.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.listPermissions()),
  );
  server.registerTool(
    'set_permission',
    {
      description:
        'Intentionally persist a grant or revoke for one exact allowlisted Android runtime permission. This does not restore the original state or relaunch the app.',
      inputSchema: z.object({
        permission: z.string().min(1),
        granted: z.boolean(),
        confirm_persistent_permission_change: z.literal(true),
      }),
    },
    ({ permission, granted, confirm_persistent_permission_change }) =>
      safe(() =>
        authorized(core, 'persistent-permission', () =>
          core.setPermission(permission, granted, {
            confirmed: confirm_persistent_permission_change,
          }),
        ),
      ),
  );
  server.registerTool(
    'assert_element',
    {
      description:
        'Evidenced assertion: element exists (by testID or text), optionally visible with exact text.',
      inputSchema: z
        .object({
          test_id: z.string().optional(),
          text: z.string().optional(),
          visible: z.boolean().optional(),
          text_equals: z.string().optional(),
        })
        .refine(
          (value) => value.test_id !== undefined || value.text !== undefined,
          { message: 'Provide test_id or text' },
        ),
    },
    ({ test_id, text, visible, text_equals }) =>
      safe(() =>
        core.assertElement({
          ...(test_id !== undefined ? { testId: test_id } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(visible !== undefined ? { visible } : {}),
          ...(text_equals !== undefined ? { textEquals: text_equals } : {}),
        }),
      ),
  );
  server.registerTool(
    'a11y_audit',
    {
      description:
        'Audit interactive elements that lack labels/testIDs for accessibility.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.accessibilityAudit()),
  );
  server.registerTool(
    'resilience_readiness',
    {
      description:
        'Evaluate a passive current-state recovery checkpoint for process, foreground, stuck loading, and observed runtime errors.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    () => safe(() => core.resilienceReadiness()),
  );
  server.registerTool(
    'get_app_data',
    {
      description:
        'Read the latest app-owned state snapshots (namespace-keyed) reported by instrumentation.',
      inputSchema: z.object({}),
    },
    () => safe(async () => ({ snapshots: await core.getAppData() })),
  );
  server.registerTool(
    'list_routes',
    {
      description:
        'Derive the expo-router sitemap from the app/ directory of the target project.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.listRoutes()),
  );
  server.registerTool(
    'screenshot',
    {
      description: 'Capture a PNG screenshot artifact.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.screenshot()),
  );
  server.registerTool(
    'get_ui_tree',
    {
      description: 'Return the normalized Android UIAutomator hierarchy.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.getUiTree()),
  );
  server.registerTool(
    'tap',
    {
      description: 'Tap coordinates or a semantic id/label.',
      inputSchema: z
        .object({
          x: z.number().optional(),
          y: z.number().optional(),
          testID: z.string().optional(),
        })
        .refine(
          (value) =>
            value.testID || (value.x !== undefined && value.y !== undefined),
          {
            message: 'Provide testID or x and y',
          },
        ),
    },
    ({ x, y, testID }) =>
      safe(() =>
        authorized(core, 'app-state', () =>
          core.tap(testID ? { testId: testID } : { x: x ?? 0, y: y ?? 0 }),
        ),
      ),
  );
  server.registerTool(
    'swipe',
    {
      description: 'Perform an Android swipe gesture.',
      inputSchema: z.object({
        start: z.object({ x: z.number(), y: z.number() }),
        end: z.object({ x: z.number(), y: z.number() }),
        duration_ms: z.number().int().positive().default(500),
      }),
    },
    ({ start, end, duration_ms }) =>
      safe(() =>
        authorized(core, 'app-state', () =>
          core.swipe(start, end, duration_ms),
        ),
      ),
  );
  server.registerTool(
    'type_text',
    {
      description: 'Type text into the focused Android field.',
      inputSchema: z.object({ text: z.string() }),
    },
    ({ text }) =>
      safe(() => authorized(core, 'app-state', () => core.typeText(text))),
  );
  server.registerTool(
    'back',
    {
      description: 'Perform Android back navigation.',
      inputSchema: z.object({}),
    },
    () => safe(() => authorized(core, 'app-state', () => core.back())),
  );
  server.registerTool(
    'get_logs',
    {
      description: 'Return focused structured application logs.',
      inputSchema: z.object({
        level: z
          .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
          .optional(),
        keyword: z.string().optional(),
        source: z.string().optional(),
        since: z.string().optional(),
        limit: z.number().int().positive().max(5000).default(500),
      }),
    },
    ({ level, keyword, source, since, limit }) =>
      safe(async () => ({
        logs: await core.getLogs({
          ...(level ? { level } : {}),
          ...(keyword ? { keyword } : {}),
          ...(source ? { source } : {}),
          ...(since ? { since } : {}),
          limit,
        }),
      })),
  );
  server.registerTool(
    'performance_snapshot',
    {
      description:
        'Collect Android frame and memory metrics with explicit unavailable signals.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.performanceSnapshot()),
  );
  server.registerTool(
    'start_trace',
    {
      description: 'Start an Android Perfetto trace.',
      inputSchema: z.object({
        duration_ms: z.number().int().min(100).max(300_000).default(10_000),
      }),
    },
    ({ duration_ms }) =>
      safe(() =>
        authorized(core, 'device-state', () => core.startTrace(duration_ms)),
      ),
  );
  server.registerTool(
    'stop_trace',
    {
      description: 'Stop and pull a Perfetto trace artifact.',
      inputSchema: z.object({ trace_id: z.string() }),
    },
    ({ trace_id }) =>
      safe(() =>
        authorized(core, 'device-state', () => core.stopTrace(trace_id)),
      ),
  );
  server.registerTool(
    'get_react_render_stats',
    {
      description:
        'Parse development React Profiler events emitted by instrumentation.',
      inputSchema: z.object({}),
    },
    () => safe(async () => ({ renders: await core.getReactRenderStats() })),
  );
  server.registerTool(
    'get_network_requests',
    {
      description: 'Return redacted development network events.',
      inputSchema: z.object({}),
    },
    () => safe(async () => ({ requests: await core.getNetworkRequests() })),
  );
  server.registerTool(
    'get_network_summary',
    {
      description:
        'Aggregate latency, failures, percentiles, bytes, and slow endpoints.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.getNetworkSummary()),
  );
  server.registerTool(
    'observe_screen',
    {
      description: 'Collect a compact unified screen observation.',
      inputSchema: z.object({
        include: z
          .array(
            z.enum([
              'screenshot',
              'ui_tree',
              'route',
              'performance',
              'network',
              'logs',
              'app_state',
            ]),
          )
          .default([
            'screenshot',
            'ui_tree',
            'route',
            'performance',
            'network',
            'logs',
            'app_state',
          ]),
      }),
    },
    ({ include }) => safe(() => core.observeScreen(include)),
  );
  server.registerTool(
    'start_session',
    {
      description: 'Start a persisted observation session.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.startSession()),
  );
  server.registerTool(
    'stop_session',
    {
      description: 'Stop a persisted observation session.',
      inputSchema: z.object({ session_id: z.string().optional() }),
    },
    ({ session_id }) => safe(() => core.stopSession(session_id)),
  );
  server.registerTool(
    'get_session',
    {
      description: 'Read a session timeline and artifacts.',
      inputSchema: z.object({ session_id: z.string() }),
    },
    ({ session_id }) => safe(() => core.getSession(session_id)),
  );
  server.registerTool(
    'diagnose',
    {
      description:
        'Run evidence-based diagnosis rules. Confidence is a documented heuristic, not a statistical probability; thresholds are configurable.',
      inputSchema: z.object({
        ui_fps_low: z.number().positive().optional(),
        ui_fps_critical: z.number().positive().optional(),
        js_blocking_ms: z.number().positive().optional(),
        js_blocking_high_ms: z.number().positive().optional(),
        slow_request_ms: z.number().positive().optional(),
        very_slow_request_ms: z.number().positive().optional(),
        render_count: z.number().int().positive().optional(),
      }),
    },
    (thresholds) =>
      safe(() =>
        core.diagnose({
          ...(thresholds.ui_fps_low !== undefined
            ? { uiFpsLow: thresholds.ui_fps_low }
            : {}),
          ...(thresholds.ui_fps_critical !== undefined
            ? { uiFpsCritical: thresholds.ui_fps_critical }
            : {}),
          ...(thresholds.js_blocking_ms !== undefined
            ? { jsBlockingMs: thresholds.js_blocking_ms }
            : {}),
          ...(thresholds.js_blocking_high_ms !== undefined
            ? { jsBlockingHighMs: thresholds.js_blocking_high_ms }
            : {}),
          ...(thresholds.slow_request_ms !== undefined
            ? { slowRequestMs: thresholds.slow_request_ms }
            : {}),
          ...(thresholds.very_slow_request_ms !== undefined
            ? { verySlowRequestMs: thresholds.very_slow_request_ms }
            : {}),
          ...(thresholds.render_count !== undefined
            ? { renderCount: thresholds.render_count }
            : {}),
        }),
      ),
  );
  server.registerTool(
    'compare_screens',
    {
      description:
        'Compare two project-contained PNG screenshots, optional project-contained UI trees, and save a diff artifact.',
      inputSchema: z
        .object({
          before: z.string(),
          after: z.string(),
          before_ui_tree: z.string().optional(),
          after_ui_tree: z.string().optional(),
          perceptual_threshold: z.number().min(0).max(1).optional(),
          ignore_regions: z
            .array(
              z.object({
                x: z.number().int(),
                y: z.number().int(),
                width: z.number().int().positive(),
                height: z.number().int().positive(),
              }),
            )
            .max(20)
            .optional(),
        })
        .refine(
          (value) =>
            Boolean(value.before_ui_tree) === Boolean(value.after_ui_tree),
          { message: 'Provide both UI tree paths or neither' },
        ),
    },
    ({
      before,
      after,
      before_ui_tree,
      after_ui_tree,
      perceptual_threshold,
      ignore_regions,
    }) =>
      safe(() =>
        core.compareScreens(
          resolveContainedReadFile(core.projectRoot, before, 'before'),
          resolveContainedReadFile(core.projectRoot, after, 'after'),
          before_ui_tree && after_ui_tree
            ? {
                before: resolveContainedReadFile(
                  core.projectRoot,
                  before_ui_tree,
                  'before_ui_tree',
                ),
                after: resolveContainedReadFile(
                  core.projectRoot,
                  after_ui_tree,
                  'after_ui_tree',
                ),
              }
            : undefined,
          {
            ...(perceptual_threshold === undefined
              ? {}
              : { perceptualThreshold: perceptual_threshold }),
            ...(ignore_regions === undefined
              ? {}
              : { ignoreRegions: ignore_regions }),
          },
        ),
      ),
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  if (process.argv.includes('--check')) {
    createMcpServer();
    process.stderr.write(
      'rn-agent-observer MCP server initialized successfully\n',
    );
  } else {
    startMcpServer().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Failed to start MCP server: ${message}\n`);
      process.exitCode = 1;
    });
  }
}
