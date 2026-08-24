## Problem and scope

Describe the user-facing problem, the intended outcome, and explicit non-goals.

## Evidence

- Source/static checks:
- Runtime fixture, device ID, OS/API and scenario, if applicable:
- Before/after artifact paths or metrics, if applicable:
- Remaining `NOT_VERIFIED` boundaries:

## Risk review

- [ ] Public schemas, CLI, MCP or provider contracts are unchanged, or migration is documented.
- [ ] No secret, personal data, runtime artifact, APK, database or live active-policy file is included.
- [ ] Active actions remain exact-app, exact-device and explicit-risk allowlisted.
- [ ] New evidence includes source, timestamp, unit/availability/sample count where relevant.
- [ ] User-facing behavior and `CHANGELOG.md` are updated.

## Verification

- [ ] `pnpm check`
- [ ] `pnpm coverage:check`
- [ ] Relevant focused tests were added or updated
- [ ] `pnpm release:check` when package/release behavior changed
- [ ] Android runtime was verified, or the limitation is explicitly `NOT_VERIFIED`
- [ ] The change follows `CONTRIBUTING.md`, `SECURITY.md`, and the Code of Conduct
