# `@rn-agent-observer/cli`

Command-line interface for RN Agent Observer, an evidence-based local runtime
observer for React Native and Expo applications.

## Install

Check registry availability first. Before the first npm publication, use the
[source installation](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/installation.md)
and run `pnpm rn-observe` from the repository.

```sh
pnpm add --save-dev @rn-agent-observer/cli
pnpm exec rn-observe --help
```

The CLI requires Node.js 22.12 or newer. Android runtime commands additionally
require `adb`, a connected emulator or device, and the target app's project root.
Initialize read-only policy before doing any active work:

```sh
export RN_OBSERVER_PROJECT_ROOT=/path/to/app
export RN_OBSERVER_DEVICE_ID=emulator-5554
pnpm exec rn-observe doctor
pnpm exec rn-observe init --dry-run
pnpm exec rn-observe init
pnpm exec rn-observe observe
```

The observer records large evidence under `<projectRoot>/.artifacts/` and returns
paths and metadata instead of embedding binary data in command responses.

Use `session start`, set `RN_OBSERVER_SESSION_ID`, collect/reproduce/compare, then
`session stop` to create summary/replay/evidence graph. Active actions fail closed
unless an owner reviewed the exact app/device/risk allowlist and set process trust.

See the [installation guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/installation.md),
[usage guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/usage.md), and
[security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).
