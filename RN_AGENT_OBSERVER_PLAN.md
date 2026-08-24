# RN Agent Observer — Development Plan & Codex Instructions

> Historical planning document. The implementation has moved beyond several
> inventories and counts below. Use [README](README.md),
> [installation](docs/installation.md), [project structure](docs/project-structure.md),
> [testing](docs/testing.md) and [the current audit](AUDIT_TO_9_OF_10.md) for the
> verified 2.4.0 state. Keep this file for design history, not operational setup.

## 0. Project goal

Build a local developer tool that gives AI coding agents such as Codex, Claude Code, OpenCode and Cursor enough runtime visibility to debug a React Native + Expo application.

The system must allow an AI agent to:

1. Launch/reload an Expo React Native app.
2. Capture and inspect the current screen.
3. Inspect the UI/accessibility tree.
4. Interact with the app: tap, swipe, text input, back.
5. Collect logs and runtime errors.
6. Observe network requests and API latency.
7. Measure UI/JS performance.
8. Collect memory/CPU information where available.
9. Capture performance traces.
10. Compare before/after screenshots and performance.
11. Produce a structured diagnosis.
12. Repeat the test after modifying source code.

The core philosophy is:

> Do not build a screenshot tool. Build a runtime observability bridge for AI agents.

The supported target is **Android + Windows + Expo/React Native**.

---

# 1. Non-goals for v1

Do NOT attempt to build all of the following initially:

- A full hosted monitoring platform.
- Cloud telemetry.
- User analytics.
- Production crash reporting.
- A custom AI model.
- A custom computer-vision model.
- A complete React DevTools replacement.
- A polished web dashboard before the MCP/CLI workflow works.
- A custom device automation protocol if existing Android/Expo capabilities can be reused.

Prefer integrating existing capabilities over reimplementing them.

---

# 2. Primary users

The primary user is an AI coding agent operating inside a local development repository.

Examples:

- OpenAI Codex
- Claude Code
- OpenCode
- Cursor
- Other MCP-compatible agents

The human developer should also be able to use the same functionality from a CLI.

---

# 3. Recommended language and technology choices

## 3.1 Core language: TypeScript

Use **TypeScript** for the main project.

Reasons:

- The target ecosystem is React Native + Expo.
- MCP integrations are very natural in Node/TypeScript.
- Easy access to ADB, Metro, Expo tooling and filesystem APIs.
- Strong typing is useful for telemetry schemas.
- Shared types can be consumed by both the CLI and MCP server.
- Easier integration with existing JavaScript/React Native tooling.

Do NOT use Python as the primary implementation language.

Python may be used later for optional analysis utilities, but the core runtime must remain TypeScript.

---

## 3.2 Runtime

Use:

- Node.js
- TypeScript
- ESM where practical

Recommended Node version:

- Node.js 22 LTS or newer supported LTS.

Avoid depending on experimental Node APIs unless necessary.

---

## 3.3 Package manager

Use:

- pnpm

Use a pnpm workspace/monorepo.

---

## 3.4 Protocol

Primary AI interface:

- MCP

The MCP server is the main integration surface.

The CLI must also expose the same underlying services so that MCP tools do not contain business logic directly.

Architecture:

```text
CLI
  \
   -> Core Observer Services
  /
MCP Server
```

Never duplicate implementation between CLI and MCP.

---

## 3.5 Mobile runtime

Initial target:

- React Native
- Expo
- Expo development builds
- Android Emulator
- Android physical devices where possible

Do not assume Expo Go is sufficient for every feature.

Features requiring native instrumentation should use an Expo development build / native project.

---

## 3.6 Android device control

Use:

- ADB

ADB is responsible for device-level capabilities such as:

- device discovery
- screenshots
- screen recording
- input/tap
- swipe
- text input
- back/home
- application launch
- logcat
- basic device metrics

Do not implement a custom Android automation protocol unless ADB cannot provide the required functionality.

---

## 3.7 UI inspection

Use the strongest available source in this order:

1. React Native / Expo runtime inspection
2. Android accessibility/UI hierarchy
3. ADB/UIAutomator where applicable
4. Screenshot as visual fallback

The system should combine visual and structural information.

A screenshot alone is not considered sufficient UI observability.

---

## 3.8 Performance

Use native/runtime information where possible.

Potential sources:

- React Native DevTools
- Hermes profiling/runtime information
- Android system metrics
- ADB
- Expo tooling
- React profiler information
- performance traces

Do not invent metrics.

Every metric returned by the system must include:

- value
- unit
- source
- timestamp
- confidence/availability if applicable

---

## 3.9 Network

The first version should support development-time network observability.

Preferred approach:

1. Instrument the application/network layer when possible.
2. Capture request metadata through a development observer.
3. Integrate with existing Expo/React Native DevTools/network tooling when available.
4. Use a local proxy only when necessary.

Never log sensitive values by default.

The network observer must redact:

- Authorization headers
- cookies
- API keys
- tokens
- passwords
- obvious PII

---

## 3.10 Storage

Use SQLite for local session/telemetry storage.

Recommended:

- better-sqlite3 or another stable Node SQLite implementation

Store:

- sessions
- screenshots metadata
- logs
- network events
- performance samples
- traces metadata
- diagnoses
- before/after comparisons

Large binary artifacts should remain files on disk.

SQLite should store references to artifacts, not huge binary blobs.

---

# 4. Repository architecture

Use this structure:

```text
rn-agent-observer/
│
├── apps/
│   └── demo-expo/
│
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── device/
│   │   │   ├── screen/
│   │   │   ├── ui/
│   │   │   ├── interaction/
│   │   │   ├── logs/
│   │   │   ├── network/
│   │   │   ├── performance/
│   │   │   ├── react/
│   │   │   ├── session/
│   │   │   └── artifacts/
│   │   └── package.json
│   │
│   ├── mcp-server/
│   │   ├── src/
│   │   │   ├── tools/
│   │   │   ├── resources/
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   ├── cli/
│   │   ├── src/
│   │   └── package.json
│   │
│   ├── schemas/
│   │   ├── src/
│   │   │   ├── device.ts
│   │   │   ├── screen.ts
│   │   │   ├── ui.ts
│   │   │   ├── network.ts
│   │   │   ├── performance.ts
│   │   │   ├── session.ts
│   │   │   └── diagnosis.ts
│   │   └── package.json
│   │
│   └── rn-instrumentation/
│       ├── src/
│       └── package.json
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
│
├── artifacts/
│   └── .gitkeep
│
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── metrics.md
│   └── troubleshooting.md
│
├── AGENTS.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

---

# 5. Architectural principles

## Principle 1 — Core first

All actual device/observation logic belongs in `packages/core`.

MCP should only adapt core functionality into MCP tools.

CLI should only adapt core functionality into CLI commands.

---

## Principle 2 — Everything must be structured

Do not return arbitrary text if structured data is possible.

Bad:

```text
FPS is around 45 and the API seems slow.
```

Good:

```json
{
  "metric": "ui_fps",
  "value": 45,
  "unit": "fps",
  "timestamp": "...",
  "source": "react-native"
}
```

AI agents reason better over deterministic structured data.

---

## Principle 3 — Evidence before diagnosis

The tool must distinguish:

- observed facts
- calculated metrics
- hypotheses
- recommendations

Never return:

```text
The API caused the lag.
```

unless there is evidence.

Prefer:

```json
{
  "finding": "Long JS task observed",
  "evidence": {
    "duration_ms": 78,
    "ui_fps": 41,
    "js_blocking_ms": 64
  },
  "confidence": 0.91
}
```

---

## Principle 4 — Artifacts are first-class

Screenshots, videos and traces must be stored as artifacts.

Example:

```text
.artifacts/
└── sessions/
    └── 2026-08-21T11-30-00/
        ├── screenshots/
        ├── recordings/
        ├── traces/
        ├── logs/
        ├── network/
        └── summary.json
```

Do not embed huge binary content directly into MCP responses.

Return artifact paths/references.

---

## Principle 5 — AI-friendly responses

MCP responses should be:

- concise
- deterministic
- structured
- machine-readable
- easy to reason about

Avoid dumping thousands of log lines unless explicitly requested.

Provide summaries and allow drill-down.

---

# 6. MCP tools

Implement the following tools incrementally.

## Phase 1 tools

### `device_list`

Returns available Android devices/emulators.

Example:

```json
{
  "devices": [
    {
      "id": "emulator-5554",
      "platform": "android",
      "state": "device",
      "model": "Pixel_8"
    }
  ]
}
```

---

### `device_info`

Returns:

- device ID
- platform
- Android version
- model
- resolution
- density
- orientation

---

### `app_launch`

Launch the configured React Native application.

---

### `app_reload`

Reload the development application.

---

### `screenshot`

Capture the current screen.

Return:

- artifact reference
- dimensions
- timestamp

---

### `get_ui_tree`

Return a normalized UI tree.

Each element should contain where available:

```json
{
  "id": "buy-button",
  "type": "Pressable",
  "text": "Buy now",
  "bounds": {
    "x": 32,
    "y": 2100,
    "width": 1016,
    "height": 120
  },
  "clickable": true,
  "visible": true
}
```

---

### `tap`

Arguments:

```json
{
  "x": 100,
  "y": 500
}
```

or preferably:

```json
{
  "testID": "buy-button"
}
```

---

### `swipe`

Arguments:

```json
{
  "start": {"x": 500, "y": 1800},
  "end": {"x": 500, "y": 500},
  "duration_ms": 500
}
```

---

### `type_text`

Support text entry.

---

### `back`

Perform Android back navigation.

---

### `get_logs`

Return structured application logs.

Support filters:

- level
- time range
- source
- keyword

---

# 7. Phase 2 — Performance

Implement:

### `performance_snapshot`

Return:

```json
{
  "ui_fps": 58,
  "js_fps": 55,
  "frame_time_ms": 17.2,
  "dropped_frames": 3,
  "js_blocking_ms": 8,
  "memory_mb": 384,
  "timestamp": "..."
}
```

If a metric is unavailable, return:

```json
{
  "value": null,
  "available": false,
  "reason": "..."
}
```

Never fake a value.

---

### `start_trace`

Start a performance trace.

Arguments:

```json
{
  "duration_ms": 10000
}
```

---

### `stop_trace`

Stop and save the trace.

---

### `get_react_render_stats`

Where technically available, report:

- component name
- render count
- render duration
- commit count
- changed props
- timestamp

If direct access is not available, document the limitation and provide the best available runtime signal.

---

# 8. Phase 3 — Network observability

Implement:

### `get_network_requests`

Return recent requests:

```json
{
  "method": "GET",
  "url": "/api/products/123",
  "status": 200,
  "duration_ms": 248,
  "request_bytes": 421,
  "response_bytes": 183421,
  "timestamp": "..."
}
```

Where available, expose timing breakdown:

```json
{
  "dns_ms": 2,
  "tcp_ms": 4,
  "tls_ms": 11,
  "ttfb_ms": 213,
  "download_ms": 17,
  "total_ms": 248
}
```

Sensitive headers must be redacted.

---

### `get_network_summary`

Aggregate:

- request count
- failed requests
- average latency
- p50
- p95
- p99
- total bytes
- slowest endpoints

---

# 9. Phase 4 — Unified observation

Implement the most important tool:

## `observe_screen`

Arguments:

```json
{
  "include": [
    "screenshot",
    "ui_tree",
    "route",
    "performance",
    "network",
    "logs"
  ]
}
```

The response should provide a compact snapshot.

Example:

```json
{
  "timestamp": "...",

  "screen": {
    "width": 1080,
    "height": 2400,
    "orientation": "portrait"
  },

  "route": "/products/123",

  "screenshot": {
    "artifact": "..."
  },

  "ui_tree": {
    "element_count": 43
  },

  "performance": {
    "ui_fps": 47,
    "js_fps": 31,
    "worst_frame_ms": 78
  },

  "network": {
    "active_requests": 2,
    "slowest_request_ms": 842
  },

  "errors": {
    "count": 0
  }
}
```

This should become the default tool an AI agent uses before diagnosing UI issues.

---

# 10. Phase 5 — Sessions

Implement:

### `start_session`

Creates:

```text
session_id
```

---

### `stop_session`

Stops collection and creates a summary.

---

### `get_session`

Returns:

- timeline
- screenshots
- logs
- network
- performance
- errors
- traces

---

# 11. Phase 6 — Diagnosis

Implement:

## `diagnose`

This should NOT be an LLM initially.

It should be a deterministic rule-based analyzer.

Example rules:

```text
IF UI FPS < 45
AND JS blocking > 40ms
THEN
  finding = "JS thread blocking likely contributes to frame drops"
```

```text
IF request duration > 1000ms
AND UI FPS normal
THEN
  finding = "Network latency detected without direct evidence of UI thread blocking"
```

```text
IF component render count is abnormally high
AND props/state are stable
THEN
  finding = "Potential unnecessary React re-renders"
```

Return:

```json
{
  "severity": "high",
  "findings": [
    {
      "title": "Long JS task",
      "confidence": 0.91,
      "evidence": [
        "JS blocked for 64ms",
        "worst frame was 78ms",
        "UI FPS dropped to 41"
      ]
    }
  ]
}
```

The AI agent can then use these findings as evidence.

---

# 12. Phase 7 — Visual comparison

Implement:

## `compare_screens`

Input:

```json
{
  "before": "artifact://...",
  "after": "artifact://..."
}
```

Return:

- image dimensions
- changed regions if available
- similarity score if implemented
- layout metadata differences
- UI tree differences

Do not rely solely on a generic image similarity score.

Prefer structural comparison when possible.

---

# 13. Phase 8 — AI debugging workflow

The system must support this workflow:

```text
1. Start app
2. Observe screen
3. Reproduce issue
4. Record session
5. Capture performance
6. Capture network
7. Capture logs
8. Inspect UI tree
9. Diagnose
10. Modify source code
11. Reload app
12. Reproduce
13. Capture again
14. Compare
15. Report whether the issue improved
```

Codex should be able to perform this without the human manually taking screenshots.

---

# 14. Recommended CLI

Create:

```bash
rn-observe devices
rn-observe launch
rn-observe screenshot
rn-observe ui-tree
rn-observe tap --test-id buy-button
rn-observe swipe --from 500,1800 --to 500,500
rn-observe logs
rn-observe performance
rn-observe network
rn-observe observe
rn-observe trace
rn-observe session start
rn-observe session stop
rn-observe diagnose
```

The CLI is mainly for humans and debugging the observer itself.

---

# 15. MCP naming conventions

Use clear verb/noun names.

Good:

```text
device_list
device_info
app_launch
app_reload
screenshot
get_ui_tree
tap
swipe
get_logs
performance_snapshot
start_trace
stop_trace
get_network_requests
get_network_summary
observe_screen
start_session
stop_session
get_session
diagnose
compare_screens
```

Avoid names such as:

```text
magic_debug
super_observe
do_everything
ai_debug
```

---

# 16. Data model

Create strongly typed schemas.

At minimum:

```text
Device
ScreenSnapshot
UIElement
UITree
LogEntry
NetworkRequest
PerformanceSnapshot
Trace
Artifact
Session
Finding
Diagnosis
```

Use Zod for runtime validation if appropriate.

All MCP inputs and outputs should be validated.

---

# 17. Error handling

Errors must be structured.

Example:

```json
{
  "error": {
    "code": "DEVICE_NOT_FOUND",
    "message": "No Android device is available",
    "recoverable": true,
    "suggestion": "Start an Android emulator or connect a device"
  }
}
```

Do not return raw stack traces to the AI unless requested.

Keep detailed stack traces in diagnostic artifacts.

---

# 18. Security/privacy requirements

Never expose secrets by default.

Redact:

```text
Authorization
Cookie
Set-Cookie
X-API-Key
access_token
refresh_token
password
secret
```

Network body capture should be OFF by default.

Provide an explicit development-only option:

```text
--capture-network-body
```

and clearly warn that it can expose sensitive information.

---

# 19. Performance requirements of the observer

The observer itself must not become the source of the performance problem.

Requirements:

- Avoid high-frequency screenshot capture by default.
- Avoid polling at extremely high frequency.
- Batch telemetry.
- Keep large artifacts on disk.
- Do not serialize enormous UI trees unnecessarily.
- Do not instrument production builds by default.
- Allow sampling intervals.
- Make performance collection configurable.

Example:

```json
{
  "sampling": {
    "performance_ms": 250,
    "network": true,
    "logs": true,
    "screenshots": "on-demand"
  }
}
```

---

# 20. Testing strategy

## Unit tests

Test:

- ADB parser
- log parser
- network parser
- telemetry schema
- diagnosis rules
- artifact manager
- UI tree normalization

## Integration tests

Use a deterministic Expo demo application.

The demo app must intentionally contain:

1. A slow API simulation.
2. A component that rerenders unnecessarily.
3. A deliberately expensive JS task.
4. A screen with animation.
5. A list with many elements.
6. A screen with a visual regression fixture.

This allows the observer to prove that it can detect known problems.

---

# 21. Demo application

Create:

```text
apps/demo-expo
```

Screens:

```text
Home
PerformanceLab
NetworkLab
RenderLab
AnimationLab
ErrorLab
```

## PerformanceLab

Include:

- button to trigger a 100ms JS task
- animation
- large list

Expected:

```text
FPS drops
JS blocking increases
```

## NetworkLab

Include:

- fast endpoint
- 500ms endpoint
- 2s endpoint
- failing endpoint

Expected:

```text
network observer detects latency/errors
```

## RenderLab

Include a deliberately badly memoized list.

Expected:

```text
high render count
```

## ErrorLab

Include:

- console error
- handled exception
- unhandled exception where safe for development

---

# 22. Development phases

## Phase 0 — Research and capability mapping

Before implementing functionality:

- inspect current Expo agent-device capabilities
- inspect Expo MCP capabilities
- inspect React Native DevTools capabilities
- inspect ADB capabilities
- identify what can be reused
- document gaps

Deliverable:

```text
docs/capability-matrix.md
```

Do not duplicate functionality that already exists and is reliable.

---

## Phase 1 — Project foundation

Implement:

- pnpm monorepo
- TypeScript
- ESLint
- Prettier
- Vitest
- Zod
- core package
- CLI package
- MCP package
- schemas package

Deliverable:

```text
pnpm test
pnpm build
```

must work.

---

## Phase 2 — Device + screen

Implement:

- device_list
- device_info
- app_launch
- app_reload
- screenshot

Acceptance:

AI can launch app and receive a screenshot artifact.

---

## Phase 3 — UI interaction

Implement:

- get_ui_tree
- tap
- swipe
- type_text
- back

Acceptance:

AI can navigate the demo app without human interaction.

---

## Phase 4 — Logs + errors

Implement:

- get_logs
- structured error collection

Acceptance:

Known demo errors are detected.

---

## Phase 5 — Performance

Implement:

- performance_snapshot
- start_trace
- stop_trace
- performance artifact

Acceptance:

The deliberately slow demo task produces measurable evidence.

---

## Phase 6 — Network

Implement:

- get_network_requests
- get_network_summary

Acceptance:

The NetworkLab latency tests are detected correctly.

---

## Phase 7 — Unified observer

Implement:

- observe_screen

Acceptance:

One MCP call returns a useful compact state snapshot.

---

## Phase 8 — Sessions

Implement:

- start_session
- stop_session
- get_session

Acceptance:

A complete reproduction can be saved and inspected later.

---

## Phase 9 — Diagnosis

Implement deterministic rules.

Acceptance:

Known demo performance problems produce the expected findings.

---

## Phase 10 — Visual comparison

Implement:

- compare_screens

Acceptance:

Known UI changes are detected.

---

## Phase 11 — Agent workflow

Create:

```text
AGENTS.md
```

with instructions telling Codex how to use the observer.

The goal is that Codex can execute:

```text
observe
diagnose
edit
reload
observe
compare
```

without manual intervention.

---

# 23. AGENTS.md behavior

The future `AGENTS.md` should tell Codex:

```text
When debugging React Native UI issues:

1. Do not assume the UI state from source code alone.
2. Use rn-agent-observer to inspect the running app.
3. Take a screenshot before making UI changes.
4. Inspect UI tree when available.
5. Check logs.
6. Check performance if the issue involves lag or animation.
7. Check network when the issue involves loading or API latency.
8. Reproduce the issue before changing code.
9. Make the smallest reasonable fix.
10. Reload/rebuild.
11. Reproduce the same scenario.
12. Compare before/after observations.
13. Report evidence and remaining uncertainty.
```

---

# 24. Definition of done for v1

v1 is complete when an AI agent can perform this task:

```text
"Open the demo app, navigate to PerformanceLab,
reproduce the lag, determine whether the problem is
JS, UI rendering, React re-renders, or network,
modify the source code to fix the problem,
reload the app, reproduce the same interaction,
and provide before/after performance evidence."
```

without a human manually inspecting the emulator.

---

# 25. Priority order

Implement in exactly this priority unless a technical blocker requires adjustment:

```text
P0
├── TypeScript monorepo
├── core abstraction
├── ADB device manager
├── screenshot
├── MCP server
└── CLI

P1
├── UI tree
├── tap
├── swipe
├── type_text
├── back
└── logs

P2
├── performance snapshot
├── traces
├── network
└── React render metrics

P3
├── observe_screen
├── sessions
└── artifacts

P4
├── diagnosis
└── compare_screens

```

---

# 26. Important implementation rule

Do not attempt to implement everything in one pass.

At the beginning of each task:

1. Inspect the existing repository.
2. Inspect current Expo/React Native capabilities.
3. Determine what already works.
4. Implement one phase.
5. Add tests.
6. Run tests.
7. Run the demo.
8. Verify the result through the observer itself.
9. Update documentation.
10. Only then move to the next phase.

If a requested capability is impossible through the current Expo architecture, document the limitation and propose the smallest native/dev-build integration required.

---

# 27. First Codex task

The first implementation task is:

## "Bootstrap the repository and capability matrix"

Tasks:

1. Create the pnpm monorepo.
2. Create:
   - packages/core
   - packages/mcp-server
   - packages/cli
   - packages/schemas
   - packages/rn-instrumentation
   - apps/demo-expo
3. Configure TypeScript.
4. Configure Vitest.
5. Configure ESLint and Prettier.
6. Add Zod.
7. Add shared types.
8. Create the initial CLI executable:
   ```bash
   rn-observe --help
   ```
9. Create an MCP server that starts successfully.
10. Create placeholder tool registration.
11. Create:
    ```text
    docs/capability-matrix.md
    ```
12. Research and document which capabilities can be provided by:
    - Expo agent-device
    - Expo MCP
    - React Native DevTools
    - ADB
    - React Native runtime instrumentation
13. Do not implement device automation yet.
14. Do not create a dashboard yet.
15. Do not add a database yet unless required by the foundation.
16. Run:
    ```bash
    pnpm install
    pnpm build
    pnpm test
    ```
17. Ensure all commands succeed.
18. Update README with setup instructions.

---

# 28. Codex operating rule

For every implementation task, provide a short final report containing:

```text
## Implemented
- ...

## Tests
- ...

## Runtime verification
- ...

## Known limitations
- ...

## Next recommended task
- ...
```

Do not claim a feature works unless it has been executed or tested.

If a feature cannot be verified because an Android emulator/device is unavailable, explicitly state:

```text
NOT VERIFIED — Android device unavailable
```

rather than pretending it works.

---

# 29. Long-term vision

The eventual product should feel like:

```text
AI Agent
   │
   │ "debug this screen"
   ▼
Mobile Runtime Observer
   │
   ├── Vision
   ├── UI Tree
   ├── React
   ├── JS Runtime
   ├── UI Thread
   ├── Network
   ├── Memory
   ├── CPU
   ├── Logs
   ├── Traces
   └── Device
          │
          ▼
     Evidence Graph
          │
          ▼
     Root Cause Analysis
          │
          ▼
       Code Fix
          │
          ▼
      Verification
```

The core differentiator is not another MCP wrapper.

The differentiator is the **unified evidence layer** that lets an AI coding agent correlate:

```text
SCREEN
+
UI TREE
+
REACT TREE
+
RENDER EVENTS
+
JS THREAD
+
UI THREAD
+
NETWORK
+
LOGS
+
TRACE
+
SOURCE CODE
```

and reason about the actual runtime behavior of a React Native application.
