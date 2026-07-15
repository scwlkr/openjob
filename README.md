# Openjob

A small public task board for teams. Add tasks with `@name — task`, optionally
assign a date, then check them off.

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. Use `npm test` before committing larger changes.

## v1 API contract

The complete v1 backend contract lives in `openapi/openapi.yaml`. Run
`npm run openapi:check` to validate the OpenAPI 3.1 document and its checked-in
examples. The current browser and `/api/tasks` remain the legacy rollback
surface while `/api/v1` is built.

## Where things live

- `app/page.tsx` — task-board interface and interactions
- `app/globals.css` — all styling
- `app/api/tasks/route.ts` — task API
- `db/tasks.ts` — task storage adapter
- `db/firestore-rest.ts` — authenticated Firestore REST client
- `db/firestore.ts` — legacy public-board Task storage adapter
- `db/users.ts` — isolated v1 User and Username persistence
- `server/firebase-id-token.ts` — Google-backed Firebase ID-token verification
- `server/v1-identity.ts` — `/api/v1/me` identity behavior and envelopes
- `firestore.rules` — browser access is denied; the Worker owns data access
- `openapi/openapi.yaml` — machine-readable `/api/v1` contract
- `tests/support/v1-harness.mjs` — isolated Worker HTTP acceptance seam

## Services

Cloudflare Workers hosts the app at `openjob.dev`. Firebase project
`openjob-dev` stores task records in Firestore. The Firebase service-account
credentials live only in Cloudflare Worker secrets.

Deploy Firestore rules and the site with:

```bash
npm run firebase:deploy:rules
npm run deploy
```
