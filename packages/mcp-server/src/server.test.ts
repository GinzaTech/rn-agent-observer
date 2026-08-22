import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ObserverCore } from '@rn-agent-observer/core';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from './server.js';

describe('MCP server', () => {
  it('completes an MCP handshake and calls observer_status', async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const server = createMcpServer(new ObserverCore({ projectRoot: '.' }));
    const client = new Client({ name: 'test-client', version: '0.1.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('observer_status');
    expect(tools.tools.map((tool) => tool.name)).toContain('observe_screen');
    expect(tools.tools.map((tool) => tool.name)).toContain('app_state');
    expect(tools.tools.map((tool) => tool.name)).toContain(
      'get_device_network',
    );
    expect(tools.tools.map((tool) => tool.name)).toContain('devtools_export');
    expect(tools.tools.map((tool) => tool.name)).toContain('get_metro_network');
    expect(tools.tools.map((tool) => tool.name)).toContain('devtools_profile');
    expect(tools.tools.map((tool) => tool.name)).toContain('start_recording');
    expect(tools.tools.map((tool) => tool.name)).toContain('stop_recording');
    expect(tools.tools.map((tool) => tool.name)).toContain('snapshot');
    expect(tools.tools.map((tool) => tool.name)).toContain('understand_screen');
    expect(tools.tools.map((tool) => tool.name)).toContain('press');
    expect(tools.tools.map((tool) => tool.name)).toContain('replay_run');
    expect(tools.tools.map((tool) => tool.name)).toContain('assert_element');
    expect(tools.tools.map((tool) => tool.name)).toContain('a11y_audit');
    expect(tools.tools.map((tool) => tool.name)).toContain('get_app_data');
    expect(tools.tools.map((tool) => tool.name)).toContain('list_routes');
    expect(tools.tools.map((tool) => tool.name)).toContain('replay_export');
    expect(tools.tools.map((tool) => tool.name)).toContain('cleanup_artifacts');
    expect(tools.tools).toHaveLength(44);

    const result = await client.callTool({
      name: 'observer_status',
      arguments: {},
    });
    expect(result.structuredContent).toMatchObject({ phase: 'android-v1' });

    await client.close();
    await server.close();
  });
});
