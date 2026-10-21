> Current20October route: use only the explicitly approved alternate and the
> [key-free local session](#alternate-only-route-without-an-operator-key).
> Operator/1Password access is withdrawn. Earlier setup/account notes below are
> historical; they do not authorize use of another account or credentials.

# Remaining Gmail-read gate after local sign-in proof

Selected mailbox: **shane.caleb.walker@gmail.com**, existing project
**openjob-nonprod (550998178053)**. The completed Google login grants OpenJob
identity only. Mail remains unconnected; no consent URL is ready.

Smallest next setup check is a nonsecret readback of the EXISTING Google web OAuth
registration `550998178053-5fivrj3rggm6ttmg3sesiupsahk14dus.apps.googleusercontent.com`:
confirm its intended Mail-use suitability, exact registered callback, consent/testing
account restrictions and Gmail API availability. The checked-in Firebase handler
`https://openjob-nonprod.firebaseapp.com/__/auth/handler` is an identity callback;
it is not proof of an OpenJob Mail callback or extra Gmail scopes. Registration
metadata above is known locally; its current provider-console Mail configuration
has NOT been independently verified. No new client, key, origin or grant is implied.

Before asking Shane to consent, a separately reviewed bounded source slice must
supply the actual read-only authorization/callback/exchange/signature verification
and owner/subject/home-bound credential-runtime path. Current lifecycle accepts only
`disabled | mock`, requires an exact HTTPS callback, and real composition omits both
onboarding and provider broker. Existing operator credentials serve Firestore; they
are not mailbox OAuth tokens. Secure token storage/cleanup/refresh choice and its
activation remain separate approval gates; none was enabled here. Infrastructure
configuration/deployment belongs solely to scwlkr/0o10.

Once that reviewed path and approved runtime exist, the smallest human consent is
this selected account and exactly `openid`, `email`,
`https://www.googleapis.com/auth/gmail.readonly`, followed by verified upstream
subject/address and explicit resource-home binding before one bounded read.
No send, Gmail modify or external Calendar scope. Do not enable simulated Connections
in the signed-in real runtime as a shortcut. No additional feature was started.

---

# Current local setup and actual-service verification — 17 October 2026

The exact approved nonproduction domain change is DONE and independently read back:
`openjob-nonprod` / project550998178053 retains its three previous authorized domains
and adds only `127.0.0.1`. Identity Platform PATCH used only `authorizedDomains` in
its update mask; no provider/client/role/other project setting changed. Existing
CLI identity was used with the intended project's request consumer, leaving the
unrelated deleted default quota-project configuration untouched. Nonsecret receipt:
`output/wlk-331/domain-receipt.json` (local ignored evidence). The
[official field-mask API](https://cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig)
was checked before the change.

The approved existing `OpenJob Preview QA Fixture Operator` document was resolved
via metadata-only listing and then loaded ONLY for the prepared short-lived local
process. Project/type/client-email/key shape matched nonprod. No values in chat,
logs, arguments or files; no new keys, roles or credential storage. An earlier
whole-item lookup was automatically rejected before execution; it was not retried.
The narrower reference lookup and document-only actual-use launcher succeeded.
This proves local configuration loading, not key validity against Firestore.

Real local UI now renders at `http://127.0.0.1:5202/workspace`, in connected Chrome
helper's owned handoff tab939996978: authenticated prototype / external providers
unconfigured / real sending disabled, Personal workspace and Continue with Google.
A temporary preview-only eager Vite public-define error initially caused a blank
page; literal public defines in the private launcher fixed it. The helper then
confirmed visible UI and no fresh warnings/errors. Product source was unchanged.
Shane completed Google sign-in himself and reported return to OpenJob. The helper
then observed “Personal workspace · signed in”, loaded Tasks 0/0, and no setup/error.
It created exactly one Task, `Local pilot verification 17 October`, and one linked
Personal OpenJob Calendar block. Final persisted time: **2026-10-18 15:00–15:30 UTC
(10:00–10:30 America/Chicago)**. An initial date input did not take; the SAME block
was corrected through normal Schedule UI, with final inputs and agenda verified.
Calendar showed exactly one new block. Open linked task and Refresh preserved the
exact title/time. Task/block remain intact, and handoff tab939996978 shows Calendar.
No visible identity label was available; no credentials, cookies, tokens, storage
or auth API were inspected. This is actual-service UI persistence evidence, not a
claim of mailbox authorization or a separate low-level credential audit.

Screenshot is inline in verifier task01a149f4-5c50-7146-aa7b-a7dbfd2d1010, call
“Capture persisted actual Calendar block and preserve Shane handoff”; no exported
artifact path/URL was exposed. Root independently checked the supplied source head;
the UI helper did not inspect Git. The selected mailbox remains
shane.caleb.walker@gmail.com, **not connected**. No provider Calendar write occurred.

Owned real-pilot process16066/session50291 runs private
`/tmp/openjob-318-real-launcher.mjs`; its operator lives only in that process.
Preserve it for this immediate handoff; stop only that PID when review is finished.
`/healthz`200 says configured, credentialsVerified=false; no live readiness claim.
The launcher is not deployed, committed or a persistent service. Actual credential,
identity and Task/Calendar UI persistence are now evidenced above; health remains
presence-only and must not be presented as a credential validation probe.

PR101 simulated Connections and PR100 notes UI were separately verified on the
same exact origin before switching to this real profile; do not conflate evidence.
No broad CDP/DevTools grant was inferred or tested. No helper handled credentials.
PR95 downloads remain parked. Infrastructure now belongs to scwlkr/0o10: owner says
OVH VPS purchased, OpenJob/PatriSearch primarily VPS, Minecraft local. VPS actual
specs/IP/OS remain unverified; no live access/deploy is authorized here.

---

# Approved local setup — 17 October 2026, 12:57 UTC

Shane answered the exact checklist, relayed by parent01a0f838:
- First read-only mailbox: `shane.caleb.walker@gmail.com` (selection, not a completed grant).
- Approved the pending DevTools access for `127.0.0.1:5202`, through its supported
  approval path only. No blanket browser access or retroactive PR99 qualification.
- Approved adding only `127.0.0.1` to existing `openjob-nonprod` Auth authorized
  domains and reusing its existing service-account credential for this local pilot.

These decisions supersede the historical “approval pending” wording below; actual
execution/readback is still pending. No new project/key/client, role, other origin,
production deployment, npm or TestFlight authority follows. Send and Calendar
writes remain disabled. Mail sign-in and Gmail consent stay separate.

Resume blocker in this session: callable browser/DevTools tools and their approval
operation are absent from the tool catalog; installed plugin files do not expose
that capability. No alternate browser/port/controller was used. `op` CLI and the
existing document title are available, but no document/key was retrieved or entered
while browser proof cannot proceed. Reuse the documented short-lived in-memory
operator launcher; hand off securely before any sensitive entry/transmission,
never put credentials into chat, logs or committed files.

Smallest handoff: restore the supported DevTools tool for the approved5202 request
in this task, then perform the two already-approved setup actions and read them
back; real sign-in and useful PR95/100/101 UI proof take priority. Do not ask Shane
to approve the same checklist again. If sensitive user entry is required, pause
for the secure entry surface. Domain change, operator suitability, real sign-in
and all changed UI remain UNVERIFIED; no launcher/settings action occurred here.

Gmail consent preparation, once existing client/callback and approved credential
runtime are verified: select the exact mailbox above, request Mail read-only
`gmail.readonly` with the existing identity-validation scopes, verify upstream
subject/address and bind its chosen resource home. No consent URL is ready yet:
actual suitable existing client/callback/runtime is unverified, and selection does
not authorize creating one or broadening scopes. No send or Calendar-write scope.

PatriBible coordinator acknowledged no resource conflict: Search is a bounded
read-only SSH diagnosis; neither task has browser control/heavy builds in flight.
Existing sessions/state and all three draft PRs remain preserved.

---

# Local account onboarding: exact remaining gates

Metadata inspected16October2026 after PR88. No Firebase private key or provider
secret was retrieved or transferred. Existing CLI authentication was used only for
metadata GETs; no token values were logged. No project/provider/access settings changed.

## Already available

- `config/native-identities.json` contains the nonsecret nonproduction browser
  project, API key, web App ID and auth domain. Development/preview both select
  `openjob-nonprod`; production selects `openjob-dev`. Do not mix them or use the
  stale `.firebaserc` default as the pilot target.
- `config/web-firebase-config.mjs` already maps these four browser fields. The
  portable service currently accepts them through environment bindings; missing
  bindings do not mean missing Firebase apps or a need to create one.
- A read-only preview Worker secret-name listing confirms existing
  `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` bindings. The API lists names,
  not values; it does not make them readable or authorize their transfer.
- `docs/qa-fixture.md` names the existing **OpenJob Preview QA Fixture Operator**
  1Password document: a dedicated nonproduction service account documented with
  `roles/datastore.user`. Its key was not retrieved; current key validity and
  suitability for this pilot are unverified. No new key is justified yet.

## Verified local origin gap

The Firebase browser SDK's public project-config GET returned only project ID
and authorized domains. For `openjob-nonprod` these are:

- `openjob-nonprod.firebaseapp.com`
- `openjob-nonprod.web.app`
- `openjob-preview.walkerworlddiscord.workers.dev`

Neither `127.0.0.1` nor `localhost` is authorized. The portable service defaults to
`http://127.0.0.1:5192`; approving that local browser sign-in requires adding the
exact hostname **127.0.0.1**, without protocol/port, in this nonproduction project.
Do not add production/public origins or change provider consent/scopes implicitly.

A later read-only lookup in the existing authorized in-app browser resolved provider
status: the exact `openjob-nonprod` Authentication → Sign-in method page, Default
tenant, visibly lists **Google Enabled** and **Apple Enabled**. No provider editor
was opened or setting changed; the lookup tab was closed. The earlier API403
(`SERVICE_DISABLED` on an unrelated CLI quota consumer) did not reflect provider
state and does not justify enabling unrelated APIs/IAM. Enabled alone does not
prove local OAuth redirect or actual sign-in. Existing public client/Apple service
IDs are already in the repository; no secret/client generation is implied.

## One bundled owner-assisted setup step

Before local real sign-in: approve reuse of the existing nonproduction operator
reference for this pilot process, and approve adding only `127.0.0.1` to
`openjob-nonprod` authorized domains. Google is already enabled on the existing default tenant; no provider-enable
change is requested. No Gmail/Mail scopes or mailbox connection are needed to sign in.

Then map existing public settings and the approved operator's client email/key
inside a short-lived launcher process, start the local service, and discard secret
values on exit. No secret arguments, committed env file, logs or exported long-lived
shell session. Verify sign-in → explicit existing/new User choice → username if
needed → create a personal Task/block. This actual sign-in/write proof is pending.
Do not reset QA data, create another Firebase project/key, rotate credentials or
increase roles as a workaround. Shane can perform the domain/provider readback
himself if current operator metadata access is insufficient.

Existing npm EOTP/authentication handoff is independent. Candidate0.3.9 is still
unpublished and has no publication approval. A rented server is not a prerequisite
for the local workflow or further credential-independent app work.


## Local session Gmail (WLK318)

This optional route reuses the existing Firebase Google popup in a separate named
Firebase app with in-memory persistence. Basic sign-in does not request Mail access.
The person separately connects Gmail and clicks **Read Mail once**. The existing
Gmail adapter reads one page of at most ten messages, with its existing text and
attachment bounds; it does not follow pagination or fetch attachment bytes.
It displays plain text only. This session route does not create a durable Mail
resource or link Mail into Tasks or a Workspace.

Default is disabled. An explicitly approved local nonproduction operator may set
`OPENJOB_GOOGLE_SESSION_MODE=configured`, `FIREBASE_PROJECT_ID=openjob-nonprod`,
`OPENJOB_PUBLIC_ORIGIN=http://127.0.0.1:PORT`, and these nonsecret exact selections:
`OPENJOB_GOOGLE_OWNER_USER_ID`, `OPENJOB_GOOGLE_OWNER_FIREBASE_UID`,
`OPENJOB_GOOGLE_MAILBOX`, `OPENJOB_GOOGLE_CLIENT_ID`. Use the existing Google web
client. Never commit selected private identity metadata. The service must listen
on that same `127.0.0.1:PORT`; persistent Google mode must remain disabled. Existing
Firebase operator configuration is still required; no new credential is created
by this flag. There is no Google client secret, encryption key, DNS, remote server
or offline refresh requirement for this route.

The popup requests only `gmail.readonly` beyond ordinary Google identity scopes,
with online access and no incremental grant accumulation. The server independently
validates the granted scopes, exact client audience, subject and verified email.
Only the selected active signed-in human can open, read or disconnect the session;
agent tokens are denied. The token is never written to Firestore, browser storage,
configuration or logs. A random session handle binds each request to its original
Firebase authentication event. Reconnect replaces the prior lease.

Disconnect clears the local view and token, and fences pending provider results.
Sign-out, page exit and navigation clear the view and try to disconnect. If that
network cleanup fails, the server token expires at the original deadline, at most
ten minutes or the earlier Google/Firebase expiry. Process exit forgets it. This
is local disconnect, not Google-wide revocation; Google may retain the consent.
A future read requires a new explicit session. No background provider refresh,
Mail changes, sending, Calendar access or existing connection-token cleanup occurs.

Verification: `npm run test:google-session` uses signed synthetic Firebase sessions,
fake Firestore and injected fixed provider transports. Tests cover identity/scope
isolation, no persistence, expiry and disconnect during validation/read. The small
`npm run test:google-session:browser` fixture uses invented Mail and a fake popup
to exercise actual connect/read/disconnect/expiry/sign-out controls and storage
absence. These checks do not prove a real Google popup, scope grant or live read.

20 October operational receipt: owner approved the selected alternate's single
read-only local test. Gmail API enablement in the existing nonproduction project
was confirmed. Only gmail.readonly was saved and Google confirmed the change;
the scope is marked unverified and Google requests app verification. Real provider
acceptance remains unverified. No test-user allowlisting,
verification submission, warning bypass or live Mail read has occurred. The prior
persistent-host activation decision remains separate and unanswered.


### Alternate-only route without an operator key

The owner withdrew operator-document access. Use `npm run dev:google-session`
with `OPENJOB_GOOGLE_MAILBOX` set to the explicitly approved alternate address.
This separate local runner uses existing public preview Firebase configuration,
listens only at `http://127.0.0.1:5202/mail-session`, and never imports the portable
runtime, Firestore stores, service-account configuration or a credential loader.
It uses ordinary Google/Firebase sign-in in a separate memory-only Firebase app,
preserving the existing saved app session. Then the person separately connects
Gmail and explicitly reads once. The existing persistent and integrated session
routes keep their saved OpenJob User checks unchanged.

The local route cryptographically verifies the Firebase ID token for the exact
nonproduction project, then sends only `{ idToken }` to the provider's fixed
end-user `accounts:lookup` endpoint with the public API key. There is no admin
OAuth credential, target-UID/email lookup or other-user enumeration. It requires
one current account, matching UID, unique matching Google subject, and a present
valid revocation cutoff no newer than the authentication event. The primary popup
also supplies its short-lived Google ID JWT in memory. Official Google signature,
issuer and client audience verification plus exact subject, verified email, azp and
expiry checks bind the approved mailbox independently of Firebase’s optional
primary email fields. Provider metadata or a guessed address never authorizes it. Disabled/deleted/unlinked/revoked or unavailable accounts fail closed. The
first authenticated self identity pins the process; each lease also pins the
original authentication event. Current-account checks fence pending Mail reads.
The strict Google audience/scope/subject checks and ten-minute memory lease are
shared with the integrated implementation.

This route has no saved OpenJob User, Tasks, Workspace or agent capability. Its
opaque temporary owner identifier is internal, not a new saved account. It cannot
observe Firestore's OpenJob deletion-pending state; it does not replace or claim
the integrated route's saved-user deletion checks. It can reject current Firebase
revocation and account removal. No database permission, rule, IAM or security
setting changes are required. Google may retain its consent after local disconnect.

Live checkpoint, 20 October: the agent completed the bounded alternate-only read.
Supported native Edge control worked in the new local chat and confirmed existing
profile0003 and the selected Timothy account. Google showed its unverified-app
notice; Shane explicitly authorized continuing this exact read-only test. No
verification submission, allowlist, configuration or scope change was made. The
old launcher exited during the approval wait; port5202 was confirmed unused before
restarting the same reviewed key-free snapshot. Normal temporary sign-in and Mail
connection then succeeded. The six launcher/auth/reader/UI source files matched
merged PR116 at7452af06828383e8412f3de8013282add5083a88.

The agent clicked Read Mail once: the UI showed Read complete · 7 messages and
independent sanitized health changed mailReads from0 to1 with realSending false.
Then Disconnect Mail session cleared the view and showed Gmail access off plus
Disconnected from this Mail session. No message contents, tokens or live screenshots
were copied into artifacts. No Mail changes, sending, Calendar, operator/1Password
access or persistent credential storage occurred. Google may retain its consent.
This proves the standalone session's live read, not integrated saved-Workspace,
source-linked Task, reply, provider Calendar, native or release acceptance. WLK384
continues the configured-connection source-to-Task path using isolated fixtures.


## Connected OpenJob reply drafts (WLK385)

The configured connection path now extends a source Task to an authored OpenJob
draft. This is separate from the temporary standalone5202 Mail session. No real
saved-work onboarding, persistent provider access, provider writes or activation is
performed by this delivery; the existing alternate-only authorization remains bounded.

In the configured owner pilot, open the source-linked Task, plan/complete it normally,
then Open connected source Mail and Prepare reply draft. Review the verified From,
Reply or Reply all, To/Cc and subject; write Your reply and Save OpenJob draft. The
server honors a valid present Reply-To, otherwise From; sent messages target their
original recipients instead of self. Reply-all excludes the verified address and
cross-field duplicates, without inferring aliases or revealing Bcc. Standard Message-ID,
In-Reply-To and References values are retained for future threading; absent Message-ID
is shown honestly. Unsupported/malformed address or threading headers are unavailable.

Saved text/account/mode reopen after reload. Unsaved text stays during Workspace
module/context switching, with an unload warning; save before leaving this page.
A newer saved version or changed source plan cannot silently overwrite reviewed work.
Refresh to review; explicitly choose the saved text or keep your editor over the
reviewed version. Task deletion refuses unfinished reply edits until saved or
explicitly discarded. Saved drafts remain private after disconnect/Task deletion,
but cannot be read or saved without current source access. Recreate a Task from the
same source after an authorized reconnect to reopen its draft. A draft catalog and
full composition/editable recipients belong to later Mail work.

The existing client exposes the same operations:

```sh
node cli/openjob.mjs connections reply <workspace-id> <task-id>
node cli/openjob.mjs connections reply-save <workspace-id> <task-id> --input <reviewed-json-file>
```

Save JSON contains only `mode` (`reply` or `reply-all`), authored `body`, the returned
`expectedRevision` (saved draft revision, or0), and returned `reviewToken`. The server
derives addressing/source/account; client-supplied From, recipients or source IDs are
rejected. Same-body/envelope retries return the current saved record; differing stale
text conflicts. API path: `/api/v1/connections/task-sources/{workspaceId}/{taskId}/reply`
(GET preparation, POST save). Agents cannot access these operations. Private drafts
stay outside ordinary Task/Calendar projections, offline sync, Home and agent responses.

20October isolated supported-browser proof completed invented Mail -> reviewed Task
-> saved local planning -> completion -> source -> reply-all -> authored save/reload.
Unsaved Calendar navigation, deletion guard/discard, owner isolation and disconnect
were also exercised. Focused API/CLI proof covers both home types and reconnect,
concurrency/stale-plan/revocation. This does not prove the integrated live R33 journey,
provider Calendar/send, native/device use or release. No real messages or credentials
were persisted, and the existing disconnected Timothy session was preserved.


## Configured Gmail pages (P-WLK-6 / R32)

Configured Connections Mail now offers Next page and First page. Each request
replaces its bounded page; edited Task titles stay in memory while paging inside
the same mailbox. Finish confirming any pending Task request before changing pages.
An unavailable cursor clears the old bodies and offers a first-page restart.
The existing client also accepts `openjob connections mail <id> --cursor <nextCursor>`;
omit the cursor to read the first page. Cursors stay bound to the verified owner,
account and Google subject. Simulated onboarding and the one-read standalone
Mail session do not accept this paging input. This is synthetic connected-flow
proof, not another real-account read or authorization for integrated activation.

The Mail folder picker uses this account's returned Gmail labels; labels can overlap.
Selecting one starts page one. Next/First page retains that filter, and edited Task
titles stay in memory across label changes. Missing labels offer All Mail recovery.
Spam/Trash are included only when explicitly selected. Existing source-linked Tasks
and replies remain attached to their exact message even if its labels move.
CLI: add `--folder <page.folders[].id>` and reuse only the nextCursor from that same
folder; omit both options to return to All Mail. Old cursors require a first-page
restart. Folder input is configured-Google only and adds no provider permission.


Search Gmail accepts a submitted Gmail query within the selected account and folder.
Edit the field, then choose Search Mail; changing text alone leaves Next/First on
the applied query shown below it. Submission and Clear search start page one;
changing folders retains the applied query. Rejected queries clear old bodies and
ask for edit/clear; no unfiltered fallback occurs. Finish confirming any pending
additional Task before changing search or navigation. Authored Task titles remain
in memory through query changes, and saved Task source/reply links keep their exact
message independently of the current search.

CLI: `openjob connections mail <id> --search 'subject:proposal'` accepts the same
optional `--folder <page.folders[].id>` and matching `--cursor <nextCursor>`.
Only outer whitespace is trimmed; Gmail receives operators, case and Unicode as
entered. Search must be nonblank, at most512 JavaScript characters, with no control
characters. Canonical gm3 cursors bind a query hash and selected folder; old or
mismatched cursors require a first-page restart. Query text is transient and is not
stored in connection records or cursors. Search remains configured-Google only.
The local fixture recognizes explicit invented query examples, not Gmail's complete
parser. This is synthetic connected-flow proof; the completed alternate-only real
read does not establish integrated live search or saved-work acceptance.


Configured web browsing now starts with message summaries, without bodies or snippets.
Choose Read message to fetch one bounded plain-text body; Close message, paging,
folder/search changes or disconnect clear the opened body. Opening and closing keep
the authored Task title and created-Task link. An unavailable body leaves its row and
Task usable; uncertain additional Task confirmation blocks body opening/navigation.
Only inert plain text is displayed: HTML, attachments and remote images are not loaded.

API: `GET /api/v1/connections/{id}/mail?view=metadata` applies the same existing
cursor/folderId/search inputs but omits body from each message. The existing request
without view retains its full-message response for current native/clients. Explicit
`GET /api/v1/connections/{id}/mail/{upstreamId}` accepts no queries, rechecks the current
home/account/credential and returns one full safe message. A deleted message returns
redacted message_unavailable404 without deleting its Task. Task-source/reply reads
retain their exact source identity independently of current labels/search.

CLI: `openjob connections mail <id> --metadata-only` and
`openjob connections message <id> <page.messages[].upstreamId>` use those same paths.
The new browser path and Task creation request metadata from Gmail; Task creation no
longer loads a body as a side effect. Existing full-read clients remain eager until
their own controls move to explicit reads. Bodies stay transient; this fixture proof
does not establish sync, metadata expiry, live integrated or native lazy acceptance.


## Configured Mail freshness and pending work (P-WLK-6 / R32)

Metadata-view responses include freshness.observedAt/staleAt/expiresAt. Observation
starts before the provider scan; stale is at most60seconds and expiry at most5minutes,
capped by current credential expiry. These bounds describe observations, not access.
Every body/Task/refresh request still checks current authority. Full Mail/native and
standalone-session DTOs remain unchanged. CLI --metadata-only prints the same bounds.

The web shows Last read and stale/unavailable state. Keep the first page refreshed
checks only the visible first page, sequentially at most once per minute, and pauses
while hidden/offline, reading a body, confirming a Task or viewing a later page.
Uncheck it to stop. Any failed read stops automatic refresh and hides content; Refresh
Mail is an explicit retry using applied search/folder. Invalid cursors restart page
one. A deleted folder offers Read All Mail while preserving the applied search.
Metadata and opened bodies expire on either elapsed wall or monotonic time; checks
also run on interaction/visibility restoration. No body or metadata disk cache.

Pending Mail Tasks keeps only reviewed titles, target references, exact request IDs
and receipts in the current owner’s Connections memory. Refresh remains available
during uncertainty, and retry keeps the same frozen title/request. Confirmed retries
clear pending state. Check Workspace opens another tab so Connections can stay open.
If access/source cannot recover, Stop retrying this request asks for explicit Forget:
a Task may already exist, no saved work is undone, and the reviewed title remains.
Leaving Connections, reloading or signing out clears this ephemeral authoring state.
This is fixture/browser proof, not complete sync, live integrated or native acceptance.

## Read Mail inside a Workspace (P-WLK-6 / R20–R33)

21October2026, sourcec4e5f09e7e093714899c98e890f96835101b58e7: the signed-in owner
pilot has a **Mail** module inside each opened Workspace. Open Mail, then explicitly
open one of that Workspace's assigned accounts. An account with another fixed
resource home does not appear. Empty, disconnected, expired and unavailable states
remain honest; no example messages replace a real empty or blocked account.
Manage Connections remains the place for setup, consent, refresh and disconnect.
This adds no provider capability, real-account admission or persistent access.

Use the same folder/search/page controls and explicit Read message action described
above. Review a title, create/find its source Task, then choose Open created/existing
Task to stay in `/workspaces`. Save notes, plan and complete it, open its fresh source,
review the verified Reply/Reply all addresses, and save an authored OpenJob draft.
No message is sent and planning creates only an OpenJob Calendar block.

In this surface, reviewed titles, receipts and uncertain additional-Task request
IDs stay in the retained owner/Workspace session through module and Workspace
switches. Pending Mail Tasks belongs only to that Workspace. Check this Workspace
opens its Tasks in the same shell; confirm keeps the frozen title and request ID.
No retry is automatic. Leaving Workspaces, reloading, changing identity or signing
out clears this memory. This is not durable draft storage; saved Tasks and OpenJob
replies still use their existing authoritative repositories.

Switching away disposes the Mail reader and its provider metadata/body/timers.
Returning checks connection status again and requires opening the assigned account.
Authored reply text survives and requires fresh source/address review before saving
after a switch. A late Mail response cannot restore another context's view.

Synthetic headed browser proof completed Mail→Task→notes→plan→complete→fresh source→
saved Reply all without leaving `/workspaces`. It verified A→B→A authoring retention,
the same uncertain request UUID/title on explicit retry, an empty other Workspace,
no hidden polling over65seconds, delayed-body suppression, central disconnect and
denied source reads with Task/block/reply retained, plus second-owner denial.
Phone390/half768/desktop1200 fit; Mail buttons are at least44px tall. Evidence:
`output/playwright/r33-workspace-mail/`. This does not close integrated live or
native acceptance, full sync, provider Calendar or sending.
