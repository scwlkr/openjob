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

## Final retirement

Run this only after issue #21's two-User web/CLI acceptance and complete local
verification pass. The command revalidates the snapshot digest and zero count,
proves the legacy route remains unavailable, fetches a fresh owner-authenticated
zero count, and refuses to retire a Worker that is active. The snapshot's exact
SHA-256 is the destructive confirmation.

Cloudflare's per-version API requires the account ID and a token with Workers
write permission. Keep the token in the process environment only.

```bash
CLOUDFLARE_ACCOUNT_ID=<account-id> \
CLOUDFLARE_API_TOKEN=<token> \
npm run legacy:retire -- \
  --snapshot '<owner-only-snapshot-path>' \
  --confirm <snapshot-sha256>
```

When the recorded and fresh Task counts are both zero, the Firestore collection
is already absent: Firestore has no standalone empty collection resource. The
only deletion performed is the exact frozen Worker version recorded by the
snapshot. Keep the owner-only snapshot as immutable release evidence after
retirement.
