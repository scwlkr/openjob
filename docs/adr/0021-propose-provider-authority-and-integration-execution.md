# 0021 — Keep provider authority explicit and persist integration intent

- Status: **Proposed — owner acceptance pending**
- Date: 2026-10-16
- Scope: connector ownership, application data, sync and external operations
- Context: [platform blueprint](../PLATFORM_ARCHITECTURE.md)
- Supersedes: none; live provider execution remains unconfigured

The [owner-confirmed core](../ARCHITECTURE_ALIGNMENT.md) governs resource homes
and grants; the technical execution/data defaults here remain Proposed.

## Context

OpenJob owns Tasks, grants and its calendar blocks. Existing Mail and calendars
live with providers whose identifiers, operations, threading and sync guarantees
differ. Current adapter and broker seams have synthetic proof, not a complete
live consent/refresh/sync service. Request-local work cannot provide dependable
background execution. A single JSON aggregate also cannot become a growing Inbox.

## Proposed decision

External providers remain authoritative for their mail and calendars. OpenJob
stores connection-qualified references, bounded read projections and cursors,
and owns its Tasks, blocks, drafts/intents and operation history. Distinguish an
OpenJob draft from a provider draft; changing one does not silently update the
other. A planned OpenJob block is not an external calendar event until an explicit
supported write creates that relationship.

Keep provider-specific adapters behind capability-oriented interfaces for account
identity, Mail reads/drafts/sending and Calendar reads/writes. Available operations
reflect implemented adapter behavior plus actual consent/runtime configuration;
one provider's success does not imply universal support. Connections has an account-level authorized management projection; each exposed
mailbox/calendar resource has one home Workspace and explicit grants. Proposed
binding metadata includes controller/upstream subject/scopes/lifecycle and a
server-only credential reference. Central placement settles no credential storage
or global ownership. Workspace membership/owner status alone grants no provider access. The
credential broker resolves current bindings; users and agents never receive raw
upstream credentials through the shared application API.

Tasks owns the canonical Task-to-OpenJob-block planning relationship; Calendar
owns block intervals. The scheduling application operation coordinates create,
reschedule, unschedule and deletion across both repositories. It removes or
updates only the related OpenJob block; a provider event requires its own explicit
operation. Use application transactions for OpenJob-owned invariants. Before external side
effects, persist an operation intent with stable ID, principal/resource context,
requested operation, chosen provider identity and current state. Execute through
the connector and record authoritative provider IDs/outcome before projecting
success. Send outcomes distinguish confirmed, rejected and uncertain; inspect or
reconcile an uncertain send rather than automatically replaying it.

Use durable job/outbox records in the owning store to drive background integration
and publish necessary domain facts. Start with a runner in the same application,
not a separate event platform. Delivery is at least once; consumers use stable
operation IDs/receipts. Events carry minimal references/metadata; this is not
event sourcing, a raw-Mail broadcast stream or a cross-provider transaction.

Sync uses provider-supported incremental state or bounded pages/polling. Webhooks
are hints, not a second authority. The app shows current/refreshing/stale/blocked
states grounded in the actual connection. Separate provider projections from the
current owner aggregate before importing a real Inbox. The proposed first-live policy is metadata-only caching and on-demand bodies,
with no persistent provider-body/attachment or server body-search index. Exact
cache/receipt/cleanup defaults are in [RUNTIME](../build-spec/RUNTIME.md), pending
owner review and implementation proof. Authored drafts/outbound payloads are
distinct protected data, not provider cache.

Offline clients hold a bounded projection and explicit pending edits. They do
not gain provider write authority offline. Existing personal offline editing and
historical read-only Group caching have different scopes; neither implies a
complete cross-device/local-service sync model. Define that contract before
claiming a secure local production deployment or merging independent replicas.

Connections owns disconnect/revocation and credential-cleanup completion. It
blocks new credential resolution and pending integration work before cleanup;
Mail/Calendar invalidate readable projections. Identity/Workspace coordinates
account deletion or membership departure, and each context reports its cleanup
outcome. An unavailable provider leaves cleanup visibly pending. Retained Task
source stubs are separate from message-content retention, whose policy remains
an explicit live-data prerequisite.

[CONTRACTS](../build-spec/CONTRACTS.md) specifies the proposed operation states,
idempotency, dispatch rechecks and connector boundaries. [RUNTIME](../build-spec/RUNTIME.md)
specifies Firestore jobs/leases, scheduled bounded execution, encrypted credential
storage and cleanup defaults. Later controlled offline Mail/shared-Workspace work remains
required (OJ-X5/R52); no offline provider effects. Invitation/RSVP and series
writing remain required later Calendar work (OJ-K5–K6/R51), with separate
notification permissions and explicit occurrence/series scope. All remain Proposed.

## Alternatives and tradeoffs

- **Import everything as OpenJob-owned data:** makes reads easy but creates two
  competing truths and hides disconnect, delete and provider-specific behavior.
- **Call providers directly from every client:** avoids projection storage but
  spreads tokens, policy, sync and retry semantics across UI/CLI/agents.
- **Synchronous provider writes inside a database transaction:** looks atomic but
  cannot roll back an external delivery; a persisted intent/result is honest.
- **Event sourcing plus a distributed bus immediately:** supports broad replay
  and consumers but adds operational and privacy costs without a current need.
  Transactional job records provide the required boundary at smaller scope.

## Consequences and review gate

The first live integration must deliver consent, verified identity, secure
credential resolution/refresh, durable reference/projection storage and actual
Inbox reads together. Sending and external Calendar writes need their own
capability and consent proof. No adapter or mock OAuth test authorizes live use.

Before live implementation, review the proposed hosted/data defaults and prove
the durable runner/credential binding. Select the provider from approved access
and feasibility evidence; authorize external setup/effects separately.
Review unrecovered WLK-302 before IMAP work; this ADR does not replace its scope.
