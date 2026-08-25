# Maestro, Detox and Appium integration

RN Agent Observer is the evidence/assurance sidecar, while an E2E runner remains
responsible for driving the app and assertions. The shared interchange is JUnit
XML, so one privacy boundary works for Maestro, Detox/Jest, Appium and CI systems.

## One local evidence session

```powershell
$env:RN_OBSERVER_PROJECT_ROOT = (Get-Location).Path
$env:RN_OBSERVER_DEVICE_ID = 'emulator-5554'
$env:RN_OBSERVER_APP_ID = 'com.example.app'
$env:RN_OBSERVER_RUNNER_HASH_SECRET = '<same-masked-secret-for-baseline-and-current>'

$session = pnpm exec rn-observe session start | ConvertFrom-Json
$env:RN_OBSERVER_SESSION_ID = $session.id

# Run Maestro, Detox or an Appium test suite and write JUnit under this project.
# Example output path: test-results\mobile.xml

pnpm exec rn-observe runner import test-results\mobile.xml --runner maestro --strict
pnpm exec rn-observe suite run smoke --reporter json,html,junit,github --strict
pnpm exec rn-observe session stop $session.id
```

Choose `--runner detox`, `--runner appium`, or `--runner generic` to label the
producer. The importer validates XML, rejects DTD/entity declarations, limits the
input to 8 MiB and 20,000 cases, and only reads files physically contained by the
configured project root.

Outcome mapping is deterministic:

| JUnit evidence                                         | Observer outcome |
| ------------------------------------------------------ | ---------------- |
| At least one failure/error                             | `FAIL`           |
| Cases observed and at least one pass, no failure/error | `PASS`           |
| Empty, skipped-only, or normalization truncated        | `NOT_VERIFIED`   |

Raw failure messages are deliberately not imported. Keep the original runner
artifact under that runner's own access and retention policy; use Observer's case
hash to correlate the same test across evidence sessions.

## Compare a baseline with the current run

`runner import` returns the path of a normalized `runner-result` JSON artifact.
Import both runs, then compare those normalized artifacts rather than the raw XML:

```powershell
$baseline = pnpm exec rn-observe runner import test-results\baseline.xml --runner maestro | ConvertFrom-Json
$current = pnpm exec rn-observe runner import test-results\current.xml --runner maestro | ConvertFrom-Json

pnpm exec rn-observe runner compare $baseline.artifact.path $current.artifact.path --strict
```

The comparison writes a `runner-comparison` artifact and, when a session is
active, an `external_runner_comparison` timeline event. Its regression model is:

| Case transition                    | Classification       |
| ---------------------------------- | -------------------- |
| pass/skipped/missing -> fail/error | `newFailures`        |
| fail/error -> pass                 | `recovered`          |
| fail/error -> fail/error           | `persistentFailures` |
| case only in current               | `addedCases`         |
| baseline case missing from current | `removedCases`       |

Current failures always produce `FAIL`. A clean current run produces
`NOT_VERIFIED` instead of `PASS` when runner identities differ, either import is
truncated/unverified, a case hash is duplicated, or a baseline case disappeared.
This prevents test deletion or incomplete normalization from looking like a
recovery. `--strict` maps `NOT_VERIFIED` to exit 1; `FAIL` always exits 1.

Comparison output contains only aggregate deltas and stable case hashes.
It does not directly contain test names, file paths, raw XML, or failure bodies.
With `RN_OBSERVER_RUNNER_HASH_SECRET` set, identifiers use HMAC-SHA-256 and the
secret is never persisted. Without it, compatibility mode uses unkeyed SHA-256, so
predictable test identities can still be dictionary tested. Keep normalized
artifacts access-controlled and never print the secret. Treat duration deltas as
descriptive evidence unless both sides report duration and the same
runner/fixture/device policy was used.
