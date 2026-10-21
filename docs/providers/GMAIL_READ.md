# Gmail read adapter

The Gmail REST adapter implements a bounded Mail read path behind
`ProviderReadAdapter`. It is code tested with invented HTTP responses, not a
connected mailbox. The normal API exposes its public **not connected / consent
required** status; it never supplies a credential resolver or execution approval.
The synthetic preview and its local demo remain independent.

## Implemented boundary

Server-owned bindings associate an OpenJob owner/account with a verified Google
subject and mailbox address. An explicit execution approval callback, closed by
default, precedes credential lookup and every outbound request. A server resolver
must supply a matching subject, unexpired credential and the required read
scope. No API query, browser control or CLI option can supply that credential or
enable the adapter. Upstream secrets never enter DTOs or diagnostic messages.

Reads use fixed Gmail HTTPS endpoints, GET requests and denied redirects:

| Gmail operation | OpenJob mapping |
| --- | --- |
| Profile | Check the mailbox address against the server binding. |
| Labels list | Account-qualified folder references and original label IDs. |
| Messages list | Bounded page of message/thread IDs and an owner/account-bound next cursor. |
| Message get, metadata | Header/identity summaries without body or snippet; Subject/From/To only. |
| Message get, full | Match the requested ID; retain thread/labels, headers, provider timestamp and plain-text body. |

Gmail's [list method](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)
returns IDs; details require [message get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get).
The adapter maps the provider's `internalDate` and parsed MIME payload from the
[message resource](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages).
[Labels](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.labels/list)
remain provider labels; the folder-shaped view does not change their semantics.

Header values are preserved; this is not a comprehensive MIME/header decoding
library. Responses, labels, message pages and inline plain text are bounded so
an oversized provider record fails explicitly.

This slice does not read attachments, render HTML, perform history sync, read
Google Calendar, refresh OAuth tokens or mutate provider data. Unsupported
capabilities fail explicitly. A page cursor is not a history cursor. Sending,
draft changes and reconnection have no implementation in this adapter.

Authentication, missing consent, quota/rate limits, service failures, malformed
records and transport errors remain distinct, redacted failures. Reads do not
automatically retry or refresh credentials. Google documents its
[error categories](https://developers.google.com/workspace/gmail/api/guides/handle-errors);
a 403 can indicate a policy or usage restriction rather than expired consent.

## Evidence and remaining setup

Wire fixtures are invented messages/labels, not recordings of real mail. Tests
exercise mapping, pagination, identity/cursor checks, unsupported operations,
closed execution, bounded input and error redaction. They do not validate OAuth,
a real Google account, API quotas, live Firestore, deployment or native devices.

Before any live attempt, the owner must approve a test account and the setup in
[the provider guide](README.md): OAuth client/callback/read consent, a secure
server credential store, active-owner/connection bindings and cloud runtime
verification. A future reviewed integration must bind that approved connection
to this adapter and verify provider behavior. Existing Firebase sign-in is not
mailbox consent. No setup, credential creation or live execution occurred here.


## Explicit configured body reads (P-WLK-6 / R32)

The configured web chooses metadata summaries, then requests one body explicitly.
The adapter exposes separate listMessageSummaries/getMessageSummary methods while
retaining existing listMessages/getMessage full DTOs for current consumers. Metadata
mapping never invokes MIME decoding and never returns provider snippets. Creating a
source Task uses metadata; explicit Task-source/reply reads keep their full-message
contracts. A missing exact message maps to fixed message_unavailable404.

The body decoder descends only through multipart containers, omits attached/nested
message payloads, and rejects non-ASCII text labeled US-ASCII. The web renders plain
text as inert text, keeps one body transiently, and clears it on close/navigation/
disconnect. Existing full-read native/client consumers remain eager. Synthetic
adapter/API/CLI/browser proof does not close real connected, native lazy, sync,
metadata lifetime or release acceptance.


## Metadata observation lifetime

Configured metadata responses describe a conservative pre-scan observation with
stale/expiry bounds capped by current credential expiry. Fresh current checks run
after both successful and failed scans. The web uses elapsed monotonic and wall
bounds anchored at request start, clears expired content, and polls only a visible
first page at a bounded interval. It stops on the first failure. HTTP remains no-store;
no durable metadata/body cache, history cursor or global deletion feed is introduced.
Sleeping clocks are covered by synthetic elapsed-time checks, not a physical sleep
qualification. See [browser clock behavior](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now#ticking_during_sleep).
