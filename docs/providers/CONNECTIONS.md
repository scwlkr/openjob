# Owner connection and credential broker boundary

The connection reader composes the Gmail, Outlook and IMAP wire adapters with injected server-side
connection records and a credential broker. Production defaults have no reader,
records or broker configured. There is no live mode, environment enable switch,
upstream-token API parameter or browser connection control.

An explicit `mock` execution mode requires a supplied HTTP transport. The
isolated test server supplies invented Gmail/Graph responses and IMAP session bytes, in-memory connection
records and a fake broker. The authenticated API, existing CLI and app can read
that protocol path in tests. Accounts and records are visibly marked **mock**;
the independent synthetic examples remain available. Neither mode is a real
mailbox connection or an OAuth verification result.

## Ownership and approval

The store interface always receives an owner: `listForOwner(ownerId)` and
`getForOwner(ownerId, accountId)`. Returned rows must match that owner and account.
Malformed, duplicate or foreign records fail closed. A connection binds the
account to a provider, subject, address, approved read scopes, expiry and revision.

Only an active owner with current approval and read consent can reach credential
lookup. The broker receives an opaque reference and the expected owner/account/
subject context; its credential never enters public account data. Approval
checks compare the current record with the original fingerprint, including its
reference, subject, scopes, expiry and revision. The reader checks around broker
lookup, before each provider GET and before response delivery. Changed, deleted,
expired or revoked approval stops the read. Each adapter also checks the
resolved credential subject/scope/expiry and returned mailbox profile.

Public account metadata contains capability/status reasons, not credential
references, tokens or private connection revisions. Owned accounts awaiting
consent or revoked approval show an empty read view; foreign account selection
is denied. Upstream authentication failures remain provider errors and cannot
silently refresh or borrow the human's OpenJob identity. Group/personal agent
credentials remain denied by the human preview endpoint.

These are repeated authorization checks, not a transaction with an external
provider. A future live request can race revocation after its last approval
check; already-started reads cannot be recalled. Final checks suppress delivery
when the change is observed before the response. This implementation has no
provider writes or queued sending.

## Demonstrated without credentials

The HTTP test harness has approved Alex and Sam accounts for Gmail and Outlook,
plus separate needs-consent examples. It runs profile/list/detail/folder reads
through the real provider mappers. Message pages retain account/thread/folder
IDs and bounded UTF-8 plain text. The app can create a title-only personal Task from
the example. Revocation and consent denial return no Mail and cause no new
broker lookups or provider HTTP requests. Loopback test controls affect only
those in-memory records; they are not application account-management APIs.

## Durable metadata and vault adapter

`db/provider-connections.ts` implements the existing store interface with the
Firestore REST client. A separate `v1ProviderConnections/{owner}` envelope holds
at most 100 validated connection records, independently of Task/Calendar writes.
Only metadata and opaque credential references belong here. Conditional writes
compare the expected connection revision and Firestore update time; an active
User write fence commits with the metadata change. New mutations mint a revision.
Reads check the active owner before and after retrieval. Cleanup is idempotent.

`server/providers/provider-token-vault.ts` adapts an injected vault reader to the
credential broker. The vault record must match the exact owner, account, subject,
credential reference, provider and connection revision. Legacy absent-provider
records mean Gmail; new Outlook bindings explicitly identify Outlook. Subjects
are unique within a provider, while account IDs and credential references cannot
be reused across a single owner's connections. Approval is checked before lookup
and after the vault returns. Neither module provisions storage or supplies a real
vault. Evidence reconstructs the repository over isolated fake Firestore transport
and uses invented vault credentials; it does not verify a live database.

Metadata and a future external vault cannot commit atomically. Revoke metadata
first to deny new reads, then clean up the vault with retryable, idempotent work.
Failed vault creation must never produce approved metadata. Account deletion must
invalidate access immediately and include both metadata cleanup and vault cleanup
before production binding is enabled. Already-started external reads cannot be
recalled. The repository exposes cleanup but is not registered with the production
deletion workflow because production never creates these records yet.

The [mock OAuth lifecycle](OAUTH.md) adds a new-account reservation approval
transition: only an exact unchanged `needs_consent` record can become approved
without changing its reserved revision, after matching vault provisioning.
Ordinary updates and revocation still mint revisions. This exception permits
vault-first provisioning without a cross-store transaction.

There is still no production OAuth callback/refresh flow, provisioned credential
vault or live provider configuration. The runtime has no configured repository
or broker and cannot enable live reads. Implement and review those bindings,
verify deletion and the cloud runtime, then obtain separate approval for one
test account. See [Gmail reads](GMAIL_READ.md), [Outlook reads](OUTLOOK_READ.md)
[IMAP Inbox reads](IMAP_READ.md) and [setup requirements](README.md).

REST semantics: [conditional writes](https://firebase.google.com/docs/firestore/reference/rest/v1/Precondition)
and [atomic commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit).

## IMAP session binding

Explicit IMAP records additionally bind a private server configuration key,
username and INBOX. The configuration participates in connection fingerprints,
broker expectations and vault entries; changed configuration cannot reuse an
approval or stale credential record. The internal imap.read approval is not an
OAuth scope. The injected session factory must attest the exact account/config
binding. It supplies invented authenticated-session bytes in development and
does not implement live TLS, login or passwords. Gmail/Outlook cannot fall back
to global network transport when only an IMAP session factory is configured.

## WLK331 — simulated Connections application (draft)

The new account-level `/connections` UI and `/api/v1/connections` API implement a
bounded first-account application contract. Normal portable/hosted composition
leaves onboarding **unset** and returns503 after human authentication; no flag,
real callback, token provisioning or provider access was added. PR100 notes code
is not a dependency. UI behavior is **unverified**; browser execution stays paused.

The owned-Workspace fixture injects invented Gmail account choices and the existing
mock OAuth lifecycle/broker/read mapper. It shows explicit read-only consent,
cancellation, verified invented address, simulated Mail, disconnect/cleanup retry
and reconnect. Stable public Connection ID and home Workspace survive reconnect;
server-selected subject must match. Outlook consent is unsupported and IMAP is
blocked on WLK302 source recovery. No external authorization URL/provider network
or Calendar scope exists. Calendar navigation opens that Workspace's OpenJob
planning blocks. Live source-linked Tasks/provider Calendar remain follow-on work.

`v1ConnectionOnboarding/{owner}` stores only bounded application metadata, status
and cleanup intent, using existing Firestore REST CAS/active-User fences. It does
not implement credential storage, wrapping keys or a production scheduler. The
injected adapter must fence future completion when disabled and retry cleanup
idempotently. Fixture OAuth/credential state is process-local invented data; a
restart keeps last-known application metadata, and the next Mail read detects
missing fixture credentials and moves to reconnect-required. This is not a durable
live grant, refresh implementation or accepted vault decision. Cleanup failures
remain visible; new Mail reads are denied before cleanup completes.

CLI commands use the same API: `openjob connections list`, `begin --input FILE`
with `{ "choiceId": "invented_gmail", "workspaceId": "wsp_..." }`,
`action CONNECTION_ID --input FILE` with one `action` of `approve`, `cancel`,
`disconnect` or `retry-cleanup`, and `mail CONNECTION_ID`. Approval is available
only in the explicitly injected simulated application; normal service stays503.
The signed fixture CLI test exercises the actual command and validates responses
against OpenAPI. No browser or real-login setup is needed for that test.

For future authorized UI proof, the existing owned-Workspace fixture entry serves
`/connections` alongside `/pilot`; create an owned Workspace first. It persists
application metadata in its explicitly selected private fixture file. No launcher
or browser was started for WLK331, and pending localhost5202 permission was neither
retried nor bypassed. Keep existing sessions and data. Actual consent/setup remains
separate as described in [the onboarding review](README.md).
