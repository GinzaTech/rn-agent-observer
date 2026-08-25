# `@rn-agent-observer/cli`

Command-line interface for RN Agent Observer, an evidence-based local runtime
observer for React Native and Expo applications.

## Install

The current public consumer release is `2.5.0`.

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

Author a project suite offline, or import privacy-reduced JUnit evidence from an
external runner into the active Observer session:

```sh
pnpm exec rn-observe suite init .rn-observer/suites/smoke.yaml --profile smoke
pnpm exec rn-observe suite validate .rn-observer/suites/smoke.yaml
pnpm exec rn-observe runner import test-results/mobile.xml --runner maestro --strict
pnpm exec rn-observe runner compare BASELINE_RUNNER_RESULT.json CURRENT_RUNNER_RESULT.json --strict
```

The JUnit importer supports `maestro`, `detox`, `appium`, and `generic` labels. It
does not persist raw XML, paths, test names, or failure messages. Comparison uses
only normalized artifacts and case hashes to report new, recovered, and persistent
failures; missing/incomplete evidence cannot become a false PASS.

The observer records large evidence under `<projectRoot>/.artifacts/` and returns
paths and metadata instead of embedding binary data in command responses.

Use `session start`, set `RN_OBSERVER_SESSION_ID`, collect/reproduce/compare, then
`session stop` to create summary/replay/evidence graph. Active actions fail closed
unless an owner reviewed the exact app/device/risk allowlist and set process trust.

See the [installation guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/installation.md),
[usage guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/usage.md),
[runner integration guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/runner-integrations.md), and
[security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).
