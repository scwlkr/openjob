# Mock OAuth lifecycle

The provider OAuth lifecycle is server-only code with an explicit `mock` mode.
Its default mode is disabled. No application route, browser Connect control,
Google client registration, callback deployment or real token exchange is wired.
It uses injected exchange, identity-verifier, transaction-store and vault
interfaces. Tests use invented identities, credentials and transport exclusively.

## New account flow

The server supplies the owner, new account ID, expected Google subject, label,
client ID and exact callback URI. The flow requests only OpenID identity, email
and Gmail readonly access. Cryptographic state, nonce and PKCE verifier values
bind a short-lived authorization transaction. The returned mock handoff contains
the state, nonce and S256 challenge, never the verifier. It does not launch a
provider authorization page. The transaction stores a hash of state.

The callback must match the same active owner and configured callback. Atomic
state consumption admits one callback; a foreign owner cannot consume another
owner's state. Expired, cancelled and replayed transactions cannot exchange a
code. Expiry and owner activity are checked again after asynchronous work.

The injected identity verifier must verify the ID token signature. This module
does not implement Google JWKS retrieval or cryptographic token verification.
It additionally checks issuer, audience, expiry, nonce, expected stable subject
and verified email. A claimed email alone never establishes account ownership.
Granted scopes must match the requested read-only capability.

After verification, the metadata repository creates a denied `needs_consent`
reservation with a new revision and opaque vault reference. The vault receives
the exact owner/account/subject/reference/revision binding. Only after successful
provisioning and readback can a conditional write approve that unchanged
reservation, preserving its reserved revision. Ordinary updates and revocation
still mint new revisions. Already approved or revoked records cannot use the
reservation approval method. Existing accounts are not overwritten or reconnected.

Metadata and the external vault cannot commit atomically. Failures deny the
reservation first, then remove only its matching vault entry. Cleanup failures
must be retried without re-exchanging the consumed code or affecting another
connection. No public result or error contains tokens, codes or PKCE verifiers.
An ambiguous callback outcome must not cause an automatic exchange retry.
Cleanup skips active writes. A settled but uncertain reservation is recovered
only by its exact generated reference; if absent, a conditional revoked
tombstone prevents a late create. A foreign record is never revoked or deleted.

Failed reservations remain denied metadata for inspection. This slice has no
account deletion/reconnect control and cannot reuse the same account ID after
failure. It does not silently delete records to make a retry appear successful.

## Evidence and remaining setup

The original transaction helper and the cleanup queue use process memory for
mocks. An optional `db/provider-oauth-transactions.ts` adapter now persists
transactions in one private `v1ProviderOAuthTransactions/{owner}` document through
the existing Firestore REST client. It is bounded to 100 pending/spent hashes and
200 KB. Conditional writes and active-User fences let independent instances
consume a state once. Consumption erases the stored verifier/nonce and retains
only a spent hash and timestamps until the original ten-minute expiry, preventing
state recreation during that window. Reads validate every owner-bound field.

Create/consume prune expired entries only for the selected owner. Explicit
`cleanupExpiredForOwner` and deletion cleanup use the same direct document path;
no collection scan or deployed TTL setting is required. Tests reconstruct the
adapter over fake Firestore and race separate instances. Production does not
configure this adapter, and live database durability is unverified.

The cleanup queue is still not durable or coordinated across processes; a restart
loses pending cleanup work. Production needs durable retry ownership and orphan
reconciliation. The vault interface is not a provisioned secure store.
Synthetic tests prove ordering, replay/owner denial and revision fences;
they do not prove live Google consent, token validation, database runtime or
external cleanup. Expiry checks cannot compare against Firestore's server commit
clock or recall an already-started external request. Native/device behavior is
unchanged and unverified.

Production needs a configured atomic transaction store, reviewed signature verifier,
secure access/refresh-token storage, deletion/cleanup integration and runtime
bindings before any separately approved test account can connect. Reconnect,
refresh and provider writes are outside this new-account read-only flow.

References: [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server),
[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[PKCE](https://datatracker.ietf.org/doc/html/rfc7636), [connection storage](CONNECTIONS.md).
