# Capability matrix

Research snapshot: **2026-08-21**. This matrix uses current official Expo, React Native, Android, and Callstack/Expo-linked documentation. Capabilities are version-sensitive; re-check sources before implementing each phase.

## Summary

| Capability                      | agent-device                                     | Expo MCP local                      | React Native DevTools                                                             | ADB / Android                                                       | RN instrumentation                             | Android v1 decision                                 |
| ------------------------------- | ------------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------- |
| Discover/launch app             | Yes, broad platform support                      | Local automation support            | No                                                                                | Yes, Android package/activity                                       | App-specific only                              | Prefer agent-device; ADB fallback                   |
| Screenshot/video                | Yes, artifacts                                   | Screenshot/automation               | No direct agent API documented                                                    | `screencap`; screenrecord                                           | Possible but intrusive                         | Reuse agent-device; ADB fallback                    |
| Semantic UI/accessibility tree  | Yes, refs/selectors                              | Find by `testID`, tap               | React component inspector is interactive                                          | UIAutomator hierarchy, partial RN semantics                         | Can publish app-owned semantics                | Prefer agent-device; normalize result               |
| Structured screen understanding | Agent-authored from tree/vision                  | No built-in diagnosis               | Visual inspection is interactive                                                  | Deterministic state/headline/actions/findings + screenshot evidence | Can add exact app state/error causes           | Local heuristic bridge; verify against artifacts    |
| Source ↔ runtime UI ownership   | Runtime refs; source support varies              | Router/source context               | Component owner + props interactively                                             | Native bounds/clickable only                                        | Source ID, lifecycle and handler outcome       | AST + instrumentation + native correlation          |
| Tap/type/swipe/back             | Yes                                              | Automation tools                    | No                                                                                | `adb shell input`                                                   | App-owned commands possible                    | Prefer semantic refs; coordinate fallback           |
| Logs/errors                     | Focused windows                                  | `collect_app_logs`                  | Console is JS source of truth                                                     | logcat/native logs                                                  | Structured app events                          | Combine focused sources, never unbounded logs       |
| Network requests                | Yes                                              | DevTools integration                | RN 0.83+: fetch/XHR/Image; Expo panel has broader Expo coverage but fewer details | No reliable app-layer HTTP semantics without proxy/instrumentation  | Best place for redaction and app metadata      | Prefer DevTools/instrumentation; redact at boundary |
| React tree/render profiling     | Supported when DevTools connection is compatible | Can open DevTools                   | Components, Profiler, render highlighting                                         | No                                                                  | React Profiler hooks/custom marks possible     | Reuse DevTools; document automation gaps            |
| JS performance traces           | Yes                                              | DevTools access                     | RN 0.83+: JS/React/network/user timings                                           | Native trace only                                                   | `PerformanceObserver`/user timing              | Combine DevTools traces and runtime marks           |
| Native CPU/memory/trace         | Yes, app-specific in dev build                   | Limited by local setup              | JS heap; not native replacement                                                   | `dumpsys`, proc stats, Perfetto                                     | Native module required for richer signals      | ADB/Perfetto on Android; dev build required         |
| Route/navigation state          | Snapshot may infer visible state                 | Expo Router sitemap, local analysis | Component tree only                                                               | No                                                                  | Navigation hook/plugin can publish exact route | Add opt-in dev instrumentation                      |
| Cross-platform                  | Multi-platform support claimed                   | Expo-oriented                       | RN/Hermes                                                                         | Android only                                                        | Depends on implementation                      | Keep provider-neutral core                          |

## Provider notes and gaps

### agent-device

Expo's current guide describes `agent-device` as an open-source agent-native CLI that can inspect accessibility state, interact, capture screenshots/video/logs/network/traces/performance, and expose MCP. It runs against an installed app without adding a library for device-level automation. React component inspection and profiling still require a compatible React DevTools connection. Native metrics collected against Expo Go describe the Expo Go host; use a development build for app-specific profiling.

Decision: do not recreate its session protocol in v1. Consider an agent-device provider after Android v1, retain the verified direct ADB path for prerequisites and gaps, and pin/test supported versions.

### Expo MCP

Expo MCP provides remote documentation/EAS capabilities and SDK 54+ local capabilities when `expo-mcp` is installed and Expo starts with `EXPO_UNSTABLE_MCP_SERVER=1`. Documented local tools include screenshots, taps, `testID` lookup, DevTools opening, Router sitemap generation, and focused app-log collection.

Decision: treat Expo MCP as complementary, not as the core business-logic location. RN Agent Observer should normalize evidence and work when an Expo account/MCP connection is unavailable.

### React Native DevTools

React Native DevTools requires Hermes and RN 0.76+. RN 0.83 added integrated Network and Performance panels. The network recorder covers `fetch`, XHR, and Image; Expo-specific network inspection currently covers additional Expo sources but lacks initiator and Performance-panel integration. Components, Profiler, console, JS heap snapshots, JS execution traces, React tracks, and user timings are available interactively. Official docs recommend Android Studio/Xcode for accurate native measurements.

Decision: reuse DevTools protocols/features when a stable supported API exists; do not scrape its UI. Fill automation/export gaps with opt-in development instrumentation and native tools.

### ADB and Android tooling

ADB reliably provides device discovery, package/activity commands, raw input, screenshots, logcat access, and system service data. UIAutomator can dump an Android window hierarchy. `dumpsys` exposes system services, and Perfetto provides native/system tracing. These sources do not provide a trustworthy React tree, JS FPS, exact app route, or complete app-layer network timings by themselves.

Implementation: Android v1 uses ADB as a small injected process adapter with parsers and timeouts, not as the unified evidence model. Device, screen, UI, actions, logcat, gfx/memory/CPU and Perfetto paths have been runtime-verified. Every derived value identifies its source.

### React Native runtime instrumentation

Development-only JavaScript instrumentation can add route state, structured logs, redacted request timing, render/user timing marks, and domain context. It adds overhead and cannot replace native thread/process measurements.

Decision: keep it opt-in, development-only, batched, redacted, and measurable. Network body collection remains off by default.

## Reuse plan

1. Core defines provider-neutral interfaces and structured evidence schemas.
2. Prefer `agent-device` for cross-platform semantic device automation.
3. Use Expo MCP for Expo/EAS context and available local tools.
4. Use ADB/UIAutomator/Perfetto for Android fallback and native evidence.
5. Use React Native DevTools for React/JS/network/performance evidence where export/automation is supported.
6. Add minimal runtime instrumentation only for missing app-owned facts.

## Observer 2.4 implementation status

- CDP automation remains single-target, but observer commands now use an atomic cross-process queue. External React Native DevTools does not participate in this queue and must be closed.
- Session refs preserve identity across reorder/scroll; this improves agent safety but does not provide React props/component stacks.
- Session interaction timelines automatically export to replay JSON. Text contents are intentionally omitted to avoid persisting credentials.
- Runtime UI model now parses actionable JSX through the TypeScript AST and correlates source location with explicit/generated testID, instrumentation and native visibility. The optional development Babel plugin records physical handler outcomes; it does not serialize arguments/props.
- URL/header/body preview redaction is allowlist-based and fail-closed. Body capture remains development-only and off by default.
- Gfxinfo frame windows have freshness detection; repeated unchanged windows become unavailable instead of being reported as new benchmark samples.
- Still absent: full React component props/stack protocol export, off-screen virtualized-list instances, macOS/Linux host support, contrast/focus-order audit, and negotiated CDP protocol versions.

## Official sources

- [Expo: agent-device and Expo](https://docs.expo.dev/agents/agent-device/)
- [Expo: Using MCP with Expo](https://docs.expo.dev/mcp/)
- [Expo: Debugging and profiling tools](https://docs.expo.dev/debugging/tools/)
- [Expo: Dev tools plugins](https://docs.expo.dev/debugging/devtools-plugins/)
- [React Native: React Native DevTools](https://reactnative.dev/docs/react-native-devtools)
- [React Native: Debugging basics](https://reactnative.dev/docs/debugging.html)
- [Android: Android Debug Bridge](https://developer.android.com/tools/adb)
- [Android: dumpsys](https://developer.android.com/tools/dumpsys)
- [Android: Perfetto](https://developer.android.com/tools/perfetto)
- [Android: UiDevice hierarchy API](https://developer.android.com/reference/androidx/test/uiautomator/UiDevice)
