# `@rn-agent-observer/mcp-server`

Model Context Protocol (MCP) stdio adapter for RN Agent Observer. It exposes the
same Android observation and evidence workflows as the CLI through structured
tools for AI agents.

## Install and check

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

See the [protocol reference](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/protocol.md)
and [security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).
