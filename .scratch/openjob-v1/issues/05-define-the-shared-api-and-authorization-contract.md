---
id: openjob-v1-05
title: Define the Shared API and Authorization Contract
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:grilling
claimed: true
blocked_by:
  - openjob-v1-01
  - openjob-v1-02
  - openjob-v1-03
  - openjob-v1-04
---

## Question

What resource, operation, error, and authorization contract gives the web and CLI identical access to Users, Usernames, Groups, Members, Admins, Invite Links, bans, and Tasks without duplicating behavior?

## Answer

### Protocol and shared-client boundary

- OpenJob exposes one versioned HTTPS JSON API under `/api/v1`. Web and CLI call these same operations and contain presentation logic only; domain validation and authorization live in the service.
- The API is resource-oriented where ordinary create, read, update, or delete semantics fit. Explicit action routes represent join, leave, end, kick, ban, unban, promote, demote, and Invite Link rotation so those domain transitions are not disguised as field edits.
- Every application request sends a short-lived Firebase ID token as `Authorization: Bearer <token>`. There are no web-only session operations, CLI-only operations, API keys, or client-side authorization rules.
- The implemented contract must be captured in a checked-in OpenAPI 3.1 document. That document becomes the machine-readable source of truth for both clients while this resolution remains the product contract.

### Representation conventions

- JSON field names use `camelCase`. IDs are opaque strings. Service timestamps use RFC 3339 UTC strings; Task due dates use `YYYY-MM-DD`; text is UTF-8.
- A single-resource success returns `{ "data": <resource> }`. A collection returns `{ "data": [<resource>], "nextCursor": <string|null> }`. A successful deletion returns `204` with no body.
- Group, Task, and User IDs are the canonical identities in URLs and mutations. Human-facing input may use a Username for assignment and Member lookup; the service resolves it to a User ID. User-bearing responses include both `userId` and `username`.
- An assignee is represented as either `{ "state": "assigned", "userId": "…", "username": "…" }` or `{ "state": "unassigned" }`. This preserves historical Username attribution on done Tasks without treating Unassigned as a User.
- Collection endpoints use opaque cursor pagination with a default of 100 and maximum of 500 results. Clients may automatically follow `nextCursor` when they need a complete collection.

### Identity operations

- `GET /me` returns the authenticated User and their accessible Groups. Before onboarding is complete, the User has no Username and the response indicates `usernameRequired: true`.
- `PUT /me/username` claims the authenticated User's immutable Username. Repeating the same claim succeeds idempotently; trying another value after a successful claim or claiming an occupied or reserved Username returns a conflict.
- Usernames follow the canonical rules in the domain glossary. v1 exposes no Username rename, User deletion, public User directory, email lookup, profile editing, or access to Google identity details.

### Group operations

- `GET /groups` lists the authenticated User's Groups. `POST /groups` creates a Group from a Group Name. `GET /groups/{groupId}` returns one accessible Group. `PATCH /groups/{groupId}` renames it and is Admin-only.
- `POST /groups/{groupId}/actions/leave` applies the settled voluntary-leaving rules. `POST /groups/{groupId}/actions/end` requires the current Group Name as confirmation and applies the settled permanent-ending rules.
- Every Group-scoped route carries the Group ID explicitly. The service has no active-Group session state.

### Membership, governance, and Invite Link operations

- `GET /groups/{groupId}/members` lists current Members and their Member/Admin role.
- Admin actions are `POST /groups/{groupId}/members/{userId}/actions/kick`, `/actions/promote`, and `/actions/demote`. Each action atomically checks current membership, actor authority, and final-Admin protection.
- `GET /groups/{groupId}/bans` lists Group-scoped bans for Admins. `POST /groups/{groupId}/bans/actions/ban` accepts the User ID of a current or former Member. `POST /groups/{groupId}/bans/{userId}/actions/unban` lifts the ban. The service applies membership removal and open-Task unassignment atomically when banning a current Member.
- `GET /groups/{groupId}/invite-link` returns the current Invite Link, expiry, and remaining successful joins to Admins. `POST /groups/{groupId}/invite-link/actions/rotate` immediately replaces it.
- `GET /invites/{token}` returns the Group Name needed for confirmation to a signed-in User without exposing membership or Task data. `POST /invites/{token}/actions/join` confirms joining. Joining as an existing Member is idempotent and consumes no use.

### Task operations

- `GET /groups/{groupId}/tasks` lists Tasks with the settled `status` and `assignee` filters, stable ordering, and pagination. `POST /groups/{groupId}/tasks` creates an open Task from `text`, `assigneeUsername`, and optional `dueDate`.
- `GET /groups/{groupId}/tasks/{taskId}` returns one Task. `PATCH /groups/{groupId}/tasks/{taskId}` edits the text, due date, or assignee of an open Task; sending `null` for `dueDate` clears it, while an assignee cannot be manually cleared.
- `PUT /groups/{groupId}/tasks/{taskId}/state` accepts the desired `{ "state": "open"|"done" }`. It implements idempotent completion and reopening without toggle semantics.
- `DELETE /groups/{groupId}/tasks/{taskId}` permanently deletes an open or done Task. Interactive confirmation belongs to the client; the service receives the already-confirmed request.
- Every accepted Task mutation validates the current Task and membership state atomically. The API retains last-accepted-write behavior and exposes no versions, edit locks, or conflict-merging workflow.

### Authorization and privacy

- A missing, invalid, or expired bearer token returns `401`. An unknown Group and a Group inaccessible to the authenticated User both return `404`, preventing private Group discovery.
- Every current Member may read the Group and perform every Task operation. Only Admins may rename or end the Group; inspect or rotate its Invite Link; inspect bans; or kick, ban, unban, promote, and demote.
- A known Member attempting an Admin operation returns `403`. Invalid Invite Links return the same generic `404` regardless of whether they are unknown, expired, rotated, exhausted, or belong to an ended Group. A banned User's join attempt returns `403` with a generic membership-denied code.
- Authorization is checked on every request. Removing, banning, leaving, or ending takes effect immediately; no client cache or remembered Group can preserve access.

### Errors, retries, and conflicts

- Errors use `{ "error": { "code": "stable_snake_case_code", "message": "human-readable text", "fields": <optional field map>, "requestId": "…" } }`. Clients branch on `code`, not `message`.
- `400` covers malformed requests and field validation, `401` authentication failure, `403` visible-but-forbidden operations, `404` missing or deliberately concealed resources, `409` uniqueness or current-state conflicts, `429` rate limiting, and `500` unexpected service failure.
- Stable conflict codes distinguish conditions clients can explain or recover from, including `username_taken`, `username_immutable`, `last_admin`, `open_tasks_assigned`, `task_done`, `assignee_not_member`, and `confirmation_mismatch`.
- Clients may retry reads and idempotent desired-state operations. They must not automatically retry Group creation, Task creation, Invite Link rotation, deletion, or other non-idempotent destructive actions. v1 adds no idempotency-key store.
- OpenJob imposes no product-level quotas in v1. Infrastructure throttling, when necessary, returns `429` and may include `Retry-After`.
