# RN Agent Observer roadmap

This roadmap separates work that can be proven in the repository from platform or
community claims that require independent runtime evidence. Dates are targets, not
support promises. An item is complete only when its acceptance evidence is linked
from `docs/testing.md`.

## Current baseline — 2.5.1

- Five public npm packages install from a clean consumer and carry registry
  integrity plus npm provenance.
- Android is the only built-in runtime provider. One physical Xiaomi Android 15
  fixture, local API 24/30/36 emulators, and the API 30 CI emulator are exact
  verified fixtures, not an OEM or device-farm compatibility claim.
- Windows, Ubuntu and macOS run the source quality gate. macOS is host-only.
- Instrumented React Native/Expo development builds provide the deepest route,
  render, JS-task and app-network evidence. Uninstrumented apps have narrower
  ADB/Metro evidence and must report unavailable fields honestly.

## Milestone A — release and governance reliability

- [x] Trusted npm publishing with provenance and clean-consumer verification.
- [x] Coverage thresholds, deterministic parser fuzz regression, CodeQL,
      dependency review, OSV audit, Dependabot and Node 24 compatibility CI.
- [x] Structured issue/RFC forms, PR evidence checklist, CODEOWNERS and documented
      maintainer promotion path.
- [ ] Add a second active reviewer before enforcing one independent approval.
- [ ] Exercise account/repository recovery with two hardware-backed identities.

Acceptance: protected `main`, successful required checks, protected npm environment,
no known high-severity locked dependency, and two independent maintainers for a
full bus-factor claim.

## Milestone B — maintained Android matrix

- [ ] Add Pixel/AOSP and Samsung physical fixtures for maintained API tiers.
- [ ] Add a low-memory device or Android Go fixture.
- [ ] Run the same owned-demo smoke on arm64 and x86_64.
- [ ] Publish a rolling compatibility report without retaining device identifiers
      or sensitive artifacts.
- [ ] Add opt-in device-farm provider documentation and a community conformance
      fixture; do not send application data to a cloud service by default.

Acceptance: at least two OEMs for each declared physical tier, exact build/app/API
metadata, repeated scenario evidence, retention policy, and no wildcard PASS.

## Milestone C — deeper performance and UI evidence

- [ ] Convert Perfetto traces into bounded app-process CPU/scheduling summaries.
- [ ] Add an instrumented time-to-interactive marker distinct from `am start -W`.
- [ ] Add opt-in JS/native heap adapters; process PSS remains a coarse signal.
- [ ] Negotiate supported CDP protocol domains instead of assuming Network or
      Profiler availability.
- [ ] Add instrumentation-backed contrast inputs, focus order and screen-reader
      scenario contracts. UIAutomator alone cannot prove these properties.

Acceptance: every metric retains value, unit, source, timestamp, availability,
confidence/sample count and known limitations.

## Milestone D — community target providers

- [ ] Stabilize provider conformance fixtures and compatibility policy.
- [ ] Build an iOS provider on a macOS runner with owned simulator evidence.
- [ ] Build web and Windows target providers with platform-native fixtures.
- [ ] Publish provider templates only after process isolation, redaction, timeout,
      cancellation and target-fingerprint tests pass.

An external-provider manifest or a unit test is `EXTENSION_ONLY`; it never proves
runtime support. Platform status changes only after exact runtime evidence exists.

## Milestone E — runner and CI interoperability

- [x] Add offline `suite init` and `suite validate` authoring commands with safe,
      non-overwriting project paths.
- [x] Normalize bounded JUnit from Maestro, Detox, Appium, or generic runners into
      privacy-reduced aggregate/case-hash evidence inside an Observer session.
- [x] Compare normalized runner artifacts by case hash, distinguish new/recovered/
      persistent failures, and fail closed when comparison completeness differs.
- [x] Add a reusable composite GitHub Action with strict outcome enforcement,
      report upload, job summary, and optional external-runner import.
- [ ] Validate the action from an independent consumer repository after the next
      npm release and pin that consumer workflow to the exact release tag.
- [ ] Add native runner plugins only when they provide evidence beyond the shared
      JUnit contract; avoid duplicating their automation engines.

Acceptance: action source passes repository checks, an independent consumer run is
linked from `docs/testing.md`, raw external reports remain under the runner's own
retention policy, and missing/truncated evidence never becomes PASS.

## Good first contributions

- Improve English examples and troubleshooting without changing evidence meaning.
- Add fake-output ADB parser fixtures for another Android/OEM format.
- Add a dashboard accessibility test with deterministic fake data.
- Add provider conformance failure fixtures.
- Reproduce an existing `NOT_VERIFIED` scenario on an owned device and submit only
  redacted metadata plus hashes.

Use the feature or RFC issue form before broad work. Security reports belong in a
private advisory, never in a roadmap issue.
