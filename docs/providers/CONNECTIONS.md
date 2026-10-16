# Owner connection and credential broker boundary

The connection reader composes the Gmail wire adapter with injected server-side
connection records and a credential broker. Production defaults have no reader,
records or broker configured. There is no live mode, environment enable switch,
upstream-token API parameter or browser connection control.

An explicit `mock` execution mode requires a supplied HTTP transport. The
isolated test server supplies invented Gmail responses, in-memory connection
records and a fake broker. The authenticated API, existing CLI and app can read
that protocol path in tests. Accounts and records are visibly marked **mock**;
the independent synthetic examples remain available. Neither mode is a real
mailbox connection or an OAuth verification result.

## Ownership and approval

The store interface always receives an owner: `listForOwner(ownerId)` and
`getForOwner(ownerId, accountId)`. Returned rows must match that owner and account.
Malformed, duplicate or foreign records fail closed. A connection binds the
account to a subject, address, approved read scopes, expiry and revision.

Only an active owner with current approval and read consent can reach credential
lookup. The broker receives an opaque reference and the expected owner/account/
subject context; its credential never enters public account data. Approval
checks compare the current record with the original fingerprint, including its
reference, subject, scopes, expiry and revision. The reader checks around broker
lookup, before each Gmail GET and before response delivery. Changed, deleted,
expired or revoked approval stops the read. The Gmail adapter also checks the
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

The HTTP test harness has an approved Alex mock Gmail account, a separate
needs-consent example and Sam's own account. It runs profile/labels/list/get
through the real Gmail mapper. Message pages retain account/thread/label IDs;
UTF-8 plain text is decoded. The app can create a title-only personal Task from
the example. Revocation and consent denial return no Mail and cause no new
broker lookups or provider HTTP requests. Loopback test controls affect only
those in-memory records; they are not application account-management APIs.

No durable connection store, OAuth callback, production credential vault or
live provider configuration is implemented or claimed by this boundary. The
next approved integration must select and implement those components, preserve
account-deletion/revocation behavior, and verify the cloud runtime and one test
account. See [Gmail reads](GMAIL_READ.md) and [setup requirements](README.md).
