# `@rn-agent-observer/core`

Shared runtime engine behind the RN Agent Observer CLI and MCP server. It owns
Android/ADB collection, evidence sessions, diagnosis, replay, UI understanding,
and visual/structural comparison.

## Install

Before the first npm publication, consume Core from a source workspace or a
reviewed local tarball. Check registry availability before using the command below.

```sh
pnpm add @rn-agent-observer/core
```

```ts
import { ObserverCore } from '@rn-agent-observer/core';

const observer = new ObserverCore({ projectRoot: '/path/to/app' });
const status = observer.getStatus();
```

`ObserverCore` also accepts explicit `deviceId`, `appId`, `sessionId`,
`adbExecutable`, and artifact-root options. Prefer project config/environment for
CLI-like integrations, but never let repository config self-authorize active
operations: process-side trust and exact policy binding are separate requirements.

This is an ESM package for Node.js 22.12 or newer. Device-facing APIs require
Android Platform Tools and a selected Android device. Findings are evidence-backed
hypotheses; unavailable measurements remain explicitly unavailable.

See the [architecture](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/architecture.md),
[repository structure](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/project-structure.md),
[metrics contract](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/metrics.md), and
[security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).
