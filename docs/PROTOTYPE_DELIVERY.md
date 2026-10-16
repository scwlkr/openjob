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
No command sends actual correspondence. Explicit simulated delivery only creates local fixture Sent records; it has a separate capability and cannot enable real sending. Fixture identity selectors are not
production authentication, and fixture connections are never labeled live.

## Checks for this phase

Latest owner instruction (16 October 5:43 p.m. Central/22:43 UTC) supersedes the
former exhaustive per-change gate for this solo prototype. Use cheap affected
compile/type and primary-flow checks plus relevant account isolation, scoped-agent
revocation, no-accidental-send and secret checks. Keep external repository protections.
Full suites, backup/failover drills, enterprise hardening and fixture migration do
not block disposable owner-pilot progress. Record failures/not-run checks honestly.
Native releases still require their applicable artifact/device/privacy evidence;
source-only changes do not prove native runtime or live providers.

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
