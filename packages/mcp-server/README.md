# `@rn-agent-observer/mcp-server`

Model Context Protocol (MCP) stdio adapter for RN Agent Observer. It exposes the
same Android observation and evidence workflows as the CLI through structured
tools for AI agents.

## Install and check

Check registry availability first. Before the first npm publication, clone/build
the repository and point the client at `packages/mcp-server/dist/server.js` as shown
in the full installation guide.

```sh
pnpm add --save-dev @rn-agent-observer/mcp-server
pnpm exec rn-observer-mcp --check
```

Example client configuration from a project that installed the package:

```json
{
  "mcpServers": {
    "rn-agent-observer": {
      "command": "pnpm",
      "args": ["exec", "rn-observer-mcp"],
      "env": {
        "RN_OBSERVER_PROJECT_ROOT": "/absolute/path/to/app",
        "RN_OBSERVER_DEVICE_ID": "emulator-5554"
      }
    }
  }
}
```

The server uses stdio, so starting it without `--check` waits for an MCP client.
Node.js 22.12 or newer is required; device tools additionally require `adb` and a
connected Android target.

CLI and MCP share `ObserverCore`; the server does not carry an alternate set of
runtime rules. Large artifacts stay on disk and MCP returns metadata/path rather
than binary/base64. Configure the exact target in the server process environment,
not in user prompts.

See the [installation guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/installation.md),
[protocol reference](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/protocol.md),
and [security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).
