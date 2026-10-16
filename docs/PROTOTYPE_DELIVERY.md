# Overnight prototype delivery

The owner changed delivery priorities on 16 October 2026: demonstrate the full
Mail, Calendar, Tasks and agent workspace by morning Central (working target
7 AM). Rough edges are acceptable; production readiness and live integrations
are separate work. Linear WLK-278 owns execution, rather than a second backlog.

The acceptance flow is: choose a simulated provider account, read a message,
create a personal Task from it, schedule that Task in a Calendar, complete it,
and save a reply draft under the correct sending account. A second owner must
not see or mutate the first owner's data. An explicitly scoped simulated agent
can act within its resources; denied actions and revocation are observable.
Application actions mutate persisted demo state through shared APIs and CLI.
No command sends actual correspondence. Fixture identity selectors are not
production authentication, and fixture connections are never labeled live.

## Checks for this phase

`npm test` retains builds, TypeScript, API contracts, native quick checks,
deterministic domain/CLI tests, functional browser checks and secret checks.
Failures remain failures. External branch protections are not bypassed.
Functional checks must cover account isolation, agent scopes/revocation and
send denial, plus the cross-module workflow. Native quick checks do not prove
native launch, devices or store readiness; ADR0017 still governs releases.

Historical Variant B pixel comparisons are obsolete for this overhaul. Their
renderer was undocumented and the default browser artifact was unavailable.
The old mismatch is recorded as a failed historical comparison, not a pass.
The replacement browser test checks responsive overflow, visible content,
working Task editing, light/dark brand asset selection, fonts and action
contrast. It captures current images for human inspection without comparing
them to the historical pixels. The approved brand tokens/assets remain the
design authority. Browser binary metadata remains in diagnostic attachments;
matching the historical pin is no longer a delivery prerequisite for these
functional checks. A supplied system Chromium can run this lane.

PR53/54 source is integrated into WLK-278. Close or merge those PRs only after
the integrated functional gate passes and non-deploying integration is verified.
No release/deploy command, credential creation, security setting change, live
correspondence, spending or destructive live data action is authorized.
