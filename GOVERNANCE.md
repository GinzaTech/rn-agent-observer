# Project governance

RN Agent Observer is developed in the open under Apache-2.0. Governance aims to
keep evidence contracts trustworthy, releases reproducible, and participation
accessible to long-term community contributors.

## Roles

- **Users** run the project and provide questions, bug reports, and feature needs.
- **Contributors** submit documentation, tests, fixtures, designs, code, or review.
- **Reviewers** are recurring contributors trusted to review an area and help triage
  issues. Review does not by itself grant merge or release access.
- **Maintainers** have repository write access and are responsible for merge,
  release, security, moderation, and compatibility decisions.

Roles are earned through sustained, constructive work rather than employment or
volume alone. Existing maintainers may nominate a reviewer or maintainer. Promotion
requires the nominee's consent, a public rationale, and no unresolved maintainer
objection. A maintainer who is inactive for six months may be moved to emeritus
status after private outreach; access can be restored when participation resumes.

## Decisions

Routine changes use pull-request review and lazy consensus. The author may not be
the sole approver of a material change. Maintainers may merge low-risk fixes after
tests and review are complete.

Open an RFC issue before changes that materially affect:

- public schemas, evidence meaning, or compatibility guarantees;
- collection privacy, active device actions, or security-test boundaries;
- provider/plugin interfaces or dependency direction;
- supported platforms or release policy;
- project governance or licensing.

An RFC should state the problem, goals and non-goals, proposed contract, privacy and
security impact, alternatives, migration, verification, and unresolved questions.
Maintainers seek consensus and allow meaningful review time. If consensus is not
possible, maintainers document the competing arguments and decide by simple
majority of non-conflicted active maintainers. A tie keeps the current behavior.

## Review and ownership

Review is based on affected expertise, not file ownership alone. Security-sensitive
and release changes require a maintainer review. A GitHub CODEOWNERS team should be
configured only when the organization has granted that team explicit repository
write access; the project will not publish a placeholder owner that GitHub cannot
enforce.

The current maintainer and the bus-factor limitation are public in
[MAINTAINERS.md](MAINTAINERS.md). `main` must require successful source, package,
coverage/security and Android smoke checks. Until a second active reviewer exists,
the repository may require a pull request with zero independent approvals rather
than publishing an impossible one-approval policy. Material changes still require
public review under this governance policy; automation cannot substitute for an
independent human reviewer.

Maintainers must recuse themselves from decisions involving a personal, financial,
or employment conflict that could reasonably affect judgment.

## Releases

The five public packages are versioned in lockstep:

- `@rn-agent-observer/schemas`
- `@rn-agent-observer/core`
- `@rn-agent-observer/rn-instrumentation`
- `@rn-agent-observer/cli`
- `@rn-agent-observer/mcp-server`

The repository root and demo app remain private. A maintainer prepares the version
and changelog, runs the documented release gate, creates a matching `v<version>`
tag, and publishes through the protected npm release workflow. Release claims must
distinguish unit/static verification from device runtime evidence. A failed or
partial check is never silently promoted to `PASS`.

## Security and conduct

Security reports follow [SECURITY.md](SECURITY.md) and are handled privately until
coordinated disclosure. Community behavior follows
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Maintainers may take immediate protective
action when credentials, personal data, active exploitation, or participant safety
is at risk.

## Changing governance

Governance changes require an RFC and approval from a majority of active,
non-conflicted maintainers. The pull request must describe the practical effect on
contributors and preserve the repository history of the prior policy.
