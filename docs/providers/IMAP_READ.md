# Bounded IMAP Inbox reads

The IMAP adapter reads a documented protocol subset through an injected,
authenticated session. The existing owner connection, broker/vault, preview
API, CLI and app select it for explicitly qualified `imap` records. The runnable
demo uses invented protocol bytes and session handles. It has no socket, TLS,
login, password provisioning or live provider configuration.

This is a generic IMAP read boundary aimed at standards-based services such as
Purelymail. It is not verified Purelymail compatibility. Purelymail documents
IMAP over TLS and mailbox authentication in its
[technical setup guide](https://purelymail.com/docs/setup/technical); those live
transport/authentication steps are outside this implementation.

## Protocol and identity

The server-owned configuration identifies an opaque transport configuration
key, username and `INBOX`. Clients cannot supply a host or commands. The injected
session must attest the expected owner, account, subject and configuration.
That is a trusted injection seam, not remote authentication verification. The
internal `imap.read` approval is an OpenJob read permission, not an OAuth scope
or a guarantee that upstream credentials are read-only.

Only these read commands are emitted:

| Command | Required behavior |
| --- | --- |
| `EXAMINE INBOX` | Require read-only completion and UIDVALIDITY. |
| `UID SEARCH ALL` | Validate a bounded set of unique positive UIDs. |
| `UID FETCH … (UID FLAGS INTERNALDATE BODY.PEEK[])` | Match the requested UID and parse a byte-counted message literal. |

The [IMAP specification](https://www.rfc-editor.org/rfc/rfc3501.html#section-6.3.2)
defines `EXAMINE` as read-only. Its
[fetch definition](https://www.rfc-editor.org/rfc/rfc3501.html#section-6.4.5)
defines `BODY.PEEK` without an implicit Seen change. Message identity follows
the mailbox/UIDVALIDITY/UID combination, qualified by account and the server
configuration namespace; sequence numbers are never stable identities.

Paging binds the owner, account, configuration and UIDVALIDITY. A UID ceiling
excludes later appends from an existing page chain; expunged messages may
disappear. This is a bounded read view, not synchronization or an immutable
mailbox snapshot. A changed UIDVALIDITY invalidates the cursor. Each message
has its own grouping reference; conversation threading is unsupported.

Approval, connection revision and credential expiry are checked around session
creation, before commands and before result delivery. Revocation observed
before delivery suppresses the result. The transport is closed locally on both
success and failure. No mailbox-mutating cleanup command is sent.

## Deliberate limits

Pages contain at most ten messages (the isolated demo uses two). Search results
are limited to 1,000 UIDs, responses to 256 KiB and message literals to 64 KiB.
Headers are limited to 16 KiB/100 fields; session operations have bounded
timeouts. Overflow fails explicitly without silently truncating a search.
Only the documented ASCII/UTF-8 `text/plain` message subset is supported.
Unsupported MIME, HTML, attachments, character sets and transfer encodings fail
explicitly. Terminal controls are rejected while ordinary body line breaks and
tabs remain text. Malformed tags, ambiguous literals, mismatched UIDs and
unexpected protocol data return redacted errors without automatic retries.

Folders beyond Inbox, conversation reconstruction, IDLE/delta, reconnect,
Calendar, provider drafts, sending and all mailbox writes remain unsupported.
Preview-to-Task copies only the subject as a title and saves no mailbox link.

Live use still needs a selected authorized test account, reviewed secure
transport/authentication, credential storage and cleanup, runtime bindings and
provider acceptance checks. No such setup or external connection is performed
by the synthetic protocol evidence. Native devices remain unverified.
