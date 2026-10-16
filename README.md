# OpenJob

## Overnight workspace prototype

Run `npm run dev:workspace` in the configured cloud checkout to open the
fixture-backed Mail, Calendar, Tasks and Agents app. Application actions and
saved state are real; provider connections and delivery are visibly simulated.
See [the walkthrough](docs/WORKSPACE_DEMO.md) for the running app and shared CLI.
No live mailbox or external calendar is connected by this prototype.


One clear shared Task List for small working Groups. The hosted web and CLI use
the same authenticated `/api/v1` Group, governance, and Task contracts.

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Use `npm test` before committing larger changes.

The coequal Expo iOS/Android shell and its simulator, build, OTA-disabled, and
embedded-bundle commands are documented in [`native/README.md`](native/README.md).

## Installable CLI

The real `openjob` executable lives under `cli/`; the no-network command in
`prototypes/cli/` remains disposable. Requires macOS and Node.js 22.13 or newer.
Install OpenJob v0.3.7 from GitHub with one command:

```bash
npm install --global https://github.com/scwlkr/openjob/releases/download/v0.3.7/openjob-0.3.7.tgz
```

Run `openjob auth login`, then `openjob --help`. The production command surface
covers authentication, User and Username identity, the complete Group and Task
lifecycle, Member governance, bans, and Invite Links against
`https://openjob.dev/api/v1`. The CLI stores only its Firebase refresh
credential in the macOS credential store; local config stores only the current
Group ID. It has no local Task database or offline mode.

Maintainers can use the separately bound `preview-owner` profile as the
Google-backed `@scwlkr` owner in the ordinary two-User QA fixture. It has
isolated API, Firebase, OAuth, Keychain, and config boundaries and requires the
recorded stable Preview User ID from the `OpenJob Preview Owner Binding`
1Password item; see [`cli/README.md`](cli/README.md). Runtime endpoint
overrides are test-only.

For repository development, run `npm install`, `npm link`, and
`openjob --help`. Maintainers can run the packaged CLI's hosted Task workflow with:

```bash
OPENJOB_CLI_SMOKE_USE_KEYCHAIN=1 npm run cli:smoke:production
```

Automation may instead provide a short-lived Firebase ID token through
`OPENJOB_CLI_SMOKE_TOKEN`; the token stays in the smoke process and is not
passed to the installed executable.

Run `npm run cli:types` after changing `openapi/openapi.yaml`, and use
`npm run cli:types:check` to verify the checked-in request/response types.

## Releases

Use the [impact-aware verification modes](docs/verification.md) for focused
Feature Proof, merge proof, and release-candidate gate selection. The verifier
does not build, upload, submit, or promote native Candidate Artifacts.

The [durable candidate coordinator](docs/release-candidates.md) freezes one
verified source identity, records independent iOS and Android progress, and
previews every external build, submission, evidence, or coequal promotion step
before exact confirmation. Its record is the handoff consumed by #41.

The root package version is authoritative for the web app, hosted API contract,
CLI package, Git tag, and GitHub release. Curate `CHANGELOG.md`, then prepare and
publish a release from a clean, synchronized `main`:

```bash
npm run release:prepare -- minor
git push origin main
npm run release:publish
```

Preparation accepts `patch`, `minor`, `major`, or an explicit greater SemVer
such as `0.3.7-rc.1`. Publishing creates a draft with a versioned CLI artifact and checksum
before any stable production deploy, runs production API and installed-CLI
smokes, then publishes the release. A failed publish keeps its draft resumable.
`npm run deploy` is guarded; release internals alone use `deploy:raw`.

## v1 API contract

The complete v1 backend contract lives in `openapi/openapi.yaml`. Run
`npm run openapi:check` to validate the OpenAPI 3.1 document and its checked-in
examples. The browser and CLI use only `/api/v1`. Issue #20 preserves one
read-only legacy Worker revision and an owner-only Firestore snapshot for
rollback; [the cutover runbook](docs/legacy-cutover.md) defines its gates.

## Where things live

- `docs/brand/index.html` — offline brand guide for the overhaul, with editable SVG masters and scoped theme tokens
- `app/page.tsx` — authenticated web entry
- `app/globals.css` — global reset, typography, and legacy public-board styling
- `app/openjob.module.css` — authenticated OpenJob screens and Task List styling
- `server/legacy-board.ts` — frozen revision's read-only legacy contract
- `db/tasks.ts` — task storage adapter
- `db/firestore-rest.ts` — authenticated Firestore REST client
- `db/firestore.ts` — legacy public-board Task storage adapter
- `db/users.ts` — isolated v1 User and Username persistence
- `server/firebase-id-token.ts` — Google-backed Firebase ID-token verification
- `server/v1-identity.ts` — `/api/v1/me` identity behavior and envelopes
- `firestore.rules` — browser access is denied; the Worker owns data access
- `openapi/openapi.yaml` — machine-readable `/api/v1` contract
- `tests/support/v1-harness.mjs` — isolated Worker HTTP acceptance seam
- `scripts/legacy-cutover.mjs` — freeze smoke, private snapshot, and zero-count gate

## Services

Cloudflare Workers hosts the app at `openjob.dev`. Firebase project
`openjob-dev` stores task records in Firestore. The Firebase service-account
credentials live only in Cloudflare Worker secrets.

Deploy Firestore rules separately when their contract changes:

```bash
npm run firebase:deploy:rules
```

Production site deploys happen through `npm run release:publish`.

### Planned Task intervals

The API accepts `scheduledSlot: { "start": "2026-10-15T13:00:00Z", "end": "2026-10-15T14:00:00Z" }` on Task creation or editing. Both timestamps need explicit time zones and up to millisecond precision; the response uses UTC. End must follow start. Omit the field to preserve it when editing; send `null` to clear it. Unscheduled Task responses omit it. The due date and list ordering remain independent.

```sh
openjob task edit <task-id> --schedule-start 2026-10-15T13:00:00Z --schedule-end 2026-10-15T14:00:00Z
openjob task edit <task-id> --clear-schedule
```

The web Task editor also provides planned start/end controls in explicit UTC and an independent clear action. Task cards show the stored interval in UTC. This stores a planned interval in OpenJob; external calendar sync and native scheduling controls remain future work.
