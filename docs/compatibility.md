# Compatibility and verification matrix

Snapshot: **2026-08-25**, repository version **2.5.0**. Runtime rows retain the
exact demo `2.4.0` fixture version where that is the build that actually ran.

This document separates supported contracts from evidence collected on a specific
host or target. A green host gate, TypeScript build, Expo export, emulator result,
or older device run must never be presented as proof for a different device.

## Status vocabulary

| Status             | Meaning                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| `SUPPORTED`        | Maintained public contract with automated source/package gates          |
| `FIXTURE_VERIFIED` | The named exact fixture and scenario produced current evidence          |
| `HOST_ONLY`        | Build/test/package evidence exists, but no target runtime was exercised |
| `NOT_VERIFIED`     | No current evidence for this exact target/scenario                      |
| `EXTENSION_ONLY`   | Provider contract exists, but the repository has no built-in runtime    |

## Host and toolchain

| Surface                      | Declared range / fixture       | Current evidence                                                      | Status      |
| ---------------------------- | ------------------------------ | --------------------------------------------------------------------- | ----------- |
| Node.js                      | `>=22.12.0`                    | Local 22.19; CI pins 22.12                                            | `SUPPORTED` |
| pnpm                         | 9.6.0                          | Frozen lockfile install gate                                          | `SUPPORTED` |
| Windows host                 | Current GitHub runner + local  | lint, format, build, unit, MCP, package, Android export/release gates | `HOST_ONLY` |
| Ubuntu host                  | Current GitHub runner          | lint, format, build and unit gates                                    | `HOST_ONLY` |
| macOS host                   | Current GitHub runner          | lint, format, build and unit gates                                    | `HOST_ONLY` |
| Android Platform Tools/`adb` | Recent platform-tools required | CLI parses and pins exact serials; no device is inferred from a host  | `SUPPORTED` |

`HOST_ONLY` does not mean device-facing commands were executed on that operating
system. CI jobs without an attached target cannot expand runtime support.

## React Native, Expo and target runtime

| Surface                        | Exact fixture / boundary                      | Current evidence                                                                   | Status               |
| ------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| Demo React Native              | 0.86.2 + Hermes                               | Host gates, physical API 35 and emulator API 24/30/36 development sessions         | `FIXTURE_VERIFIED`   |
| Demo Expo                      | SDK 57.0.15                                   | Default/opt-in config, export and four exact Android runtime fixtures              | `FIXTURE_VERIFIED`   |
| Android emulator negative path | Demo app stopped/background, Android emulator | UI model returns `target-not-running`/`target-not-foreground` without false issues | `FIXTURE_VERIFIED`   |
| Android emulator API 24        | Google APIs x86_64, 480×800                   | Complete PerformanceLab + NetworkLab session on 2026-08-24                         | `FIXTURE_VERIFIED`   |
| Android emulator API 30        | Google APIs x86_64, 480×800                   | Complete PerformanceLab + NetworkLab session on 2026-08-24                         | `FIXTURE_VERIFIED`   |
| Android emulator API 36        | Google APIs Play Store x86_64, 1080×2400      | Complete PerformanceLab + NetworkLab session on 2026-08-24                         | `FIXTURE_VERIFIED`   |
| Physical Android device        | Xiaomi `23013PC75G`, Android 15 API 35, arm64 | 2026-08-24 complete demo session; exact serial kept in local evidence              | `FIXTURE_VERIFIED`   |
| Broad OEM/device-farm matrix   | At least two OEMs per maintained API tier     | Three local emulator tiers + one physical OEM are not a maintained device farm     | `NOT_VERIFIED`       |
| Expo development build         | Required for app-owned instrumentation        | Demo 2.4.0 route/network/render/JS/UI telemetry accepted on four exact fixtures    | `FIXTURE_VERIFIED`   |
| Expo Go                        | Host-container observation only               | Never treated as app-specific native evidence                                      | `SUPPORTED` boundary |
| iOS                            | External provider contract only               | No built-in provider or repository runtime evidence                                | `EXTENSION_ONLY`     |
| Web                            | External provider contract only               | No built-in provider or repository runtime evidence                                | `EXTENSION_ONLY`     |
| Windows app target             | External provider contract only               | Windows is a host, not a built-in target provider                                  | `EXTENSION_ONLY`     |

The demo versions are a continuously gated fixture, not a promise that every React
Native or Expo version works. Community compatibility claims should add an exact
version tuple, target fingerprint, scenario, session ID, artifact hashes and date.

## Capability boundary

- Android ADB/UIAutomator/Perfetto is the only built-in runtime provider.
- Route, React render, JS task and app-layer network metadata require compatible
  development instrumentation; missing instrumentation is unavailable data, not
  zero.
- React Native DevTools/CDP paths require Hermes, the correct Metro target and no
  competing DevTools client.
- `ui-model` can correlate actionable TSX/JSX and native semantics, but React Native
  flattening and off-screen virtualization remain explicit unknown states.
- Active actions require both exact app/device allowlists and the process-side
  `RN_OBSERVER_TRUST_ACTIVE_CONFIG=1` opt-in. Repository config cannot authorize
  itself.

## Adding a compatibility row

1. Record `adb devices -l`, device fingerprint, Android API, app ID, app/build
   revision, RN/Expo/Hermes versions and host version.
2. Run a deterministic owned fixture inside an Observer session.
3. Attach the session graph plus screenshot/UI-tree/performance/network artifacts
   by path and hash; do not commit sensitive raw artifacts.
4. State unavailable sources and limitations. Do not promote one target result to a
   whole platform claim.
5. Add the tuple only after the same scenario is reproducible from documented
   commands.

See the [Android emulator matrix](android-device-matrix.md), [testing](testing.md),
[capability matrix](capability-matrix.md), and the
[Maestro integration example](../examples/maestro/README.md).
