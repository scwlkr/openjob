# Global Board Data Migration

## Decision

Start the Group-based product with no migrated Tasks. The live legacy board contained zero records when checked on 2026-07-15 at 17:12 UTC, so a migration program would add risk without preserving any user data.

The legacy top-level `tasks` collection remains intact only as a short-lived rollback surface during cutover. It is not part of the v1 model and must be deleted after the v1 acceptance proof passes.

## Current-state evidence

- `GET https://openjob.dev/api/tasks` returned `200`, `cache-control: no-store`, and `{"tasks":[]}`: zero live records.
- [`db/firestore.ts`](../../../db/firestore.ts) reads and writes one top-level `tasks` collection with `id`, free-form `assignee`, `description`, optional `dueDate`, `completed`, `createdAt`, and `updatedAt`.
- [`app/api/tasks/route.ts`](../../../app/api/tasks/route.ts) exposes that collection without authentication through `GET`, `POST`, and `PATCH`.
- [`firestore.rules`](../../../firestore.rules) denies direct browser reads and writes; the Cloudflare Worker reaches Firestore with its service account.
- The active Cloudflare deployment was created on 2026-07-13 and still serves this legacy contract.

## Why rows must not be transformed automatically

Even if a Task appears before cutover, the service cannot map it safely into the settled v1 model:

- It has no Group ID, so choosing a destination Group would invent ownership.
- Its assignee is an unverified string rather than a current Member's User ID and immutable Username.
- A done row has no reliable completion time. `updatedAt` may reflect any toggle and cannot reconstruct the v1 completion contract.
- The public endpoint supplies no actor or provenance with which to distinguish company work from anonymous input.

Late rows therefore block the empty-start preflight. They are preserved for review, never silently imported. A legitimate Task may be recreated through the authenticated v1 API after its assignee is a Member.

## Cutover contract

1. Build the v1 API and clients against new Group-scoped storage. No v1 code may read or write the legacy top-level `tasks` collection.
2. Deploy a temporary freeze revision that keeps the legacy board readable but makes `POST /api/tasks` and `PATCH /api/tasks` reject all writes. Rollback must target this frozen revision, not the earlier public-write revision.
3. After the freeze is live, capture the raw `GET /api/tasks` response outside the repository with owner-only permissions. Record its Task count and SHA-256 digest in the private deployment log.
4. Require a zero count. If it is nonzero, stop, preserve the snapshot, and review each row; do not run an automatic converter.
5. Deploy the Group-based web app, CLI-ready `/api/v1`, and authentication together. Remove the legacy UI and make `/api/tasks` unavailable. The first real User signs in, claims a Username, and creates the first Group through ordinary product operations; there is no seed-only path.
6. Prove that unauthenticated `/api/v1` access fails, authenticated web and CLI requests see the same Group data, `/api/tasks` cannot write, and the legacy collection is unchanged.
7. If acceptance fails, restore the frozen legacy revision. Group-based records remain isolated and may be reused by the corrected v1 deployment. After the full v1 acceptance proof passes, recursively delete the legacy `tasks` collection and retire the frozen revision.

## Rejected alternatives

- **Generic backfill into the first Group:** rejected because Group ownership, Member identity, and completion metadata would be fabricated.
- **Keep the public board beside v1:** rejected because it creates a second unauthenticated product and source of truth.
- **Delete the legacy collection before acceptance:** rejected because it removes the simplest rollback surface for no practical benefit.
