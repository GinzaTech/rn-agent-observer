---
name: rn-agent-observer
description: Runtime observability for React Native/Expo apps on Android. Use when debugging RN UI, performance (FPS, JS blocking), network, re-renders, or runtime errors on a running app — understand the current screen and UI findings, capture screenshots, UI trees, ref snapshots, per-request network, CDP console/heap/CPU profiles, run deterministic diagnosis, and compare before/after code changes with evidence. Works via CLI (rn-observe) or MCP, fully offline.
---

# RN Agent Observer Skill

Give yourself eyes on a running React Native/Expo app (Android). Evidence-first:
every metric carries `{value, unit, source, timestamp, available}` — never guessed.
Findings are evidence-backed hypotheses, not truths.

## Prerequisites

1. The observer CLI available on this machine. If missing, install from the repo:

   ```bash
   git clone https://github.com/GinzaTech/rn-agent-observer.git
   cd rn-agent-observer && pnpm install && pnpm build
   ```

   Everything below assumes you are inside that repo (or `pnpm --dir <repo> ...`).

2. `adb` on PATH and one Android device/emulator in state `device` (`adb devices -l`).

## Session setup (do this first, every conversation that touches the app)

```powershell
# In the OBSERVER repo directory:
$env:RN_OBSERVER_PROJECT_ROOT = '<path-to-the-observed-app>'   # the Expo/RN app, not the observer repo
$env:RN_OBSERVER_DEVICE_ID = '<serial>'                        # required if multiple devices
# RN_OBSERVER_APP_ID only if the app has no expo.android.package

pnpm rn-observe devices          # sanity: device ready
pnpm rn-observe session start    # copy the returned id into RN_OBSERVER_SESSION_ID
$env:RN_OBSERVER_SESSION_ID = '<session-id>'
pnpm rn-observe launch           # cold start the app
pnpm rn-observe app-state        # confirms process + foreground
```

Optional (unlocks CDP features — console/heap/CPU profile, per-request network, fast reload):
Metro must run **for the target app**, then `adb reverse tcp:8081 tcp:8081`
(or set `RN_OBSERVER_METRO_URL` when Metro uses another port).
Never keep React Native DevTools open simultaneously — one inspector connection per target.

## The debugging loop (always follow this order)

```text
session start -> observe -> understand-screen -> reproduce (semantic testID first) ->
performance/network/logs -> diagnose -> smallest fix -> reload --fast ->
reproduce the SAME scenario -> understand-screen -> compare -> session stop -> report evidence
```

Rules that make evidence trustworthy:

- Prefer semantic targets: `tap --test-id` >> `tap --ref` >> coordinates.
- Treat `understand-screen` state/issues as deterministic heuristic evidence. Open `screenshotPath`; call again after the threshold when state is `loading` to detect `loading-stuck`.
- `diagnose` findings = hypotheses; quote evidence and `confidenceBasis`. Confidence is a heuristic score, never a probability.
- After fixing code: reproduce **identically**, then `compare` both PNG and UI-tree JSON.
- Apps you don't own: READ-ONLY. Never purchase/login/change settings unless the user explicitly allowed it for this session.
- Restore any intentionally modified fixture afterwards; stop the session.

## Command map (CLI; MCP tool names in docs/protocol.md)

| Situation                    | Command                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| First look at a screen       | `pnpm rn-observe observe`                                                                                               |
| Understand visible UI/errors | `pnpm rn-observe understand-screen` (MCP `understand_screen`); inspect state, headline, actions, issues and artifacts   |
| Element list for interaction | `pnpm rn-observe snapshot -i` then `tap --ref eN --settle 1500` (diff included)                                         |
| Lag / animation jank         | `pnpm rn-observe performance` then `trace start/stop` if deeper                                                         |
| API latency / loading        | `pnpm rn-observe network summary` (needs instrumentation) or `metro-network --duration 10000` (CDP, no instrumentation) |
| Rerender suspicion           | `pnpm rn-observe render-stats`                                                                                          |
| Console errors / exceptions  | `pnpm rn-observe logs --level error` or `devtools-export --duration 8000` while reproducing                             |
| Crash triage                 | logs + `devtools-export`, read `exceptions[]`                                                                           |
| Prove a fix worked           | `compare <before.png> <after.png> --before-ui b.json --after-ui a.json`                                                 |
| Repeatable regression check  | write a replay script JSON, `replay run script.json`                                                                    |
| Verify a11y labels           | `pnpm rn-observe a11y-audit`                                                                                            |

## Reading key metrics honestly

- `js_blocking_ms` — only available with instrumentation (`reportJsTask`), window 5 min, confidence 0.99.
- `ui_fps` is a windowed average: one 100ms JS block may not lower it — check `worst_frame_ms` + `dropped_frames` too. If gfxinfo has no new samples, frame metrics are unavailable instead of reused.
- `js_fps` is ALWAYS `available: false` (ADB has no trustworthy signal). Never invent one.
- `device-network` deltas are whole-device counters — never attribute them to the app.

## Typical conversation flow

User: "the cart screen feels laggy when I tap add"

1. `session start` (export RN_OBSERVER_SESSION_ID), then `observe` + `understand-screen`.
2. `tap --test-id add-to-cart` (use the app's real testID from `snapshot`), then `performance`.
3. `diagnose` → if finding says "Long JS task ~120ms", inspect the handler; if "Low UI frame rate" without JS evidence, suspect native list work.
4. Make the minimal fix, `reload --fast`, repeat step 2 exactly.
5. `understand-screen` + `compare` with baseline; report before/after state/findings, metric values and artifact paths.
6. `session stop`, then summarize: what was measured, what changed, what remains uncertain.

## Failure recovery

| Error                                             | Fix                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DEVICE_NOT_FOUND`                                | `adb devices -l`; accept USB prompt; unlock screen                                                                 |
| `MULTIPLE_DEVICES`                                | set `RN_OBSERVER_DEVICE_ID`                                                                                        |
| `APP_ID_NOT_FOUND`                                | set `RN_OBSERVER_APP_ID` or add `expo.android.package`                                                             |
| `UI_ELEMENT_NOT_FOUND`                            | element hidden/off-screen — `snapshot` again, check `visible`                                                      |
| `METRO_UNREACHABLE` / `DEVTOOLS_TARGET_NOT_FOUND` | start Metro for the app, `adb reverse`, relaunch app so it loads from Metro                                        |
| `DEVTOOLS_CONNECT_FAILED`                         | close React Native DevTools, retry                                                                                 |
| `CDP_LOCK_HELD`                                   | another observer command exceeded the 180s CDP queue timeout; retry after it finishes                              |
| `EVIDENCE_NOT_RECORDED` warning                   | start a session and export `RN_OBSERVER_SESSION_ID` before collecting evidence                                     |
| `loading-stuck` finding                           | correlate network/log evidence and the state transition that should dismiss loading; do not extend timeout blindly |
| adb back exited the app                           | RN single-activity: use the app's own back button testID, not `rn-observe back`, unless exiting is intended        |

## Full documentation

- Project overview: `PROJECT.md` in the repo
- All 38 CLI commands & 44 MCP tools: `docs/protocol.md`
- Detailed workflows: `docs/usage.md`; reference test battery: `docs/test-blueprint.md`
