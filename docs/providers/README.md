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
