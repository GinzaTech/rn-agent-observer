# Contributing to RN Agent Observer

Thank you for helping make React Native runtime evidence more useful and more
trustworthy. Contributions of code, tests, documentation, reproducible fixtures,
and design feedback are welcome.

New contributors should first read the [installation guide](docs/installation.md)
and [repository structure](docs/project-structure.md). They separate source,
generated output, local device policy, and sensitive runtime evidence.

By submitting a contribution, you agree that it is licensed under the repository's
[Apache License 2.0](LICENSE).

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use a feature request or an RFC issue before investing in a broad protocol,
  architecture, security, or compatibility change.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md). Do not
  include credentials, personal data, unredacted artifacts, or exploit details in
  a public issue.
- Keep the observer honest: unavailable evidence must remain unavailable, and a
  heuristic finding must not be presented as a proven root cause.

## Development setup

Requirements:

- Node.js 22.12 or newer
- pnpm 9.6.0 through Corepack
- `adb` for Android runtime work
- An Android emulator or development device for device-facing verification

```sh
corepack enable
corepack prepare pnpm@9.6.0 --activate
pnpm install --frozen-lockfile
pnpm check
```

Use pnpm only. Do not add npm, Yarn, or Bun lockfiles. The workspace dependency
direction is `schemas <- core <- cli/mcp-server`; application instrumentation is
kept independent of the Node runtime packages.

Do not remove or bypass `.pnpmfile.cjs`: it contains reviewed transitive security
pins and its checksum is part of the frozen lockfile. Intentional dependency changes
must regenerate the lockfile with pnpm 9.6.0, pass frozen install again, and run the
strict dependency audit described in [security testing](docs/security-testing.md).

## Make a focused change

- Follow strict TypeScript, ESLint, and Prettier settings already in the repository.
- Put device/runtime behavior in `packages/core`; CLI and MCP should remain thin
  adapters over the same behavior.
- Add or update schemas before exposing a new public contract.
- Preserve development-only boundaries for `rn-instrumentation`.
- Do not optimize away intentional demo regressions. `PerformanceLab` blocks the JS
  thread for 100 ms on purpose, and `NetworkLab` uses deterministic local failures.
- Update user documentation and protocol documentation with public behavior.

## Verification

Run the full source gate after every change:

```sh
pnpm check
```

For public-package or release changes, also run:

```sh
pnpm release:check
```

For demo changes, verify that the Android JavaScript bundle can be exported to a
temporary directory:

```sh
pnpm --filter @rn-agent-observer/demo-expo exec expo export \
  --platform android \
  --output-dir <temporary-directory>
```

An Expo export proves that the bundle can be produced; it does not prove Android
runtime behavior. Device-facing changes must follow the evidence workflow in
[AGENTS.md](AGENTS.md): capture before state, reproduce, make the smallest fix,
reload or rebuild, reproduce again, compare evidence, and stop the session. Report
the device/emulator, Android version, scenario, before/after measurements, artifact
paths, and every limitation or `NOT VERIFIED` case.

## Tests and documentation

- Unit tests should be deterministic, offline, and explicit about unavailable data.
- Prefer a narrow package test while iterating, then run the full gate:

  ```sh
  pnpm --filter @rn-agent-observer/core test
  pnpm --filter @rn-agent-observer/core test -- <file-or-pattern>
  pnpm check
  ```

- Never commit `.artifacts`, device recordings, SQLite stores, credentials, APKs,
  generated `dist` output, live `.rn-observer.json` policy, or `.rnobs` bundles.
- Commit only reviewed `.example.json` config with fake app/device IDs. Root
  `.gitignore` is a safety net, not a substitute for checking staged files.
- Examples must use fake application IDs, tokens, accounts, and endpoints.
- Keep claims scoped to the evidence actually collected. Use `NOT APPLICABLE`,
  `NOT VERIFIED`, or a documented limitation where appropriate.

## Pull requests

A reviewable pull request should:

- explain the user problem and why the proposed behavior belongs in this project;
- stay focused and avoid unrelated formatting or generated-file churn;
- include tests or explain why a test is not applicable;
- describe public contract, privacy, security, and compatibility impact;
- include the commands that passed and any device evidence that was collected;
- update the changelog for user-visible behavior when requested by a maintainer.

All public packages use one lockstep version. Do not change package versions or
publish packages from a contribution branch unless a maintainer has requested a
release preparation change.

Review and merge decisions follow [GOVERNANCE.md](GOVERNANCE.md). Community
participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
