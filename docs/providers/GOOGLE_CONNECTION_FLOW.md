# Google connection orchestration — WLK334

This source-only flow joins the official Google protocol adapter to the existing
human Connections API/UI. Normal portable/Cloudflare composition still injects
neither Google flow nor private repository and returns503. No live Google calls,
credentials, consent, registered callback, API activation, private-store activation
or infrastructure settings were used. Existing simulated onboarding remains a
separate engine and keeps its labels.

## User flow and authority

An explicitly configured server can offer address + owned Mail home selection,
prepare a Google read-only consent link, consume the callback, show saved status,
refresh read access, read through the existing Gmail GET adapter, disconnect and
reconnect. First consent binds the signed/verified subject only AFTER its verified
address matches the selected address. Reconnect preserves connection ID, account,
home and verified subject; it cannot swap Google accounts or move the Mail home.
No mailbox is created for an OpenJob identity. No send, draft or provider Calendar
operation was added. Calendar navigation opens the selected home's OpenJob blocks.

Google redirects to the configured HTTPS origin plus
`/connections/google/callback`. The page uses the existing Firebase session to
POST code/state/exact callback URI to `/api/v1/connections/google/callback`.
It removes callback parameters from visible history before asynchronous processing
and retains a single completion promise through React effect replay. No anonymous
code-exchange endpoint is exposed. If the session is absent, existing sign-in is
required; only the starting owner can consume that owner's state. Codes/tokens
must be excluded from reverse-proxy/access diagnostics before any real deployment.

All normal Connections API operations remain signed-human only; existing agent,
Origin, request-size and current-User checks apply. Extra scopes/owner/home fields
are rejected. API/CLI DTOs contain status/home/address and an explicit authorization
URL, never private grant objects, PKCE verifiers or credential references. The
CLI reuses begin/action/list/Mail; browser consent and callback require the human
UI. It does not accept upstream tokens. No automatic grant or POST retry exists.

## Private state and persistence boundary

`PrivateGoogleConnections` is an injected **private durable atomic repository**
contract, not a provisioned backend or an ordinary Firestore metadata collection.
It holds a bounded owner envelope (50 connections,900KB), including pending PKCE/
nonce, state hashes, connection lineage, operation claims and private access/refresh
grants. `change` MUST atomically compare/retry a pure transformation, fence active
owners, preserve consistent reads and never replay an ambiguous successful write.
There is intentionally no production implementation, default backend or secret
loader in this source slice. The fixture implements atomic in-memory persistence
shared across reconstructed flow instances; this does not prove process-restart,
encrypted storage or a live database.

Begin persists the ten-minute pending attempt before returning a URL. Callback
checks the exact configured client/URI and selected home, then atomically consumes
the attempt and erases persistent PKCE/nonce BEFORE exchanging once. A foreign,
expired, cancelled or replayed state cannot cause an exchange. The consumed hash
and lineage fence late results. Official token/identity/scope checks and current
owner/home/attempt checks run before approval. First subject is bound atomically
with the private grant; reconnect must match it.

Refresh atomically changes connected→authorizing/refresh before contacting the
adapter. Competing instances cannot refresh that grant simultaneously. Result
persistence uses the original claim; cancellation/deletion/home loss suppresses
delivery and prevents promotion. A failed or uncertain refresh requires reconnect,
without automatic retry. Lost backend access during promotion leaves a denied
claim; after recovery, status/cancel exposes it instead of re-exchanging the code.

Disconnect denies OpenJob access and removes its current private credential copy
in the same atomic repository transition. An in-flight operation becomes
cleanup_pending; “Finish local cleanup” acknowledges local disconnection only.
Late credentials are discarded and never made readable. Google may have issued or
retained a grant: neither local deletion nor cleanup claims Google revocation.
The adapter exposes no revoke operation because Google's revoke endpoint affects
OAuth grants across ALL clients in the project. This consequence remains for owner
review; a second client in the same project would not isolate it.

## Recommended token policy — Proposed, not activated

Use one reviewed private store capable of atomic owner-envelope updates; encrypt
access/refresh tokens and pending verifier/nonce at rest with server-only access,
keep decryption references in the approved secret-management path, and exclude
them from public metadata, browser storage, logs and exports. Keep pending secrets
only for the ten-minute attempt, retain only bounded spent hashes afterward,
serialize refresh rotation and remove current credentials on disconnect/deletion.
Backup retention, key management, physical erasure and upstream revocation must
be explicit in the selected backend's policy; clearing the current record is not
a secure-erasure claim. No 1Password item, encryption key, repository, persistent
access or cleanup scheduler was created or configured here.

## Evidence and remaining inputs

`tests/google-connection-flow.test.mjs` drives the actual signed HTTP API and
official library against invented signed Google tokens, private backing fixture
and Gmail wire responses. Schema-validated main-flow readback covers first bind,
reconstruction, refresh, Mail, disconnect and same-home reconnect. Denial cases
cover foreign users/agents/homes, wrong URI/address/subject, state replay/race,
cancellation, expiry, competing refresh, private-store failure, unsafe actions
and in-flight result suppression. A static React render checks labels/controls
and explicit revocation wording; a failed status refresh clears the prior catalog
instead of showing a stale connected state. Global fetch throws in these tests. No browser
or real provider proof follows from those fixtures. New UI controls are source/
typechecked; interactive browser proof is not claimed because the signed-in pilot
and its established browser surface remain untouched.

Before live activation, obtain current Google Data Access/Verification facts and
the exact approved HTTPS origin from sole infrastructure owner
`scwlkr/0o10` (task01a14a00, PR9 merged; first live VPS inventory approval pending).
Select/review the concrete private-store/key/retention and existing-client-secret
delivery policy; implement/verify that backend and its owner-deletion fences.
Then seek specific approval for the exact existing Web-client callback addition,
Gmail API enablement, secret delivery/store activation and selected-address
`shane.caleb.walker@gmail.com` read-only consent. External/In production audience
does not establish Gmail verification. Existing Firebase handler stays intact.
No new client, callback host, deploy or grant is implied by this source work.
