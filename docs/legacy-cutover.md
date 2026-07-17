# Legacy board cutover and rollback

Issue #20 uses two immutable Cloudflare Worker versions. The first keeps
`GET /api/tasks` readable while every legacy write returns `410`; the second
conceals the legacy contract with `404`. The top-level Firestore `tasks`
collection and the frozen Worker version stay unchanged until issue #21 passes.

## Freeze and snapshot

Deploy the commit whose legacy mode is `read-only`, then record the active
Worker version from `wrangler deployments status --json`.

```bash
npm run deploy
./node_modules/.bin/wrangler deployments status --json
npm run legacy:smoke -- read-only
npm run legacy:snapshot
```

The snapshot command first proves the hosted board is read-only, then uses the
current `gcloud` owner credential to read raw Firestore documents. It requires
exactly one active Worker version at 100% traffic and records that version as
the rollback target. The command writes a
new `0600` snapshot under the current macOS User's
`Library/Application Support/OpenJob/cutover/` directory by default. The file
records the raw documents, fresh Task count, SHA-256 digest, freeze commit, and
freeze Worker version. It refuses repository paths and stops cutover after
retaining the snapshot if the fresh Task count is not zero.

## Cut over

Only after the snapshot command reports Task count `0`, deploy the commit whose
legacy mode is `unavailable` and verify the hosted surface.

```bash
npm run deploy
./node_modules/.bin/wrangler deployments status --json
npm run legacy:smoke -- unavailable
```

Do not delete the legacy collection or frozen Worker version here. Final
version metadata, legacy deletion, and frozen-version retirement belong to
issue #21.

## Roll back

Read the exact freeze Worker version from the owner-only snapshot. Route all
traffic to that version, prove its read-only surface, and investigate. Never
roll back to a revision that accepts anonymous writes.

```bash
./node_modules/.bin/wrangler versions deploy <freeze-worker-version-id>@100% --yes
npm run legacy:smoke -- read-only
```

To finish a rollback drill without leaving production rolled back, route all
traffic to the recorded cutover version and prove the legacy contract is again
unavailable.

```bash
./node_modules/.bin/wrangler versions deploy <cutover-worker-version-id>@100% --yes
npm run legacy:smoke -- unavailable
```
