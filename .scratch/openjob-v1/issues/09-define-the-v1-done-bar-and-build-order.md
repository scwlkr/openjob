---
id: openjob-v1-09
title: Define the v1 Done Bar and Build Order
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:grilling
claimed: true
blocked_by:
  - openjob-v1-06
  - openjob-v1-07
  - openjob-v1-08
---

## Question

What is the smallest implementation order and proof plan that makes the Group-based web and CLI product complete enough for real company use?

## Answer

Build the complete hosted backend first as `v0.0.5`. Build the production web and command-line clients only after that backend gate passes, then release both clients together as `v0.1.0`.

### v0.0.5 — complete Firebase backend

1. Check in the OpenAPI 3.1 contract for the complete `/api/v1` surface, including representations, errors, authorization, privacy, pagination, and every settled operation. Treat it as the backend build checklist.
2. Add Google-only Firebase Authentication verification and the User and immutable Username model.
3. Add isolated Group-scoped Firestore storage and the complete Group, membership, Admin, ban, Invite Link, and Task behavior. No v1 code may use the legacy top-level `tasks` collection.
4. Expose every operation through `/api/v1`. Domain validation and authorization stay in the service; no behavior is deferred to a future client.
5. Prove the backend against a clean test database with at least two test identities. Cover success paths plus unauthenticated access, concealed Groups, Member/Admin boundaries, final-Admin protection, Invite Link expiry/rotation/exhaustion, bans and Unassigned Tasks, Task validation/state/order/filtering, idempotent transitions, pagination, and atomic membership changes.
6. Pass OpenAPI validation, automated tests, lint, typecheck, and the production build. Deploy the authenticated API without cutting over the legacy browser UI, then smoke-test token rejection, authenticated access, cross-User authorization, and Firestore persistence.

`v0.0.5` is done only when the whole backend contract exists and passes. It contains no production web rewrite and no production CLI. The current board remains the rollback surface until the later cutover.

### v0.1.0 — complete web and command clients

1. Replace the browser experience with the selected Group rail and assignee-lane design, backed only by `/api/v1`. Include Google sign-in, Username onboarding, Group selection, all Task operations, ordinary filters, Invite Link joining, and every Admin operation on desktop and narrow screens.
2. Build the approved resource-first CLI as a production client of the same API. Generate its API types from OpenAPI, use the settled browser authentication handoff and operating-system credential store, and preserve the approved stdin, file, stdout, stderr, confirmation, format, and exit-status contracts. The throwaway simulator is not production code.
3. Package the CLI as an installable artifact. A clean Mac must produce a working `openjob` command on `PATH` from one documented install command. A public package-registry release is not required for v1.
4. Run the settled legacy-board freeze, zero-record snapshot, and rollback preflight. Cut over the authenticated web and `/api/v1` together, and make the public legacy `/api/tasks` contract unavailable.
5. Run a production acceptance scenario with two real Google Users and a disposable Group. Across web and CLI, prove sign-in, Username claim, Group creation and rename, Invite Link join and rotation, Task create/edit/reassign/complete/reopen/delete, filters and stable ordering, promotion/demotion guards, kick, ban, unban, removal-induced Unassigned recovery, leave guards, and confirmed Group ending. A mutation in either client must appear correctly in the other.
6. Prove the selected web design on desktop and narrow screens, prove CLI install and browser-backed login on the clean Mac, rerun all automated checks, and verify the frozen legacy data remained unchanged. After acceptance passes, delete the legacy collection and retire the frozen revision.

`v0.1.0` is done only when both clients expose the complete product, the two-User production acceptance passes, rollback has been proven, and no public legacy task path remains. Self-hosting packaging, public CLI distribution, notifications, recurrence, integrations, richer Tasks, and evidence-driven operational expansion remain beyond this release.
