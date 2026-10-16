# Outlook read adapter

The Microsoft Graph adapter implements read-only Mail behind the existing
`ProviderReadAdapter` boundary. Its runnable evidence uses invented HTTP
responses, credentials and connection records. It does not connect a Microsoft
account. Production exposes **not connected / consent required** metadata and
has no configured live reader or credential runtime.

The existing connection store, broker/vault, authenticated preview API, CLI and
app select this adapter for explicitly qualified Outlook records. Records with
no provider remain Gmail records. Account references and cursors retain their
owner/account binding; a provider message ID is never a global identity.

## Bounded reads

Only fixed HTTPS Microsoft Graph GET routes under `/v1.0/me` are supported.
The adapter verifies the profile's Graph user ID and mailbox address against
the server binding. That ID is not a verified OAuth/OIDC subject or tenant;
production identity verification remains part of the unimplemented Microsoft
authorization setup. Reads require delegated `User.Read` and `Mail.Read`, an
unexpired matching credential and repeated connection approval checks.

| Graph read | OpenJob behavior |
| --- | --- |
| Profile | Verify the bound user ID and mailbox address. |
| Message list | Read a bounded page of IDs and a validated next-page link. |
| Message get | Map selected metadata and plain-text content only. |
| Parent folder get | Name the folders represented on this page, including nested folders. |

Graph's [profile API](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0)
documents delegated `/me` access. Its
[message list](https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0)
requires using the entire `@odata.nextLink`; OpenJob validates that URL before
wrapping it in an account-bound cursor. Unknown hosts, routes and query options
cannot turn pagination into arbitrary requests. Raw provider links and tokens
are not public account fields.

Message requests use `Prefer: IdType="ImmutableId"` and request text bodies.
Graph [IDs are case sensitive](https://learn.microsoft.com/en-us/graph/outlook-immutable-id);
OpenJob preserves their case and opaque characters. The preference is requested
on each relevant request; a string's shape alone cannot prove live immutable-ID
behavior. The [message GET API](https://learn.microsoft.com/en-us/graph/api/message-get?view=graph-rest-1.0)
supports text content. HTML is rejected rather than rendered or relabeled as
plain text. Folder reads describe this page's parent folders, not a complete
mailbox folder inventory.

Responses, page sizes, fields, body text and request duration are bounded.
A page holds at most ten messages; a cursor retains at most sixteen visited
page fingerprints and rejects cyclic or overlong continuation chains.
Redirects are denied. Failures are redacted and do not retry, refresh tokens or
borrow OpenJob sign-in access. Approval is checked around credential lookup,
before provider requests and before returning the result. Revocation observed
before response delivery suppresses that response; an already-started external
read cannot be recalled.

Calendar, attachments, HTML, search, delta/history sync, refresh, provider
drafts, sending and mailbox mutations are unsupported. Creating a personal Task
from a preview message copies its title only and saves no private mailbox link.

## Remaining live acceptance

A separately authorized Microsoft application/test account, exact callback,
delegated consent, verified authorization identity, secure token vault, cleanup
and reviewed production runtime bindings are still required. The existing mock
OAuth lifecycle is Google-only. No Microsoft authorization flow, credentials,
grants, live requests or deployment are created by this slice. Injected fixtures
do not verify Microsoft service behavior, live database durability or devices.
