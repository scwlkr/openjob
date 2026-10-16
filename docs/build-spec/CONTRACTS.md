# API, CLI and connector contract strategy

**Current code inspected at `9ba3929fbf0ccc3e24e2577410a355fa3798736e`.** The [owner-confirmed core](../ARCHITECTURE_ALIGNMENT.md) governs ownership/permissions; exact new shapes/routes below remain proposed. Implementation must re-read live contracts and update the one existing OpenAPI source; this document is not a parallel schema.

## Grounding in the current repository

| Current seam | Verified source fact | Build implication |
|---|---|---|
| `openapi/openapi.yaml`, `cli/generated/openapi.d.ts`, `cli/openapi-types.ts` | One versioned `/api/v1` API and generated CLI types | Extend this source, regenerate and run contract/type checks |
| `server/v1-runtime.ts`, `server/v1-personal-workspace.ts` | Firebase identity resolves owner; Personal agent bearer handled separately; Personal snapshot/commands and sync exist | Keep identity resolution; extract workspace context and shared authorization into application operations |
| `shared/workspace-contracts.ts`, `shared/workspace-engine.ts`, `shared/personal-workspace.ts` | Prototype operations include Task/Calendar, invented Mail draft/send simulation; `mail.send` is explicitly denied | Reuse behaviors but do not relabel fixture types as live provider data or widen fixture scopes |
| `db/personal-workspace.ts` | `v1PersonalWorkspaces/{owner}` holds JSON state/grants/receipts, capped at 900,000 encoded bytes, CAS retries | Split owned entities/projections into repositories before Inbox ingestion; preserve conditional-write invariants |
| `shared/personal-agent-grants.ts` | Hashed opaque credentials, explicit scopes/resources, fixed 24-hour expiry | Preserve boundary; add principal/control/context model without silently making credentials persistent |
| `server/providers/provider-connections.ts` | Connection includes owner/account/subject/revision/credentialRef; execution `disabled` or `mock`; mode strictly `mock` | A production mode is substantive implementation with approved bindings, not a renamed flag |
| `shared/provider-contracts.ts` | Capability map for Mail read, draft/send, Calendar read/write, reconnect; connection-qualified records/pages | Evolve capability metadata and normalized refs; retain provider semantics and unavailable reasons |
| `server/providers/*read-adapter.ts`, `*transport.ts`, `*wire.ts` | Gmail/Graph read translators and bounded IMAP fixture session | Translation tests are useful, not live OAuth/TLS/MIME or sync proof |
| `server/v1-provider-preview.ts`, `server/provider-workspace-preview.ts` | Separate authenticated provider preview; agent credentials denied | Replace preview-only fragmentation with authorized Mail resource operations, keep fixture labeling |
| `cli/openjob.mjs` | Existing human/agent CLI, profiles, JSON/JSONL output, `workspace command`, provider preview, task/calendar commands | Extend this CLI. `cli/workspace.mjs` remains loopback fixture-only, not another production client |
| `shared/task-calendar-sync.ts`, `db/task-calendar-sync.ts`, native/web coordinators | Existing Personal offline projections, revisions, explicit sync receipts | Reuse and context-qualify; do not promise Group/Company offline writes until proven |

See [current source tree](https://github.com/scwlkr/openjob/tree/9ba3929fbf0ccc3e24e2577410a355fa3798736e), [provider boundary](https://github.com/scwlkr/openjob/blob/9ba3929fbf0ccc3e24e2577410a355fa3798736e/docs/providers/README.md), and [Personal workspace API](https://github.com/scwlkr/openjob/blob/9ba3929fbf0ccc3e24e2577410a355fa3798736e/server/v1-personal-workspace.ts). These observations are source inspection, not a runtime test.

## API evolution

Use context-owned `/api/v1/workspaces/{workspaceId}/...` resources for membership/resource administration, plus account-level `/api/v1/me/connections` management filtered to authorized bindings (proposed paths). Where identified active consumers need old routes, use temporary adapters resolving the authenticated User's Personal/Group context. Otherwise replace obsolete prototype contracts and update clients together. Preserve useful behavior, not compatibility for its own sake. Never reinterpret a real resource ID or silently change its ownership; no migration ceremony is needed for disposable fixtures.

Proposed resource families:

| Family | Minimum operations | Notes |
|---|---|---|
| `/me/contexts`, `/workspaces`, `/workspaces/{id}/memberships`, internal groups, invitations/owner-transfer | List permitted contexts; create Workspace; invite/accept; permission sets/suspend/depart; owner proposes transfer and recipient accepts | Invitation acceptance and single-owner continuity invariant transactional; no inference from domain |
| `/workspaces/{id}/task-spaces`, `/tasks` | List/detail/create/update/complete/reopen/delete; source and planning operations | Context-qualified IDs; optimistic revision; separate private-source response |
| `/workspaces/{id}/calendars`, `/events`, `/availability` | List, bounded time-window reads, block/event mutations, busy projection | External event command returns Operation, local mutation may complete synchronously |
| `/me/connections` and Workspace resource bindings | List only manageable provider authorizations; connect/reconnect/status; bind mailbox/calendar home and explicit access; detach/disconnect with impact preview | Central management is not global authority or master ownership. Callback binds approved human/resource destinations; credential storage remains Proposed |
| `/workspaces/{id}/mailboxes`, `/messages`, `/drafts` | Paged read/search, source-qualified detail, draft mutations, send, archive/trash | Provider message body fetched on demand; account identity explicit; send is an action with idempotency |
| `/workspaces/{id}/agents`, `/delegations` | Connect external principal, list effective Workspace grants/activity, issue/revoke scoped credential | Members delegate current-right subsets under policy; no runtime provisioning or cross-Workspace grant union; exact administration API Proposed |
| `/workspaces/{id}/operations/{operationId}` | Inspect status/result; reconcile or cancel before dispatch where supported | No blind retries of unknown effects; no raw provider error/token leakage |

Route details and operationIds are finalized in the selected implementation slice's OpenAPI diff, not left to an owner product question. Prefer ordinary resource endpoints plus named cross-domain actions over one untyped catch-all command. Keep a temporary old-command adapter only while an actual active consumer needs it; otherwise remove the duplicate path in the coherent cutover.

### Common contract rules

- Responses preserve the existing envelope style: data or structured error with stable code/message/requestId; add operationId, context and revision where relevant
- Lists use opaque cursors bound to context, resource, filter and authorization scope. Default page 50, maximum 100; adapter may return smaller provider-limited pages. Never return an unbounded workspace dump for live Mail
- Detail/mutations expose entity revision/ETag and require If-Match for concurrent update/delete, extending accepted ADR 0009. Missing precondition is 428; mismatched revision is 412. Existing legacy route errors remain compatible until deliberately migrated
- Every external mutation and retryable create uses a client request key scoped to principal + workspace + operation type. Same key/same payload returns original receipt; same key/different payload returns 409. Persist dedup identity before external dispatch
- Validation rejects unknown fields, foreign identifiers, invalid intervals and unsafe URLs/addresses. Apply bounded body/file limits before buffering. Never let clients choose server file paths or arbitrary provider URLs
- Error codes include authentication_required, forbidden/unavailable resource, invalid_input, precondition_required, revision_conflict, capability_unavailable, consent_required, reconnect_required, rate_limited, operation_unknown, cleanup_pending. Preserve existing stable errors at compatibility routes
- A write-without-read grant receives a minimal receipt. Permission failures never return a forbidden resource's metadata or draft body
- A timeout is not proof of rejected write. HTTP 202 means accepted intent, not provider success; GET Operation resolves terminal or review-needed state
- No raw credentials, secrets, OAuth codes, provider response dumps or private source metadata in API errors/CLI diagnostics/logs

### Operation state machine

`accepted → queued → executing → confirmed | rejected | unknown`

Before dispatch, `accepted/queued → canceled | authorization_revoked`. A recoverable known-not-executed failure may return to queued with a scheduled retry. `unknown → reconciling → confirmed | rejected | needs_review`; it cannot automatically transition to a new send. Retry uses the same operation identity when provider semantics allow it. Confirmed means provider accepted the requested effect, not final mail delivery or recipient reading.

The immutable intent contains chosen connection/provider subject, resource, approved action, payload hash and authority/binding revisions. At enqueue, freeze an operation-specific immutable snapshot of the approved recipients, From identity, body and attachment bytes/references in the protected outbound payload store. Verify its payload hash before dispatch; a mismatch rejects the operation before any provider call. Later Draft edits cannot change that snapshot and require a newly reviewed intent. Persist sensitive authored content outside the redacted job/activity ledger. A worker leases a job, rechecks current policy and binding, resolves credentials server-side, dispatches, stores provider result/receipt and updates projections. Crash injection before/after each boundary must not create a second effect. If no provider idempotency/reconciliation primitive can prove the outcome, stop at needs_review.

## CLI strategy

Keep `openjob` and existing profiles/credential storage/output conventions. Add explicit `context list/use/current`, `--workspace ID` override, Workspace/internal-group/accepted-owner-transfer management and natural Mail/Calendar/Task operations that invoke the same API. Persisted current context is a client convenience; noninteractive destructive/external write commands require explicit context or a saved unambiguous profile and show context in structured output. Cross-context use requires an explicit switch/override; never choose a matching mailbox name globally.

Existing `workspace command --input` can remain a temporary compatibility path for active consumers; remove duplicate behavior when no longer needed. Add `--request-id` and `operation show` for external work. JSON/JSONL include IDs, context, revision, capability/operation state and nextCursor. Keep stdout machine-readable; diagnostics go to stderr. Exit success only for the command's documented completion level; queued/unknown state must be explicit and must not print “sent.” Reuse established exit-code mappings, extending with documented unknown/pending handling rather than inventing a separate CLI framework. New credential issuance keeps secure file delivery, no token echo into routine logs/shell history.

## Connector contracts

Split interfaces by capability: identity/consent, Mail read/search/change tracking, Mail draft/send/mutation, Calendar list/read/change tracking/write, credential refresh/revoke. A connector advertises capabilities with `{implemented, runtimeEnabled, consented, resourceAllowed, available, reason}` derived on the server. A connector may not fake Calendar because it supports IMAP. OAuth sign-in is not Mail consent. A provider alias is a send identity on an account, not an isolated mailbox.

Read inputs include workspace/connection, provider-qualified target, bounded page/window and opaque cursor. Outputs include normalized metadata, preserved provider refs/version, next cursor, tombstones and observedAt. Provider bodies/attachments are lazy authorized retrieval. Preserve Gmail labels vs Outlook folders, upstream threading and IMAP UIDVALIDITY/UID; UID alone is not stable across resets. Sync cursor is scoped to the connection/binding revision; a reset reconciles refs without treating old deleted messages as new authoritative copies.

Write inputs include immutable Operation ID, exact provider target, expected provider version if available, explicit send identity and supported payload. Output is confirmed/rejected/unknown with provider receipt/reference and redacted error. Callbacks/webhooks validate provider signatures/subscription ownership and enqueue reads; payload is a hint, not authority. Never let a webhook assign ownership or grant access.

### Provider conformance suite

At adapter/integration qualification, cover two accounts with colliding IDs, unauthorized context, cursor/page correctness, deleted records, invalid MIME, credential/scope change, reconnect subject, provider limits, revision conflict, revoked queued execution and ambiguous/duplicate external effects. These are targeted boundary cases, not a requirement to run the entire matrix on every UI slice. Each real adapter gets isolated approved-account proof only for its claimed capabilities. Synthetic fixture, injected transport, real read, real write and released support are distinct evidence labels.

Prior to new IMAP TLS/login implementation, inspect/recover the unfinished WLK-302 work and current Linear history. Do not recreate it blindly. Use TLS certificate validation and supported authenticated submission; arbitrary hosts/ports need a reviewed allowlist/SSRF boundary. No insecure-login fallback or browser security bypass.

## Confirmed boundaries to preserve in the schema diff

Do not introduce a separate Company API/entity or multiple Workspace owners. Model
internal groups and permission sets without silently expanding agent authority. A
transfer changes accountable owner only on recipient acceptance and preserves resource
homes/grants. Connection management and content authorization are separate checks.
A provider authorization may expose several resources; R31 must define binding and
whole-connection versus resource-detach effects without inferring global credential
ownership from `/me/connections`. One upstream revocation must not be presented as
a harmless single-resource detach. Home aggregation is a human authorized read
projection; all mutations/grants remain Workspace-scoped. These changes affect the
proposed contract only; existing OpenAPI remains implementation truth.
