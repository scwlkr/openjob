# Provider read boundary

The authenticated Mail preview is a development boundary for future connectors.
It must identify every account and provider record without relying on a display
name, email address or globally unique upstream ID. A provider can reuse the same
message, folder or event ID in different accounts. References therefore retain
their owning account and record kind. Provider calendars remain authoritative
external records; OpenJob Personal Calendar and Tasks remain separate.

The application preview includes synthetic examples and explicitly labeled mock
protocol accounts. The [Gmail REST read adapter](GMAIL_READ.md),
[Outlook Graph read adapter](OUTLOOK_READ.md) and
[bounded IMAP Inbox adapter](IMAP_READ.md) implement bounded Mail translation
through the existing connection boundary, with execution closed by default and
only invented HTTP/session transport evidence. Provider names in
the preview describe examples, not verified live Gmail, Microsoft Graph, IMAP or
CalDAV connections.
Capabilities describe this adapter's implemented operations. An unsupported
operation must fail before any side effect; a button or a scope label is not
evidence that a provider operation exists. Message content is plain text and
never changes authorization.

Read pages and sync cursors belong to one owner and account. Pagination must
return each record once. Delta reads must preserve stable identity, expose
deletions and permit repeatable processing without inventing a second provider
truth. The deterministic fake exercises these contracts without network traffic.
An expired real provider cursor will eventually require a deliberate full
resync; a malformed or foreign cursor must not silently widen a request.

## Read the same preview through the existing CLI

With an existing authenticated human profile:

```sh
openjob workspace providers --format json
openjob workspace providers --account ACCOUNT_ID --cursor NEXT_CURSOR --format json
```

The API is `GET /api/v1/workspace/provider-preview`, with optional `accountId`
and `cursor` query values. The API resolves ownership from the existing Firebase
identity; a client cannot supply an owner. Group and personal agent credentials
cannot read the preview. Missing read scopes must not inherit human access.

In the app, open Mail preview, select one of the two synthetic Gmail examples,
read a page, inspect folder/thread context and create a title-only personal Task.
Select the Outlook reconnect/error examples or unavailable standards adapter to
see an explicit reason and empty provider content. Provider Calendar records
are read-only examples shown separately from saved OpenJob Calendar blocks.
No control connects a real account or writes a provider record. The adapter's
deterministic delta test stream is a contract fixture, not a running sync worker.

## Mock connection integration

The [owner connection/broker boundary](CONNECTIONS.md) can now drive the real
Gmail, Outlook and IMAP read mappers through the same authenticated API/CLI/app, using injected
in-memory records, fake credentials and mock HTTP only. These accounts are
explicitly marked mock, separate from the synthetic examples. Consent-required
and revoked accounts expose status without Mail or credential lookup. Production
has no configured reader, store or broker, and no live execution mode. A separate
Firestore metadata repository and injected vault-broker adapter are implemented
with synthetic tests; they are not production runtime bindings or a provisioned
secure credential store. See the connection guide for revision/deletion fences
and partial-failure ordering. A server-only [mock OAuth lifecycle](OAUTH.md)
implements state/PKCE/nonce, fake exchange/verified-identity seams and vault-first
reservation approval. A bounded Firestore transaction adapter is implemented and
tested over fake transport; production does not bind it. There is no production
callback route, signature verifier, token refresh or provisioned vault. The
cleanup queue remains process-local and needs durable retry ownership before live use.
The OAuth lifecycle is Google-only; Outlook has no authorization flow. Its
read-only protocol fixture exercises Graph mapping without changing that boundary.
IMAP adds an injected authenticated-session seam with byte-counted read protocol
evidence; it does not implement sockets, TLS, mailbox login or OAuth.

## Smallest real integration to authorize next

Choose one owner-approved test account and one read-only provider first. No
account has been selected or connected in this cycle. For a Google test account,
the next implementation would need:

1. An authorized development Google Cloud project with the Gmail API enabled,
   an OAuth client and an exact approved callback URI, plus a
   consent/test-user configuration. Creating or changing these is a separate
   owner-authorized setup action.
2. Explicit mailbox read consent using `gmail.readonly`. Google Calendar is not
   implemented by this adapter and needs no consent for the Mail-only test. Existing OpenJob/Firebase
   sign-in proves identity; it does not constitute mailbox consent. Google lists
   `gmail.readonly` as restricted; broader public use has separate verification
   requirements. See [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
   for the Mail-read scope. Calendar scope selection belongs to a future
   implemented and separately reviewed Calendar connector.
3. A server-owned authorization callback with state/owner binding and a secure
   credential store for access/refresh tokens, represented by persistent secret
   references rather than values in project files. Agents receive OpenJob scopes,
   never upstream credentials. Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server)
   describes the authorization and refresh flow.
4. A reviewed runtime binding to the implemented Gmail read adapter, then tests
   against that account for identity mapping, body/label/thread reads, pagination
   and revocation. Google Calendar, token refresh and history/delta sync remain
   separate unsupported work in this bounded Mail read implementation. Verify the existing cloud runtime and
   Firestore bindings in the authorized environment before calling it durable
   live integration. Current development evidence uses a fake Firestore transport.

Sending, provider draft changes and calendar writes are later, separately scoped
operations. A first read-only connection does not authorize them. This checkout
does not contain a live connector, real credential provisioning flow or deployable
OAuth configuration. No setup action above has been performed.

## Current evidence boundaries

The connected fixture demo remains `npm run dev:workspace -- --fresh`; it has
synthetic Mail, draft and calendar mutations through the shared local service.
The normal authenticated app has real private Task/Calendar APIs and scoped
personal agent controls, tested with signed synthetic identities and the actual
Firestore REST adapter over an isolated fake transport. Live OAuth, Firestore
runtime and provider sync remain unverified. Native personal Mail/Tasks/Calendar
and offline Tasks/Calendar now have cloud interaction/storage/HTTP tests; actual
device durability, encryption, rendering and release acceptance remain unverified.
Provider-neutral [Calendar files](../PERSONAL_WORKSPACE.md#calendar-file-exchange)
exchange a bounded timed-UTC subset without OAuth or a live provider connection.

## First connection review — 17 October 2026 (Proposed)

This narrows [R30–R33](../build-spec/ROADMAP.md#p3--connect-real-accounts),
[Connections experience](../build-spec/EXPERIENCE.md#connect-an-account) and
[ADR0021](../adr/0021-propose-provider-authority-and-integration-execution.md).
It does not adopt the proposed credential/runtime defaults or authorize setup.

Shane's path: open account-level **Connections**, choose an implemented provider,
choose the account at the provider, review read-only Mail access and its explicit
home Workspace, then return to the verified address and Inbox. Cancellation leaves
it disconnected. Open an actual message, make a source-linked Task and plan it in
OpenJob Calendar. Calendar labels must say **OpenJob planning blocks**: no provider
Calendar adapter exists for this first Mail milestone. Provider Calendar consent
and reads are a later R40 slice. Empty real Mail stays empty; examples remain a
separate mode. Reconnect/disable/disconnect show the affected resource and status.

Gmail is the engineering recommendation if approved access is equally available:
its existing consent scaffold is Google-only. This is not a provider selection.
Outlook has a read mapper but no consent lifecycle. IMAP needs WLK302 source
recovery first; do not duplicate its TLS/login implementation.

Source inspection at PR100 implementation263321c found these concrete gaps:

- `server/portable-runtime.ts` does not bind a connection repository/reader/broker;
  no central Connections management or provider callback route exists.
- `server/providers/provider-connections.ts` accepts only disabled/mock execution
  and mock records. A live path needs explicit composition and truthful API/UI
  modes, not a renamed fixture or an environment switch around authorization.
- `provider-oauth-lifecycle.ts` has injected mock exchange/identity verification,
  process-local cleanup, no refresh flow, and requires a preknown expected subject.
  First-connect account choice must bind the verified upstream subject after
  consent to the initiating User/resource selection; reconnect must require the
  existing subject. Neither may infer mailbox ownership from OpenJob sign-in/email.
- Current metadata is owner/account scoped, without explicit Workspace resource
  homes. Task/Calendar context adapters exclude Mail. `personal-workspace-mail.tsx`
  creates title-only Tasks from preview; a real source reference/reopen path is
  still needed without importing the Inbox into the Personal aggregate.

Recommend the existing **portable Node/Compose TypeScript service** as the first
Linux pilot composition, retaining Firebase/Firestore and the same API/broker.
C11 confirms Linux direction; this recommendation does not select a server,
public origin or deployment. Old hosted-first Cloudflare defaults remain Proposed;
do not mix runtime profiles or treat workerd fixture results as Linux acceptance.

Keep only opaque credential references in connection metadata. Resolve them
server-side through the existing broker with owner/account/subject/revision checks.
Use stable 1Password item/path references for approved operator/bootstrap material;
do not copy values into docs, Git, browser, arguments or client profiles. Provider
access/refresh-token storage needs the separately reviewed ADR0021/RUNTIME design:
retain its proposed encrypted server repository with a separately managed wrapping
key, or narrowly substitute an existing approved managed vault. A reference alone
is not encryption or an approved vault. No particular vault/key has been selected
or provisioned; the npm app's OS keyring for OpenJob login is not a provider vault.

**Ready independent source slice:** bounded Connections/onboarding application
contract: owner-only manageable binding list, read-only Mail resource-home
selection, initiating-User/destination-bound handoff and verified callback result,
explicit disconnected/consent/cancel/reconnect states; reuse current repositories
and injected OAuth/broker seams. Include durable refresh/cleanup ownership and
revision rechecks needed for this one read path, not a general sending platform.
Prove the journey through isolated API/CLI transports before authorized UI/live
proof. Do not implement TLS/login, cryptography or call real providers in that
slice. Track its implementation as one bounded R30/R31 item in Linear after this
review; WLK310 retains design evidence, WLK302 retains its blocked implementation,
WLK318 remains the separate local sign-in setup item. No new queue created here.

Owner setup is needed only when moving to live acceptance: review the selected
runtime/data/credential design and origin/callback; authorize the existing suitable
provider client/test configuration (change it only if needed), particular account,
mailbox/read scope and resource home; approve necessary secret-reference access and
runtime binding. WLK318's existing operator-reference/local Auth-domain approvals
remain separate and pending. Browser permission also remains unresolved. None
implies send, Calendar scope/write, new keys, production access or deployment.

WLK302 handoff recovered from Linear comment1bbe36a4 (17Oct02:07UTC), corroborated
by the stopped owner's final turn: branch `codex/wlk-302-imap-tls-runtime` based on
5358f6c, changes uncommitted, no PR, full gate unfinished, cloud unavailable. It
reports Node TLS9/9, API/CLI3/3, typed adapter10/10, affected checks72/72 and Worker
socket-contract proof on its May22 baseline; these are historical reports, not
rerun/recovered source or live TLS proof. No environment restarted or task resumed.
