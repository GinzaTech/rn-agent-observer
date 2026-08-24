import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObserverCore } from '@rn-agent-observer/core';
import { describe, expect, it, vi } from 'vitest';
import { createMcpServer } from './server.js';

const EXPECTED_TOOL_NAMES = [
  'a11y_audit',
  'app_launch',
  'app_reload',
  'app_state',
  'assert_element',
  'back',
  'build_dashboard',
  'cleanup_artifacts',
  'compare_screens',
  'coverage_analyze',
  'dashboard_snapshot',
  'device_info',
  'device_list',
  'devtools_export',
  'devtools_profile',
  'diagnose',
  'export_session_share_bundle',
  'get_app_data',
  'get_artifact_metadata',
  'get_device_network',
  'get_evidence_graph',
  'get_logs',
  'get_metro_network',
  'get_network_requests',
  'get_network_summary',
  'get_react_render_stats',
  'get_session',
  'get_ui_tree',
  'inspect_current_screen',
  'list_permissions',
  'list_quality_suites',
  'list_routes',
  'list_sessions',
  'observe_screen',
  'observer_doctor',
  'observer_status',
  'open_deep_link',
  'performance_experiment',
  'performance_memory_growth',
  'performance_snapshot',
  'press',
  'replay_export',
  'replay_run',
  'resilience_readiness',
  'run_quality_suite',
  'runtime_ui_model',
  'screenshot',
  'security_active_deep_link',
  'security_active_permission_transition',
  'security_audit',
  'security_dependency_audit',
  'security_sbom',
  'set_permission',
  'snapshot',
  'start_recording',
  'start_session',
  'start_trace',
  'stop_recording',
  'stop_session',
  'stop_trace',
  'swipe',
  'tap',
  'type_text',
  'understand_screen',
  'verify_fix',
  'verify_session_share_bundle',
  'wait_for_element',
] as const;

describe('MCP server', () => {
  it('completes an MCP handshake and calls observer_status', async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), 'rn-observer-mcp-handshake-'),
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const core = new ObserverCore({ projectRoot });
    const server = createMcpServer(core);
    const client = new Client({ name: 'test-client', version: '0.1.0' });

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
        [...EXPECTED_TOOL_NAMES].sort(),
      );

      const resources = await client.listResources();
      expect(
        resources.resources.map((resource) => resource.uri).sort(),
      ).toEqual([
        'rnobs://capabilities',
        'rnobs://dashboard',
        'rnobs://suites',
      ]);
      const templates = await client.listResourceTemplates();
      expect(
        templates.resourceTemplates
          .map((template) => template.uriTemplate)
          .sort(),
      ).toEqual([
        'rnobs://artifacts/{artifactId}',
        'rnobs://sessions/{sessionId}',
        'rnobs://sessions/{sessionId}/graph',
      ]);
      const prompts = await client.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name).sort()).toEqual([
        'inspect-current-screen',
        'verify-fix',
      ]);
      const suites = await client.readResource({ uri: 'rnobs://suites' });
      expect(suites.contents[0]).toMatchObject({
        uri: 'rnobs://suites',
        mimeType: 'application/json',
      });

      const result = await client.callTool({
        name: 'observer_status',
        arguments: {},
      });
      expect(result.structuredContent).toMatchObject({ phase: 'android-v1' });

      const blockedMutation = await client.callTool({
        name: 'app_launch',
        arguments: {},
      });
      expect(blockedMutation.isError).toBe(true);
      expect(JSON.stringify(blockedMutation.structuredContent)).toContain(
        'authorized-active',
      );
    } finally {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('fails closed before MCP dispatches active actions to a different device', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-mcp-device-'));
    writeFileSync(
      join(projectRoot, '.rn-observer.json'),
      JSON.stringify({
        schemaVersion: 1,
        target: {
          appId: 'dev.rnagent.mcp-policy',
          deviceId: 'emulator-5554',
        },
        security: {
          mode: 'authorized-active',
          allowedActions: [
            'read',
            'app-state',
            'device-state',
            'persistent-permission',
          ],
          allowedAppIds: ['dev.rnagent.mcp-policy'],
          allowPersistentPermissionChanges: true,
          allowedPersistentPermissions: ['android.permission.CAMERA'],
        },
      }),
    );
    const core = new ObserverCore({
      projectRoot,
      deviceId: 'emulator-5556',
      onWarning: () => {},
    });
    const launch = vi.spyOn(core.adb, 'launch');
    const setPermission = vi.spyOn(core.adb, 'setPermission');
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(core);
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const launchResult = await client.callTool({
        name: 'app_launch',
        arguments: {},
      });
      const permissionResult = await client.callTool({
        name: 'set_permission',
        arguments: {
          permission: 'android.permission.CAMERA',
          granted: true,
          confirm_persistent_permission_change: true,
        },
      });

      expect(launchResult.isError).toBe(true);
      expect(permissionResult.isError).toBe(true);
      expect(JSON.stringify(launchResult.structuredContent)).toContain(
        'config.target.deviceId',
      );
      expect(JSON.stringify(permissionResult.structuredContent)).toContain(
        'config.target.deviceId',
      );
      expect(launch).not.toHaveBeenCalled();
      expect(setPermission).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('requires literal confirmation and an exact persistent permission policy', async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), 'rn-observer-mcp-persistent-permission-'),
    );
    writeFileSync(
      join(projectRoot, '.rn-observer.json'),
      JSON.stringify({
        schemaVersion: 1,
        target: {
          appId: 'dev.rnagent.mcp-persistent',
          deviceId: 'emulator-5554',
        },
        security: {
          mode: 'authorized-active',
          allowedActions: ['read', 'persistent-permission'],
          allowedAppIds: ['dev.rnagent.mcp-persistent'],
          allowPersistentPermissionChanges: true,
          allowedPersistentPermissions: ['android.permission.CAMERA'],
        },
      }),
    );
    const core = new ObserverCore({
      projectRoot,
      deviceId: 'emulator-5554',
      trustActiveConfig: true,
      onWarning: () => {},
    });
    const setPermission = vi
      .spyOn(core.adb, 'setPermission')
      .mockResolvedValue(undefined);
    const runtimePermissions = vi.spyOn(core.adb, 'runtimePermissions');
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(core);
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const missingConfirmation = await client.callTool({
        name: 'set_permission',
        arguments: {
          permission: 'android.permission.CAMERA',
          granted: true,
        },
      });
      expect(missingConfirmation.isError).toBe(true);
      expect(setPermission).not.toHaveBeenCalled();

      runtimePermissions
        .mockResolvedValueOnce([
          { name: 'android.permission.CAMERA', granted: false },
        ])
        .mockResolvedValueOnce([
          { name: 'android.permission.CAMERA', granted: true },
        ]);
      const confirmed = await client.callTool({
        name: 'set_permission',
        arguments: {
          permission: 'android.permission.CAMERA',
          granted: true,
          confirm_persistent_permission_change: true,
        },
      });
      expect(confirmed.isError).not.toBe(true);
      expect(confirmed.structuredContent).toMatchObject({
        persistent: true,
        verified: true,
      });
      expect(setPermission).toHaveBeenCalledWith(
        'dev.rnagent.mcp-persistent',
        'android.permission.CAMERA',
        true,
      );
    } finally {
      await client.close();
      await server.close();
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('analyzes safe coverage and exports/verifies a config-enabled local evidence bundle', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-mcp-share-'));
    writeFileSync(
      join(projectRoot, '.rn-observer.json'),
      JSON.stringify({
        schemaVersion: 1,
        target: {},
        artifacts: { allowShare: true },
      }),
    );
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(core);
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const coverage = await client.callTool({
        name: 'coverage_analyze',
        arguments: {
          input: {
            target: {
              platform: 'android',
              deviceId: 'emulator-5554',
              appId: 'dev.rnagent.coverage',
            },
            inventory: {
              routes: [
                {
                  id: 'home',
                  observable: true,
                  actions: [{ id: 'home.search', observable: true }],
                },
              ],
            },
            checkpoints: [
              {
                routeId: 'home',
                interactions: [{ routeId: 'home', actionId: 'home.search' }],
              },
            ],
            threshold: {
              minimumCoverageRatio: 1,
              minimumObservableItems: 2,
              minimumEvidence: 2,
            },
          },
        },
      });
      expect(coverage.structuredContent).toMatchObject({
        result: { outcome: 'PASS' },
        artifact: { kind: 'coverage-report' },
      });

      const session = core.startSession();
      const exported = await client.callTool({
        name: 'export_session_share_bundle',
        arguments: {
          session_id: session.id,
          relative_path: 'shares/mcp-test.rnobs',
        },
      });
      expect(exported.structuredContent).toMatchObject({
        bundle: { outcome: 'PASS' },
        artifact: { kind: 'share-bundle' },
      });

      const verified = await client.callTool({
        name: 'verify_session_share_bundle',
        arguments: { relative_path: 'shares/mcp-test.rnobs' },
      });
      expect(verified.structuredContent).toMatchObject({
        valid: true,
        sessionId: session.id,
      });
    } finally {
      await client.close();
      await server.close();
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('refuses MCP screen-comparison files outside the physical project root', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'rn-observer-mcp-path-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'rn-observer-mcp-path-'));
    const outsideScreenshot = join(outsideRoot, 'outside.png');
    writeFileSync(outsideScreenshot, 'not-a-png');
    const core = new ObserverCore({ projectRoot, onWarning: () => {} });
    const comparison = vi.spyOn(core, 'compareScreens');
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(core);
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: 'compare_screens',
        arguments: {
          before: outsideScreenshot,
          after: 'not-reached.png',
        },
      });

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.structuredContent)).toContain(
        'inside the project root',
      );
      expect(comparison).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('writes MCP baselines only once beneath the artifact root', async () => {
    const projectRoot = mkdtempSync(
      join(tmpdir(), 'rn-observer-mcp-baseline-'),
    );
    const core = new ObserverCore({
      projectRoot,
      appId: 'dev.rnagentobserver.test',
      onWarning: () => {},
    });
    vi.spyOn(core, 'deviceInfo').mockResolvedValue({
      id: 'emulator-5554',
      platform: 'android',
      state: 'device',
      osVersion: '16',
      model: 'Pixel',
    });
    vi.spyOn(core, 'performanceSnapshot').mockResolvedValue({
      timestamp: '2026-08-23T00:00:00.000Z',
      metrics: [
        {
          name: 'ui_fps',
          value: 60,
          unit: 'fps',
          source: 'fixture',
          timestamp: '2026-08-23T00:00:00.000Z',
          available: true,
        },
      ],
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(core);
    const client = new Client({ name: 'test-client', version: '0.1.0' });
    const outputPath = join(projectRoot, '.artifacts', 'baselines', 'mcp.json');
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const first = await client.callTool({
        name: 'performance_experiment',
        arguments: {
          scenario_id: 'mcp-baseline',
          mode: 'idle',
          samples: 3,
          warmup_samples: 0,
          interval_ms: 0,
          write_baseline_path: 'baselines/mcp.json',
        },
      });
      expect(first.isError).not.toBe(true);
      const initialContent = readFileSync(outputPath, 'utf8');

      const repeated = await client.callTool({
        name: 'performance_experiment',
        arguments: {
          scenario_id: 'mcp-baseline',
          mode: 'idle',
          samples: 3,
          warmup_samples: 0,
          interval_ms: 0,
          write_baseline_path: 'baselines/mcp.json',
        },
      });
      expect(repeated.isError).toBe(true);
      expect(JSON.stringify(repeated.structuredContent)).toContain(
        'cannot overwrite data',
      );
      expect(readFileSync(outputPath, 'utf8')).toBe(initialContent);
    } finally {
      await client.close();
      await server.close();
      core.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
