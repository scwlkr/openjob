# Gmail reply protocol — P-WLK-6 / R41

This adapter has no configured runtime. Its only current composition uses an
injected fake transport in the invented Google fixture. Normal/portable services
have no dispatcher, read OAuth is unchanged and actual `mail.send` stays denied.
Protocol tests do not close R41's approved real-reply acceptance gate.

`createGmailReplyAdapter` requires an injected transport, trusted verified
owner/Workspace/account/Google-subject/address bindings and a private credential
resolver. Execution approval defaults to false before credential lookup or HTTP.
An enabled caller must recheck current rights for the exact frozen request;
approval and expiry are rechecked immediately before one POST. Only the exact
`gmail.send` scope authorizes this operation; current read consent lacks it.
Unsupported From aliases, wrong bindings/subjects and absent scope fail before
POST. Credentials never enter frozen payloads or public operation views.

The adapter accepts a separate `mail.send` request and rejects `reply.simulate`
actions/frozen simulation payloads. The fixture maps frozen content only inside
an inseparable invented-credential/fake-transport composition. Only fake-generated
`sim_` receipts enter the simulation runner. A live runner needs a distinct
durable action and receipt contract; old simulations cannot become sends.

Serialization uses the frozen draft's canonical ASCII From/To/Cc, UTF-8 Subject,
saved timestamp, In-Reply-To/References and base64 text/plain body. Text line endings
canonicalize to CRLF. Gmail receives `raw` base64url plus original `threadId`.
Control/header injection, missing/noncanonical threading, duplicate recipients,
non-ASCII mailbox addresses, invalid Unicode and oversized MIME fail before HTTP.
The existing 20,000-character draft limit remains. This reply slice adds no source
quoting, Bcc, attachments, HTML, provider Draft or alias selection.

Sources: Gmail's [base64url MIME requests](https://developers.google.com/workspace/gmail/api/guides/sending)
and [thread/header/subject requirements](https://developers.google.com/workspace/gmail/api/guides/threads),
[RFC2047 encoded words](https://www.rfc-editor.org/rfc/rfc2047) and
[RFC2045 transfer encoding](https://www.rfc-editor.org/rfc/rfc2045). Current
source/review authority supplies the immutable subject plan; dispatch accepts no
subject override.

The fixed-origin transport disables redirects. A bounded200 acknowledgement must
contain a valid message ID and expected thread ID; only those receipt fields leave
the boundary. Known4xx rejection is definite. Timeout, lost/5xx/malformed/oversized
response or wrong thread is unknown, with no refresh-and-retry. Provider error
text is redacted. Acceptance proves neither delivery nor reading.

The existing runner persists executing before dispatch and owns no-replay behavior.
It checks current source/binding/rights before invoking the adapter. Abort checks
after slow approval/credential lookup prevent a POST starting after runner timeout.
Fake acceptance hashes/counts persist before acknowledgement; lost-response tests
reconstruct the repository/provider ledger and prove zero additional POSTs.

Live outbound storage/composition, separately consented send access, approved
account/recipients, exact-thread verification and human release gates remain open.
No real credential, consent expansion, provider effect, deployment or publication
is part of this change.
