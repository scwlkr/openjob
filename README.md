# OpenJob

One clear shared Task List for small working Groups. The hosted web and CLI use
the same authenticated `/api/v1` Group, governance, and Task contracts.

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Use `npm test` before committing larger changes.

## Installable CLI

The real `openjob` executable lives under `cli/`; the no-network command in
`prototypes/cli/` remains disposable. Requires macOS and Node.js 22.13 or newer.
Install the current v0.1.0 release candidate from GitHub with one command:

```bash
npm install --global https://github.com/scwlkr/openjob/releases/download/cli-v0.1.0-rc.2/openjob-0.1.0-rc.2.tgz
```

Run `openjob auth login`, then `openjob --help`. The production command surface
covers authentication, User and Username identity, the complete Group and Task
lifecycle, Member governance, bans, and Invite Links against
`https://openjob.dev/api/v1`. The CLI stores only its Firebase refresh
credential in the macOS credential store; local config stores only the current
Group ID. It has no local Task database or offline mode.

For repository development, run `npm install`, `npm link`, and
`openjob --help`. Maintainers build the release artifact with `npm run cli:pack`
and run its hosted Task workflow with:

```bash
OPENJOB_CLI_SMOKE_USE_KEYCHAIN=1 npm run cli:smoke:production
```

Automation may instead provide a short-lived Firebase ID token through
`OPENJOB_CLI_SMOKE_TOKEN`; the token stays in the smoke process and is not
passed to the installed executable.

Run `npm run cli:types` after changing `openapi/openapi.yaml`, and use
`npm run cli:types:check` to verify the checked-in request/response types.

## v1 API contract

The complete v1 backend contract lives in `openapi/openapi.yaml`. Run
`npm run openapi:check` to validate the OpenAPI 3.1 document and its checked-in
examples. The browser and CLI use only `/api/v1`. Issue #20 preserves one
read-only legacy Worker revision and an owner-only Firestore snapshot for
rollback; [the cutover runbook](docs/legacy-cutover.md) defines its gates.

## Where things live

- `app/page.tsx` — authenticated web entry
- `app/globals.css` — all styling
- `app/api/tasks/route.ts` — frozen or unavailable legacy Task contract
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

Deploy Firestore rules and the site with:

```bash
npm run firebase:deploy:rules
npm run deploy
```
