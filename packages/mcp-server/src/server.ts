#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  OBSERVER_VERSION,
  ObserverCore,
  asObserverError,
} from '@rn-agent-observer/core';
import { z } from 'zod';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

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

export function createMcpServer(core = new ObserverCore()): McpServer {
  const server = new McpServer({
    name: 'rn-agent-observer',
    version: OBSERVER_VERSION,
  });

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
    () => safe(() => core.appLaunch()),
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
        core.appReload({
          ...(mode === 'metro' ? { fast: true } : {}),
          ...(metro_url ? { metroUrl: metro_url } : {}),
        }),
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
    ({ duration_ms }) => safe(() => core.startRecording(duration_ms)),
  );
  server.registerTool(
    'stop_recording',
    {
      description: 'Stop a screen recording and pull the mp4 artifact.',
      inputSchema: z.object({ recording_id: z.string() }),
    },
    ({ recording_id }) => safe(() => core.stopRecording(recording_id)),
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
    'press',
    {
      description:
        'Act on a snapshot ref and optionally settle+diff (added/removed/changed lines).',
      inputSchema: z.object({
        ref: z.string().min(1),
        settle_ms: z.number().int().min(0).max(30_000).optional(),
      }),
    },
    ({ ref, settle_ms }) => safe(() => core.press(ref, settle_ms)),
  );
  server.registerTool(
    'replay_run',
    {
      description:
        'Run a replay script JSON (steps: tap/swipe/type-text/back/deep-link/reload/assert/wait/screenshot).',
      inputSchema: z.object({ path: z.string().min(1) }),
    },
    ({ path }) => safe(() => core.runReplay(path)),
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
    ({ uri }) => safe(() => core.deepLink(uri)),
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
      description: 'Grant or revoke a runtime permission for the app.',
      inputSchema: z.object({
        permission: z.string().min(1),
        granted: z.boolean(),
      }),
    },
    ({ permission, granted }) =>
      safe(() => core.setPermission(permission, granted)),
  );
  server.registerTool(
    'assert_element',
    {
      description:
        'Evidenced assertion: element exists (by testID or text), optionally visible.',
      inputSchema: z
        .object({
          test_id: z.string().optional(),
          text: z.string().optional(),
          visible: z.boolean().optional(),
        })
        .refine(
          (value) => value.test_id !== undefined || value.text !== undefined,
          { message: 'Provide test_id or text' },
        ),
    },
    ({ test_id, text, visible }) =>
      safe(() =>
        core.assertElement({
          ...(test_id !== undefined ? { testId: test_id } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(visible !== undefined ? { visible } : {}),
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
    () => safe(() => core.a11yAudit()),
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
        core.tap(testID ? { testId: testID } : { x: x ?? 0, y: y ?? 0 }),
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
      safe(() => core.swipe(start, end, duration_ms)),
  );
  server.registerTool(
    'type_text',
    {
      description: 'Type text into the focused Android field.',
      inputSchema: z.object({ text: z.string() }),
    },
    ({ text }) => safe(() => core.typeText(text)),
  );
  server.registerTool(
    'back',
    {
      description: 'Perform Android back navigation.',
      inputSchema: z.object({}),
    },
    () => safe(() => core.back()),
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
    ({ duration_ms }) => safe(() => core.startTrace(duration_ms)),
  );
  server.registerTool(
    'stop_trace',
    {
      description: 'Stop and pull a Perfetto trace artifact.',
      inputSchema: z.object({ trace_id: z.string() }),
    },
    ({ trace_id }) => safe(() => core.stopTrace(trace_id)),
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
        'Compare two PNG screenshots, optional UI trees, and save a diff artifact.',
      inputSchema: z
        .object({
          before: z.string(),
          after: z.string(),
          before_ui_tree: z.string().optional(),
          after_ui_tree: z.string().optional(),
        })
        .refine(
          (value) =>
            Boolean(value.before_ui_tree) === Boolean(value.after_ui_tree),
          { message: 'Provide both UI tree paths or neither' },
        ),
    },
    ({ before, after, before_ui_tree, after_ui_tree }) =>
      safe(() =>
        core.compareScreens(
          before,
          after,
          before_ui_tree && after_ui_tree
            ? { before: before_ui_tree, after: after_ui_tree }
            : undefined,
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
