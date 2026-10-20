## Explicit portable Google configuration (WLK318)

The portable runtime can now compose the encrypted store/Google flow through
explicit injected transports and selected User/Google-binding/mailbox inputs.
A bounded secret-file loader and optional Compose overlay prepare later setup;
defaults remain disabled with no Google files read. No real key/configuration,
Workspace mapping/admission, grants, deployment or worker activation occurred.
See [portable configuration](docs/PORTABLE_SERVICE.md#optional-google-configuration-preparation).

## Resume an approved npm artifact

A separate local resume command verifies the one recorded WLK307 owner approval,
original tarball bytes and source ancestry from a clean current-main publisher.
It preserves registry owner/channel/rollback checks and stops after an uncertain
write. A read-only check prepares the handoff without touching npm authentication.
Normal releases still require current source and their own exact approval.

## Disabled encrypted Google store (WLK318)

Private Google connection envelopes now have a concrete Firestore REST CAS backend
with injected nonextractable AES-256-GCM key, owner/document/version authentication,
active-user write fences and bounded encoded size. Expired pending secrets can be
explicitly cleaned. Synthetic tests cover reconstruction, corruption, isolation,
CAS and uncertain commits; live durability is not claimed. No runtime binding,
secret loader, deployed collection, provider activation or active deletion hook.
Local disconnect-all and exact pending-deletion cleanup now strip current private
material, with an optional uninjected deletion-worker hook. Injected previous keys
can decrypt old records; explicit CAS re-encryption writes only with the current
key. Synthetic tests cover in-flight suppression, lost delete response, request
replacement and key retirement denial. No live key rotation/deletion/provider revoke.
`npm run test:google-local` now exercises the shared application, encrypted store
and existing CLI over an ephemeral loopback server with synthetic identity/provider
responses and encrypted snapshot reconstruction. No live/browser consent proof.
See [private store and activation limits](docs/providers/PRIVATE_GOOGLE_STORE.md).

## Disabled Google connection lifecycle (WLK334)

Address + explicit home, authenticated callback/state consumption, private atomic
promotion, refresh, Mail read and same-home/subject reconnect now compose through
existing Connections API/UI and the official adapter. All provider effects are
invented in HTTP tests; normal roots remain unconfigured503. Private persistence
is an injected contract, not activated storage. No send/provider Calendar/revoke
operation. [Actual evidence and remaining setup](docs/providers/GOOGLE_CONNECTION_FLOW.md).

## Disabled Google protocol adapter (WLK332 draft)

Private server-only authorization URL, official-library code exchange/signature
verification and explicit refresh adapter; tests use fake transports and invented
signed tokens. Default-disabled, no real composition/route/storage activation.
Existing broker entry shape retained; project-wide Google revocation remains an
explicit owner decision and has no adapter method. Live orchestrator and exact
callback/runtime configuration remain pending. See
[adapter evidence and activation limits](docs/providers/GOOGLE_OAUTH_ADAPTER.md).

## Connections onboarding contract (WLK331 draft)

Account-level Connections chooses an invented Gmail account and explicit owned
Workspace resource home, reviews simulated read-only consent, cancels, reads Mail,
disconnects and reconnects the same subject/home. UI/API/CLI share the application;
normal runtime remains unconfigured503. Durable lifecycle metadata and cleanup
intent exclude tokens; fixture OAuth/credentials remain ephemeral. Provider Calendar,
real OAuth/refresh/vault setup and live source-linked Tasks are not supplied by this
slice. UI behavior is unverified; draft remains unmerged. See
[Connections evidence and limits](docs/providers/CONNECTIONS.md#wlk331--simulated-connections-application-draft).

## Find saved Calendar time for a Task

Calendar offers open slots across all saved owner calendars for an open Task,
with an explicit UTC window (up to seven days) and duration (5–480 minutes).
The person chooses a suggestion; `task.schedule-available` rechecks current saved
blocks inside the atomic mutation and rejects a newly occupied slot without
moving the Task. A verified existing Task block is excluded during rescheduling.
The existing CLI exposes the same calculation with `workspace availability`.
This human-only flow checks saved OpenJob blocks, including Calendar-file imports;
it does not read live provider calendars or book external events. Manual
scheduling remains available. [Usage](docs/PERSONAL_WORKSPACE.md#find-time-for-a-task).

## Saved packaged local workspace

The npm-installed prototype accepts `openjob app --state-file PATH`. Saved
synthetic owner identities, Tasks/linked Calendar, invented Mail/drafts, grant
hashes/revocations and sync receipts survive restarts in bounded private,
unencrypted JSON. Atomic saves precede success; one writer owns each file and
invalid files fail without reset. Session signing keys/tokens and provider vault
material are excluded. Default mode remains temporary and actual sending remains
disabled. See [installation and recovery](docs/NPM_INSTALL.md).

# Features

## Packaged npm workspace

`npm run app:pack` builds the actual personal workspace, local synthetic API and existing CLI into an installable `@scwlkr/openjob` tarball (the executable remains `openjob`). `openjob app` runs it without a checkout; `openjob updates` and automatic notice-only checks retain the artifact’s latest/dev channel. Artifact-only CI maps published stable releases to latest and exact main source to timestamp/SHA dev versions. Registry publication and ownership setup remain pending. See [npm installation](docs/NPM_INSTALL.md).

## Authenticated personal workspace

`/workspace` uses the existing Firebase session and `/api/v1/workspace` for owner-private Tasks and an OpenJob Personal Calendar. The existing Group app links to it from the User menu. Create, edit, schedule, complete, unschedule and delete personal Tasks; linked Calendar changes stay atomic. The Firestore REST adapter stores one validated owner document with compare-and-set and active-user/deletion fences; the current bounded record limit is 900 KB. Account deletion removes the private workspace before finalizing identity deletion. Existing `openjob workspace snapshot` and `openjob workspace command --input FILE|-` use the same authenticated API. No fixture identity header selects an owner.

The Mail tab explicitly enables three invented mailboxes and six messages in the same owner-private document. Search/read, create a linked private Task, schedule/complete it and save/edit a reply through the shared API/CLI. Drafts and local Simulated Sent persist; activation preserves existing state. Mail agents have seven available scopes across five named resources, including separate read, draft and simulated-send rights on specific example mailboxes. Actual sending always denies. Personal Tasks share status/title/planned-UTC-day filters with `openjob workspace tasks`; midnight overlap is explicit and unscheduled work is excluded only when a planned day is selected. Existing scoped snapshots retain redaction and revocation. Calendar navigation clears hiding Task filters while preserving edits. Calendar blocks offer Open linked task only for an exact visible owner/calendar/event/Task relationship; it focuses the Task for editing, completion or source-Mail access. Unsaved Task titles, new-task text, schedule fields and Calendar editor state survive tab navigation and clear on identity changes. Private Tasks expose Open source mail only for the exact visible owner/account/message pair; it selects that mailbox and Inbox, clears hiding filters and focuses the reader. Mail shows the exact selected message’s linked private Tasks, including completed work; opening one clears hiding Task filters, focuses that Task and keeps unfinished editors. Creating another Task stays explicit. Unsaved replies stay per message, and composition/editor text survives navigation. One Mail editor stays active until saved or explicitly cancelled; Compose/Edit cannot replace its text, and its saved draft cannot be simulated while editing. Cancel is unavailable during a pending save. Provider preview stays separate and read-only; Group Tasks receive no mailbox references.

Mail in this entrypoint uses a visibly synthetic, owner-isolated provider read adapter behind the authenticated API and CLI. Stable account-qualified references, message pagination and explicit sync/capability states prepare the connector boundary. The UI selects accounts and reads provider example Calendars separately from the saved OpenJob Calendar; example-to-Task saves only its title, never a provider mailbox link. Personal agents use separate hashed opaque credentials with explicit Mail/Task/Calendar scopes and resources, 24-hour expiry, stable audit IDs and revocation fenced through the same durable document. Existing CLI issues a private 0600 token file; the app lists effective access and revokes grants without displaying secrets. Group read-only grants do not authorize personal data. Signed synthetic identity/fake Firestore tests verify the adapter and HTTP clients. No live database/auth/provider integration or deployment was exercised. Gmail REST message/label reads, Outlook Graph text/folder reads and bounded IMAP Inbox reads are implemented with closed execution gates and invented transport proof. IMAP uses read-only EXAMINE, UIDVALIDITY-qualified message identity, UID paging and BODY.PEEK literals; it supports a limited plain-text subset, not live TLS/login, arbitrary folders or conversation reconstruction. See [the IMAP boundary](docs/providers/IMAP_READ.md). An owner-bound connection reader and private credential-broker interface now exercise those mappers through the same API/CLI/app with explicit mock accounts in the isolated HTTP harness; consent, expiry, revocation, identity changes and broker-reference changes deny reads. A separate Firestore metadata repository and injected token-vault broker support owner/revision checks, stale-write rejection and revocation over synthetic transport. No real vault is provisioned. A Google-only server mock OAuth lifecycle binds new-account state/PKCE/nonce and provisions invented vault data before exact-reservation approval; it is not a configured callback or real identity verifier. An optional bounded Firestore transaction adapter proves one-use state consumption across reconstructed instances, erasing PKCE material while retaining spent hashes until expiry; it remains unbound from production. Production has no configured reader/store/broker or live mode. The API/CLI/app expose their not-connected and read-approval-required status separately from synthetic accounts; no live connection, token input or enable control exists. See [the personal workspace guide](docs/PERSONAL_WORKSPACE.md).

## Portable Node service and local Compose

The app tarball also includes `openjob server`: real Firebase sign-in UI and the
existing identity/personal-workspace/agent APIs through shared application composition,
without Cloudflare-specific runtime imports. Missing Firebase inputs show setup and
API503; service mode has no synthetic-session endpoint or automatic fixture fallback.
Provider connections/sending remain unconfigured. Configured-input readiness is not
proof of live Firebase access. Legacy Group/admin/release service parity is not claimed.

Local Compose builds the real assets/package for Linux with separate `demo` and
`service` profiles and loopback-published ports. Demo state uses its own named volume;
actual local Linux-container primary flow and restart are verified with invented data.
`server:bundle` packages portable assets/Compose and a hash receipt for later target-side
image build. No purchased/deployed target, credentials or publication is implied.
See [portable setup](docs/PORTABLE_SERVICE.md).

## Integrated workspace prototype

`npm run dev:workspace` opens `/workspace`: simulated Gmail/Outlook/IMAP Mail, Calendar, personal Tasks and scoped agent controls backed by one persistent local HTTP service and shared domain/CLI. Read/compose/save drafts, turn mail into a private Task, schedule/complete work, edit/delete calendar blocks, inspect resource-limited agent access and revoke it. Mail has Inbox, Drafts and Simulated Sent folders with mailbox-aware counts and case-insensitive subject/people/body search. Calendar has Agenda/Day/Week views, UTC date navigation and calendar filtering; edits retain their original calendar. Scoped simulated agents can attempt actual personal Task creation through the shared API, with visible allowed/denied results and immediate revocation. Personal Tasks support title edits, schedule editing, unscheduling and confirmed deletion; linked Calendar blocks stay consistent and source Mail stays intact. The one-command --fresh launcher seeds an isolated demo without credentials and preserves existing saved work. Owner views are isolated. Real sending is always disabled. Saved drafts can be reopened/edited without changing their mailbox; explicit Simulate send moves them into local Simulated Sent. Agents need a separate simulation capability as well as draft access; this cannot enable actual delivery. This is fixture-only application behavior; provider OAuth/sync and new production authentication are not implemented. The authenticated native personal workspace uses this same API; its Mail remains invented and online-only. See [the demo walkthrough](docs/WORKSPACE_DEMO.md).

- **Brand foundation:** `docs/brand/index.html` is the offline guide for the OpenJob overhaul. It includes the supplied reference board, eleven editable SVG masters, scoped light/dark CSS tokens, local Inter font/license, type and voice guidance, and labeled interactive product concepts. The web, iOS, and Android apps adopt this identity through shared generated assets, semantic colors, local Inter, browser/install/adaptive icons, and splash artwork. `AGENTS.md` points future UI work to the brand standards; `npm run brand:check` guards generated asset freshness.

## Task scheduling slots

CLI tables preserve optional fields found in later rows, including scheduled slots and due dates, with blank cells for missing values. JSON/JSONL shapes remain unchanged.

The shared Task API and CLI accept an optional planned work interval independently of the date-only due date. Explicit time zones normalize to UTC; both endpoints are required, end follows start, and clearing the slot preserves the Task and due date. Existing membership and completed-Task rules apply. This stores an OpenJob plan; it does not create provider calendar events. The web editor creates, edits and clears slots with explicit UTC inputs; Task cards show the interval in UTC, including an accessible description. Validation, network failure and authentication recovery preserve the entered interval. Native Group Tasks remain read-only; personal Tasks have separate scheduling controls.

## Scoped agent Task reads

A signed-in human can issue, list and revoke a named agent grant through `/api/v1/agent-grants`. Each opaque credential permits only Task list/item GETs in one current Task Group for 24 hours. The service stores its hash, binds it to the owner's membership generation, and rechecks access before returning data or a conditional 304. Revocation, expiry, account deletion and membership loss/rejoin stop access. Grants cannot modify Tasks, administer Groups, read other APIs, Mail or Calendar. Account deletion removes owned grant records. Owner management UI and broader scopes remain future Linear work.

Human CLI `agent grant` issues the existing fixed-scope grant to a new private mode-0600 token file; only public metadata is printed. Explicit Group/name/path are required, overwrite and stdout token delivery are rejected, and failed delivery identifies the grant for revocation. Issuance does not retry transient/ambiguous failures. `agent list` and confirmed `agent revoke` use the same human profile and owner-only API.

The existing CLI accepts an explicit `--agent-token-file <path|->` on `task list` and `task show`, together with explicit `--group`. It never refreshes or falls back to human credentials for these reads. Isolated API/Firestore/CLI fixtures verify behavior; no production grant is created by development checks.

### Native personal workspace

The signed-in Expo app starts in Personal Today and opens personal Mail, Tasks, Calendar and Agents while retaining Existing Groups. Today uses the device-local day and timezone to join saved Calendar blocks, planned open Tasks and unscheduled work, with exact Task/block navigation. Its saved-on-device mode includes pending changes without loading Mail; timer and foreground return update the date. Opt in to invented mailboxes, read/search/mark messages, create private Tasks, edit/complete/schedule/unschedule/delete them, and open their exact Calendar/source Mail links. Mail can reopen its owner-qualified linked Tasks, including completed work. Native Tasks can edit or clear authored notes online and in the saved offline workspace; unfinished notes survive module switches and failed saves, with confirmation before replacing another Task’s edits. Compose/edit reply drafts and simulate sending; actual delivery remains disabled. Review effective agent permissions/activity and confirm revocation; issuance stays in the existing CLI. Unsaved editors survive module/Group navigation and clear on identity changes. Existing Firebase sessions authenticate every operation; no token entry or Mail disk cache. Personal Tasks/Calendar now have encrypted offline edits, explicit sync and conflict review; Mail remains online-only. Live providers and device acceptance remain unimplemented or unverified. See [the personal workspace guide](docs/PERSONAL_WORKSPACE.md).

### Offline personal Tasks and Calendar

The native saved-on-device workspace persists a Tasks/Calendar projection and pending batch in a separate durable SQLCipher database using the existing device-only keychain boundary. Reopen without a Group cache, edit offline, reconnect and explicitly sync. Whole-domain revision checks protect newer server edits; conflicts show local/current work and require confirmation. Repeated lost-response operations are idempotent, and older acknowledgements cannot clear queued newer edits. Mail, source references, grants and credentials stay out of this cache; online Mail and linked work remains available separately. Logout/revocation clears private local work. No automatic field merge or background sync. Device storage/rendering acceptance remains unverified.

Web **Saved Tasks and Calendar** reuses that shared controller/API with completed IndexedDB writes, UID+tenant owner binding, whole-operation Web Locks, stale-editor rejection and cross-tab purge. Explicit public-shell preparation enables offline reload in the credential-free built demo; production Firebase/Vinext offline bootstrap remains unverified. Optional separate Mail recovery retains only authored unfinished text through offline reload and restores it after reconnect, never an inbox or API response. Browser storage is origin-local and not app-encrypted; CLI remains online-only. See [fresh-checkout demo steps](docs/WORKSPACE_DEMO.md#fresh-checkout-browser-offline-demo).

Calendar files provide provider-neutral exchange without a provider connection. Download a selected Calendar’s blocks and scheduled Tasks as an iCalendar file; preview a local supported file and explicitly confirm import as standalone blocks. Opaque stable UIDs, UTC times, escaped/folded titles, atomic revision checks and durable duplicate detection preserve existing work. Import requires Calendar read/write access; export requires read. Changed duplicate UIDs conflict without overwriting records or Task links. The bounded subset accepts up to 50 timed UTC events / 16 KiB and rejects recurrence, local/all-day times, invitations, alarms, URLs, attachments and unsupported properties. This is file transfer, not provider synchronization or sending. [Guide](docs/PERSONAL_WORKSPACE.md#calendar-file-exchange).

Local npm distribution uses `npm run npm:prepare -- dev|latest` and a separate explicitly approved `npm:publish` command. Preparation checks, packs and clean-prefix runs real assets/API; publication reuses existing npm authentication and exact sealed bytes. Actions artifact generation is manual-only, with no automatic push/release publishing or new access. See [local release](docs/NPM_LOCAL_RELEASE.md).

Personal Today shows browser-local planned/open work and Calendar blocks from the current private snapshot. Exact-item navigation clears destination filters, focuses the selected row and preserves unfinished module editors. Calendar editing stays UTC; this is not the proposed cross-Workspace Home.

Personal Task notes retain authored context through title edits, planning, completion
and explicit offline sync. The web editor supports save/clear and preserves failed
or unfinished edits during module navigation. Existing scoped Task authorization
and plain-text rendering apply; notes never enter Calendar titles or activity text.

### Independent owner-only Workspace foundation

The local `dev:owned-workspaces` fixture composes the real Workspace repository,
API and web shell. One synthetic human creates and switches independent owned
Workspaces, each with distinct Task-space/Calendar IDs and separately persisted
Task/planning state. Shared Task/Calendar controls retain unfinished editors in
context and maintain linked scheduling; foreign owner/item/resource requests fail.
Mail, invitations, grants and owner transfer remain unavailable. This is a bounded
fixture-verified foundation, not enabled real-account Workspace onboarding or
native/offline parity. [Pilot guide](docs/OWNED_WORKSPACE_PILOT.md).

The Workspace fixture can explicitly map retained Personal work to a stable opaque
Workspace reference under the same existing User. Task/event IDs and authored work
remain in the existing Personal authority; context adapters translate Calendar IDs
and exclude source Mail metadata. Mapping is idempotent and neither copies data nor
rewrites Sign-in Methods, grants or offline caches. WLK328 composes the normal `/workspaces` app and shared server runtime behind an
unconfigured exact User/provider/UID gate. Only the synthetic `/pilot` harness
selects an admission binding. Real onboarding remains inactive; D06 classification
and employer-isolation guarantees remain future WLK327 policy, not a prerequisite
for this limited pilot engineering default. No linked binding inherits admission.


### Authorized Workspace Home

Normal `/home` and the Workspace shell provide a labeled read-only overview of
owned open Tasks and upcoming7-day OpenJob Calendar blocks, including explicitly
mapped Personal. A bounded server projection excludes notes, Mail/unread counts and
grants; failed reads/refresh clear summaries. Item actions enter an exact qualified
Workspace/Task/block; history/reload retain destination and per-Workspace unfinished
editors survive context switches. Current owner/admission is rechecked, and actual
runtime admission remains unset. This is source plus synthetic normal-session
proof, not live account access, shared membership/native parity or provider Home.
