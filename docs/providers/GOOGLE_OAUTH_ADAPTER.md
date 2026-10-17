# Google protocol adapter — WLK332 draft

This is a source prerequisite for the first Gmail read connection, not an enabled
connector. `server/providers/google-oauth-adapter.ts` uses Google's official
`google-auth-library`11.3.1 (maintained in the Google Cloud Node monorepo), pinned
with npm. It preserves the existing Node/TypeScript stack; the package supports
Node22, matching OpenJob's minimum. No native dependency or install script added.

## Private adapter contract

`createGoogleOAuthAdapter` defaults to disabled. Configured use requires an
explicit server-supplied client ID/secret, exact HTTPS callback, transport and
current-authorization callback. There are no environment switches, public routes,
secret loaders, stores, live composition bindings, browser controls or CLI token
inputs in this slice. No existing real runtime imports this adapter. Missing
transport cannot fall back to global fetch or Application Default Credentials.

- `proofKey()` uses the library's PKCE generator. The caller keeps the verifier
  private and persists the pending state before exposing an authorization URL.
- `authorizationUrl(...)` asks only for `openid`, `email` and `gmail.readonly`,
  with offline access, explicit account/consent selection, state, nonce and S256.
  It does not visit Google. Previously granted scopes are not requested via
  `include_granted_scopes`; actual returned scopes are still independently checked.
- `exchange(...)` is called ONLY after the future orchestrator has atomically
  consumed state bound to the current owner and exact callback. It exchanges one
  code with PKCE, verifies the ID-token signature/issuer/audience with Google's
  library, and additionally checks nonce, subject, verified selected address,
  presenter and strict expiry. Google tokeninfo independently checks the access
  token's audience/subject/scopes/expiry. No mailbox request is made here.
- `refresh(privateGrant)` performs one explicit refresh and tokeninfo inspection.
  It preserves a missing refresh token in the response and returns a rotated one
  if supplied, without mutating the caller's grant. Binding/revision mismatch,
  denied authorization, wrong subject, expanded scopes or expired output fails
  closed. `invalid_grant` returns redacted `reauthorization_required`.

Each operation snapshots its input before asynchronous work. The injected
`isAuthorized` must consult current owner, consent, selected home and exact
connection/reference/revision; the adapter checks it before token requests,
between async steps and before returning credentials. It cannot recall an already
started request. A changed binding suppresses subsequent requests and delivery.

`PrivateGoogleGrant` is server-only. Its `entry` fits the existing
`ProviderVaultEntry`/broker binding; its refresh token stays separate from that
read-only access-token entry. No result may become an API DTO, browser response,
CLI output, log or ordinary Firestore connection metadata. The future caller
owns private persistence, CAS/rotation serialization, deletion and cleanup. The
current broker/reader still only permits disabled/mock composition; this adapter
does not widen those types or disguise real grants as mock records.

Scope checks normalize Google's email scope URI alias. Extra/missing scopes fail
closed, including broader identity scopes returned with existing project grants;
the requested scope list is never proof of the actual grant. Subject must be in
tokeninfo; absent identity/expiry evidence fails rather than guessing.

Only fixed Google token, tokeninfo and signing-certificate endpoints are allowed
by the private transport. Redirects, automatic retries (including library token
POST retries), responses over128KB and unbounded requests are denied; each
request has a10-second timeout. OAuth errors expose fixed codes and no causes,
request objects, token response bodies or upstream descriptions. An ambiguous
code exchange/refresh is not replayed automatically.

## Shared-project revocation remains consequential

No revoke method or revoke endpoint is exposed. Google documents that token
revocation removes prior OAuth scopes and invalidates access/refresh tokens for
all clients in the project. A second client in `openjob-nonprod` would not isolate
that consequence. Future disconnect must deny OpenJob access immediately; actual
provider revocation/cleanup behavior needs explicit owner review of that impact.
This draft neither triggers revocation nor treats the proposed policy as accepted.

## Evidence and remaining concrete decisions

`node --test tests/google-oauth-adapter.test.mjs` drives the actual library with
fake transports and locally generated, signed invented ID tokens. Tests cover the
offline PKCE URL, valid exchange and broker-entry output, refresh retention and
rotation, bad signatures/issuer/audience/nonce/subject/address/expiry, scope
inspection, default/owner denial, in-flight revocation, mutation races, redacted
errors, no POST retry, redirects and oversized responses. Global fetch throws in
this test process, so the proof cannot silently contact Google. Broker composition
uses explicitly invented mock metadata, not live records or production setup.

The caller's live start/callback routes, durable one-use state lifecycle, real
credential repository/refresh coordination and consent-home promotion are NOT
implemented by this lower-level adapter. Existing mock lifecycle remains unchanged;
the live orchestrator must not run this adapter through a `mock` transaction mode.
Library behavior with fakes is not proof of Google consent or a live mailbox.

Before activation: read current Data Access/Verification; keep the verified
existing nonprod Web client/Firebase handler; obtain the exact callback origin
from the `scwlkr/0o10` infrastructure owner; review its implemented callback and
private token-runtime mechanism; separately approve callback registration, Gmail
API enablement and secure existing-client-secret delivery. No new domain, client,
key, secret retrieval/storage activation or grant is authorized by this source PR.
External/In production audience is not Gmail verification. The selected future
account remains `shane.caleb.walker@gmail.com`; no send/modify/Calendar scopes.

References: [official maintained package](https://github.com/googleapis/google-cloud-node/tree/main/core/packages/google-auth-library-nodejs),
[Google server OAuth and revocation](https://developers.google.com/identity/protocols/oauth2/web-server),
[existing lifecycle](OAUTH.md), [Connections](CONNECTIONS.md).
