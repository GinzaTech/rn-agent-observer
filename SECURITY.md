# Security policy

RN Agent Observer handles device state, logs, screenshots, traces, and optional
development telemetry. Treat all collected evidence as potentially sensitive.

## Supported versions

Security fixes are made for the latest published release. Fixes normally land on
`main` first and are included in the next release. Older releases are unsupported
unless a repository security advisory says otherwise.

| Release line             | Security support                         |
| ------------------------ | ---------------------------------------- |
| Latest published release | Supported                                |
| `main`                   | Development branch; no stability promise |
| Older published releases | Unsupported by default                   |

## Report a vulnerability privately

Use GitHub's
[private vulnerability reporting](https://github.com/GinzaTech/rn-agent-observer/security/advisories/new).
If private reporting is unavailable, contact a repository maintainer privately
through the [GinzaTech organization profile](https://github.com/GinzaTech) and ask
for a secure channel. Do not open a public issue for an undisclosed vulnerability.

Include:

- affected package and version or commit;
- impact and realistic attack preconditions;
- minimal reproduction steps or a proof of concept using fake data;
- affected operating system, Node.js, Android, React Native, and Expo versions;
- suggested remediation, if known;
- whether you intend coordinated public disclosure.

Do not send real credentials, personal data, production network bodies, whole
SQLite stores, or unredacted screenshots/logs. Share only the minimum redacted
evidence needed to reproduce the issue. Maintainers will acknowledge a report as
soon as practical, validate scope, coordinate a fix and release, and credit the
reporter when requested and safe.

## In scope

- Secret or personal-data exposure caused by observer collection, persistence,
  redaction, reports, package contents, or logs.
- Unauthorized device actions or unsafe command/path handling in official packages.
- Artifact integrity, retention, access, or cross-project isolation failures.
- Vulnerable release artifacts, package takeover risk, or repository supply-chain
  compromise.
- Instrumentation behavior that escapes its documented development-only boundary.

Vulnerabilities in a third-party application being observed are not vulnerabilities
in RN Agent Observer. Report them to that application's owner. Do not test apps,
accounts, devices, or services without explicit authorization.

## Safe handling and disclosure

- Reproduce with a local fixture and fake data whenever possible.
- Do not use observer tooling to purchase, authenticate, modify an account, or run
  active security tests outside the authorization you received.
- Give maintainers a reasonable opportunity to release a fix before disclosure.
- Published npm packages are expected to carry npm provenance; release attachments
  should include checksums when the project distributes portable archives.

This project does not currently operate a bug bounty and cannot promise payment or
legal safe harbor. We nevertheless value good-faith, authorized, non-destructive
research and will work toward coordinated remediation.
