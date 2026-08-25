# GitHub Action evidence gate

The repository root exposes a composite action that runs the same Observer core as
the npm CLI, creates one evidence session, writes JSON/HTML/JUnit/SARIF/GitHub
reports, uploads them, and fails closed when a suite is `FAIL` or `NOT_VERIFIED`.
It does not provision an emulator or install the target app: the calling workflow
owns those steps so the exact device/app boundary remains explicit.

```yaml
name: Android evidence

on:
  pull_request:

jobs:
  observer:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      # Build/install/launch your owned fixture and wait for ADB here.

      - uses: GinzaTech/rn-agent-observer@main # use an exact release tag in protected CI
        with:
          project-root: .
          suite: smoke,accessibility,security
          device-id: emulator-5554
          app-id: com.example.app
```

Use an exact release tag for protected branches. `observer-version` selects the
npm CLI and defaults to the action's matching `2.5.0` release; bump both together
instead of following a moving dist-tag. Repository self-tests use `cli-entrypoint` after building
source so CI proves the exact commit rather than accidentally testing an older npm
release. Consumers normally leave `cli-entrypoint` empty; the action installs the
selected CLI once in an isolated runner-temp project rather than relying on a
possibly stale `pnpm dlx` native-module cache.

## Import an external E2E result

Maestro, Detox/Jest and Appium test runners can produce JUnit XML. Keep that report
inside `project-root` and pass it to the action:

`junit-report`/`runner import` are available from npm `2.5.0`. Set the same masked
`RN_OBSERVER_RUNNER_HASH_SECRET` for baseline and current jobs when normalized
artifacts may leave a trusted runner boundary.

```yaml
- uses: GinzaTech/rn-agent-observer@main # use an exact release tag in protected CI
  with:
    suite: smoke
    junit-report: test-results/maestro.xml
    external-runner: maestro
    # Optional artifact downloaded from a trusted baseline workflow:
    runner-baseline-result: baselines/maestro-runner-result.json
```

Observer does not copy the raw XML, failure bodies, file paths, class names or test
names into its database. It stores aggregate counts, durations, the source SHA-256,
and stable HMAC-SHA-256 case identifiers when the secret is configured. When
`runner-baseline-result` is present, the
action compares it with the newly imported report and fails on regression or
incomplete comparison evidence. Without the secret, compatibility mode uses
unkeyed SHA-256 and predictable identities can still be dictionary tested, so keep
normalized artifacts under the same access and retention policy as other CI evidence.

`allow-not-verified: true` is intended only for exploratory jobs with an owner who
reviews limitations. Required checks should keep the default `false`.

## Action inputs and outputs

| Input                    | Default                 | Meaning                                                |
| ------------------------ | ----------------------- | ------------------------------------------------------ |
| `suite`                  | `smoke`                 | Comma-separated built-in names or project suite files  |
| `observer-version`       | `2.5.0`                 | npm CLI version; pin with the action release           |
| `cli-entrypoint`         | empty                   | Optional built source CLI for repository self-test     |
| `device-id`              | empty                   | Exact ADB serial; required when selection is ambiguous |
| `app-id`                 | inferred                | Android package override                               |
| `output-directory`       | `.artifacts/ci-reports` | Privacy-reduced suite reports                          |
| `allow-not-verified`     | `false`                 | Whether missing evidence may keep the job green        |
| `junit-report`           | empty                   | Optional external runner JUnit report                  |
| `external-runner`        | `generic`               | `maestro`, `detox`, `appium`, or `generic`             |
| `runner-baseline-result` | empty                   | Normalized baseline artifact; requires `junit-report`  |

The action outputs `session-id`, `outcome-code`, and `report-directory`. Uploaded
artifacts are retained for 14 days by default; the calling repository should set a
shorter organization retention policy when its reports are sensitive.
