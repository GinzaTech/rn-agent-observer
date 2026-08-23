## Problem and outcome

<!-- What user problem does this solve, and what is now observably different? -->

## Public contract and risk

<!-- Describe schema/API/CLI/MCP changes, compatibility, privacy, security, and device-state impact. Write "none" where applicable. -->

## Verification

<!-- List exact commands and results. Separate unit/static checks from Android runtime evidence. -->

- [ ] `pnpm check`
- [ ] Relevant focused tests were added or updated
- [ ] `pnpm release:check` (required for public-package/release changes)
- [ ] Android export was run for demo changes
- [ ] Device/emulator scenario was rerun for device-facing changes
- [ ] Before/after metrics and artifact paths are included when behavior or UI changed
- [ ] Missing coverage is explicitly marked `NOT VERIFIED` or not applicable

## Documentation and safety

- [ ] User-facing behavior and protocol documentation are updated
- [ ] No secrets, personal data, production payloads, APKs, or unreviewed artifacts are included
- [ ] New evidence includes a source, timestamp, unit where relevant, and honest availability state
- [ ] Active or mutating actions have explicit authorization and safe defaults
- [ ] The change follows `CONTRIBUTING.md`, `SECURITY.md`, and the Code of Conduct
