# `@rn-agent-observer/cli`

Command-line interface for RN Agent Observer, an evidence-based local runtime
observer for React Native and Expo applications.

## Install

```sh
pnpm add --save-dev @rn-agent-observer/cli
pnpm exec rn-observe --help
```

The CLI requires Node.js 22.12 or newer. Android runtime commands additionally
require `adb`, a connected emulator or device, and the target app's project root.

```sh
RN_OBSERVER_PROJECT_ROOT=/path/to/app \
RN_OBSERVER_DEVICE_ID=emulator-5554 \
pnpm exec rn-observe observe
```

The observer records large evidence under `<projectRoot>/.artifacts/` and returns
paths and metadata instead of embedding binary data in command responses.

See the [installation guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/release-installation.md),
[usage guide](https://github.com/GinzaTech/rn-agent-observer/blob/main/docs/usage.md), and
[security policy](https://github.com/GinzaTech/rn-agent-observer/security/policy).
