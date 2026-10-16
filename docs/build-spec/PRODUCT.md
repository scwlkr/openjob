# Product requirements

**Detailed requirements Proposed under the [owner-confirmed core](../ARCHITECTURE_ALIGNMENT.md).** Confirmed Workspace/owner/grant/Connections/agent/Home/no-hosted-Mail decisions govern conflicting earlier wording; unrelated scope, fields and technical defaults still await review. IDs are stable traceability anchors, not issue IDs. “Core” is the complete in-scope product outcome, delivered through several slices; it is not a claim that the prototype already implements it. The first live pilot is deliberately smaller than that full outcome. Later required capabilities are specified below, not left as an indefinite wish list.

## Product promise and intended user

OpenJob gives a person and their separately authorized agents a coherent place to handle Mail, Calendar and Tasks across existing provider accounts and explicitly owned personal/company contexts. A useful human app works without an AI subscription. Initial pilot fit is an independent professional or small organization able to authorize its own accounts, including people working in several companies. That segment and value proposition are hypotheses to test, not demonstrated demand.

A company is a Workspace, with one accountable human owner, internal groups/permission sets, explicit resource grants and membership/departure. There is no separate Company → Workspace hierarchy. Google Workspace/Microsoft 365 are analogies for company-level organization, not an instruction to recreate their office suites, identity administration or storage products.

## Core scope

| ID | Requirement and exact boundary | Completion evidence |
|---|---|---|
| OJ-I1 | Stable personal User across independent Workspaces; independent authentication/recovery and one initial Personal Workspace remain proposed details; no email-based identity merging | Fresh proof links only intended User; Workspace administration cannot recover another person’s identity |
| OJ-I2 | Create/join a Workspace (a company is a Workspace); exactly one human owner; invitations select resources/actions; internal groups/permission sets | Three people/two shared Workspaces prove independent memberships and explicit access; role presets remain Proposed |
| OJ-I3 | Resources have one home Workspace and remain attached through human-owner changes; every action selects one context with server-side grants/query checks | Foreign-context IDs fail through UI/API/CLI; Home shows only labeled authorized tasks/events/unread counts and opens actions in their Workspace |
| OJ-I4 | Suspend/depart members; single owner transfers to another member with recipient acceptance before leaving; reassign work and revoke derived grants | Owner stays accountable until accepted transfer; resources stay; departure from A leaves Personal/B intact |
| OJ-I5 | Explicit collaboration on named Workspace resources through individual/internal-group grants; no automatic access for a member’s other Workspaces | Invited collaborator sees only selected work; group/Workspace membership does not expose restricted Mail |
| OJ-C1 | Central account-level Connections lists only manageable provider bindings; mailbox/calendar resources have selected home Workspaces; multiple accounts including two of one provider | Central UI grants no global access or master ownership; same-provider identities/resources remain distinct |
| OJ-C2 | Capability- and consent-aware connection status, reconnect, disable and disconnect; explain unavailable features | Canceled consent, expired token, missing scope and revoked connection each yield useful honest UI/API state |
| OJ-C3 | Durable bounded synchronization, pagination, deletions, cursor recovery and visible freshness | Restart resumes; stale cursor resync deduplicates; revoked account stops credential resolution/queued work |
| OJ-M1 | Inbox/account/folder views, paged message/thread reading, account-scoped search, unread state and safe attachment download | Mail from multiple accounts can be read without changing identity; external HTML/scripts/remote images do not execute |
| OJ-M2 | Text-first compose, reply and reply-all with To/Cc/Bcc, subject, local saved draft and chosen verified sending identity | Draft survives navigation/reload; reply threading preserved where supported; identity remains visible |
| OJ-M3 | Explicit send with separately granted permission and durable status; provider accepted/rejected/unknown distinguished | Double submit does not create another intent; ambiguous network outcome never blindly resends; denial causes no provider call |
| OJ-M4 | Receive/download attachments and send user-selected files within advertised provider/app limits | MIME name/type/size validated; download authorization rechecked; executable content never auto-opened |
| OJ-M5 | Mark read/unread, archive and move to provider trash where supported; do not permanently purge | Writes reflect correct account/folder semantics and results; unsupported action fails before effects |
| OJ-T1 | OpenJob-owned tasks in Personal or a shared-Workspace task space: title, optional notes, open/completed, optional due date, optional priority and one assignee | Create/edit/complete/reopen/delete, filter/search and assignment work through shared app/API/CLI |
| OJ-T2 | Mail → Task keeps a typed private source reference; Task → source opens only with source permission | Same-source repeated creation offers existing task or explicit new task; shared task response reveals no private source metadata |
| OJ-T3 | Plan, replan and unschedule a task in an OpenJob block or explicitly selected external calendar | Local Task/block relationship is atomic; remote changes show pending/failed/unknown until reconciled |
| OJ-K1 | Calendar day/week/agenda with OpenJob blocks and authorized external calendars, displayed in selected time zone | Timed/all-day/recurring provider instances and DST boundaries display faithfully; stale availability labeled |
| OJ-K2 | Create/edit/delete OpenJob blocks; create/edit/delete non-recurring, no-attendee external work events with capability and authority | Correct calendar and revision; external write permissions checked separately from read/free-busy |
| OJ-K3 | Availability planning considers authorized busy intervals; suggestions never claim unseen calendars are free | Conflict identifies what can be disclosed; owner may choose explicit override; private sources remain private |
| OJ-K4 | Preserve current bounded iCalendar export/reviewed import; unsupported recurrence/timezone/file constructs explain rejection | Preview before import, collision/version handling, no silent lossy import or provider write |
| OJ-A1 | Externally connected agent authenticates as its own identity, with separate Workspace grants; no persistent Workspace-hosted agent | Same identity can connect across Workspaces without unioning grants; no human session/provider credential inheritance |
| OJ-A2 | Members delegate selected resource/action subsets of current rights where Workspace policy permits; reviewed mailbox-set membership | Read/draft/send/modify/delete separable; resource-set expansion cannot silently widen grants |
| OJ-A3 | Effective access/activity and independent per-Workspace expiry/revocation; queued dispatch rechecks current sponsoring rights | Revoke A blocks A effects before provider call while unrelated B grant remains valid; membership loss invalidates derived grants |
| OJ-A4 | App, existing openjob CLI and versioned API share operations/auth; useful JSON/JSONL, IDs, errors and pagination | Equivalent authorized request has equivalent result/receipt on each surface; CLI cannot bypass UI policy |
| OJ-X1 | Labeled authorized cross-Workspace Home, Workspace-scoped Today/Mail/Tasks/Calendar/Agents and settings, central authorized Connections | First-run useful task/block needs no provider; Home item enters correct Workspace; no blanket unified Mail/search or agent access |
| OJ-X2 | Explicit offline, pending, conflict, reconnect and uncertain-operation states; preserve existing personal offline capability | Offline edits reconcile or stay visible for review; nothing sends or connects providers offline |
| OJ-X3 | Accessible responsive web; semantic parity for native clients; verified platform-specific release gates | Keyboard/screen reader/touch flows and interrupted navigation tested; unsupported platforms honestly labeled |
| OJ-X4 | Data lifecycle, redacted activity, export, deletion and cleanup state follow ownership and policy | Disconnect hides source content, task survives with unavailable reference, cleanup failure remains visible |

### Required full-product extension after the first live loop

These are part of “build this,” staged after initial live-provider proof. They are not permanent exclusions or optional polish.

| ID | Requirement and boundary | Completion evidence |
|---|---|---|
| OJ-K5 | Calendar invitations and RSVP, with explicit attendee review, sender/organizer identity, update/cancel notifications and separate invitation permission | Authorized test attendees receive intended updates; retries do not duplicate invitations; read/edit permission alone cannot notify people |
| OJ-K6 | Create/edit/delete supported recurring series and individual exceptions, choosing this occurrence vs entire series; no unsupported “this and following” simulation | DST/time-zone exceptions, moved/canceled instances and concurrent provider edits round-trip without corrupting a series |
| OJ-X5 | Optional bounded offline Mail read/cache and shared-Workspace Task/Calendar editing on supported clients, with context isolation, secure local storage and visible access/conflict limits | Opt-in cache survives supported restart, lock/logout/disconnect cleanup works, revoked writes fail on reconnect and unsent drafts stay attributable |
| OJ-X6 | Full npm-installed authenticated app uses real service/provider capabilities and the same workflow as hosted web; fixture demo remains clearly separate. Automatic update checks notify; npm installs updates explicitly. `@latest` follows releases and `@dev` follows main-derived builds | Fresh install, login, two-context workflow, restart/update and uninstall/cache behavior tested; no mock result in real mode or silent auto-install |
| OJ-X7 | Verified iOS, Android, macOS, Windows and Linux distribution paths with feature/capability matrices | Named platform artifacts and runtime/device acceptance evidence; web availability alone is not called a native release |

Hosted server-side body retention is not necessary for the full product: on-demand provider retrieval plus provider search remains the default. Offline device caching is the deliberate extension. Broader hosted retention/indexing is an owner-reviewed data-policy change, not a requirement silently inferred from “full product.”

### Field semantics

Task title is required, plain text, 1–500 characters. Notes are optional plain text, capped at 20,000 characters. Status is open or completed; completion stores who/when. Due date is a date in the task's workspace time zone, not an invented midnight event; priority uses the existing Group contract's values rather than introducing a competing enum. One assignee is either the Personal owner or an active member with access to that task space; an agent can act on a task but is not its human assignee in first core. No automatic reassignment to the Workspace owner on departure: retain an unavailable former-assignee label and offer explicit reassignment.

Keep existing supported Group task fields/semantics. Personal/shared-Workspace Task adapters can present those fields consistently; do not drop useful Group behavior because the prototype Personal type is smaller. Task notes/attachments are not a document product; task file storage is excluded from first core.

A task has at most one active planning relationship in first core: an OpenJob block or a provider event, not both. Completing a task does not erase past/future calendar records or send a reply. Deleting/unscheduling a task removes its linked OpenJob block transactionally; for provider events ask for the explicit remote operation or preserve the event and detach. Never delete an unrelated provider event. Moving work between ownership contexts is excluded initially; an explicit title/notes-only copy with a reviewed destination may be added without copying private source data.

Mail search uses provider search when available, scoped to selected authorized connections; cached metadata search identifies its incomplete coverage. No server-side full-body index in the first live pilot. Folder/label semantics remain provider-specific. A thread is scoped to its connection; messages from two accounts are never silently combined. Reply quoting is off by default: preserve the separately authorized source reference instead of automatically copying provider text into a saved draft. Explicitly inserted/quoted text becomes reviewed draft content, follows the originating context and authored-draft retention, and must never be copied automatically into a shared task. Preview a selected attachment before sending; retain file bytes only for the pending authorized send, under the draft retention policy.

Export is bounded to selected authorized OpenJob Task/Calendar data: versioned JSON with ownership/IDs and supported iCalendar for blocks; authored drafts may be exported only by an authorized reader. It excludes provider secrets, hidden source metadata and an automatic full Mail archive. Workspace administrative preset alone cannot export restricted Mail. Account/Workspace deletion shows affected ownership and cleanup stages. Proposed account deletion-pending blocks ordinary work while permitting freshly authenticated transfer/approved closure; owned Workspaces resolve before account deactivation, so the sole owner is not stranded; provider Mail/Calendar deletion is never implied by deleting an OpenJob account.

## Provider capability target

| Provider family | First-core target | Honest exclusions / separate work |
|---|---|---|
| Gmail / Google Workspace | Mail read/search, drafts/send/attachments, labels/trash; Google Calendar read and bounded event writes | OAuth configuration and restricted-scope verification are actual rollout gates; Workspace admin provisioning and Google Tasks sync excluded |
| Outlook / Microsoft 365 | Graph Mail read/search, drafts/send/attachments/folders; Calendar read and bounded event writes | Tenant consent and shared-mailbox permissions vary; organization-wide app permissions and Microsoft To Do sync excluded initially |
| Purelymail / standards-based Mail | Verified TLS IMAP read/folders/flags plus authenticated SMTP send; MIME and attachments | IMAP does not imply Calendar. Connect another supported calendar or use OpenJob blocks. CalDAV is a later adapter only if a real provider/account supports it |

The core product targets all three families, but capabilities become available only after adapter, consent, runtime and conformance proof. First live milestone uses one authorized provider; subsequent milestones add the others and two accounts of one provider. A missing provider capability is visible, not simulated into apparent parity. No JMAP implementation is required without an actual target provider.

## Explicit non-goals for first core

Initial hosted Mail/domain routing (hosted inboxes are only a possible future product), provisioning provider employee accounts, documents/spreadsheets/chat/storage suites, generic agent execution/planning, AI model subscription, billing, marketplace, custom enterprise policy language, SAML/SCIM/enterprise directory, organization hierarchy, blanket cross-Workspace Mail/content/search or agent aggregation, external task-list two-way sync, recurring-task rules, task dependency graphs, rich-text email authoring, mass mail, delayed-send automation, permanent provider purge, legal-hold/eDiscovery, multi-region architecture and production local/self-hosted synchronization.

First-live-pilot limits, separately: no invitation sending/series authoring, no persistent provider-body cache and no shared-Workspace offline write expansion until their full-product slices pass. Calendar invitations/series and shared-Workspace/offline/native/npm experiences are explicitly in the later required scope above.

These can become explicit future decisions after evidence. “Not first core” does not authorize removing an already useful supported behavior; preserve it or document a deliberate replacement.

## End-to-end acceptance story

Proposed acceptance fixture: Alex has Personal, contribution rights in Workspace A and administration rights in B; Sam is the sole owner of A with no B membership; Jo is the sole owner of B and has named collaborator grants in A. Employee/Admin/Guest labels are proposed presets, not separately confirmed policy. Alex connects approved accounts in their declared contexts. Alex reads a message, creates a private source-linked task, schedules it in an explicitly chosen calendar, completes it and sends an authorized reply from the right identity. A narrowly granted agent can do its assigned subset through the existing CLI/API; denied source reads/send/admin actions make no external call. Sam’s owner status cannot silently read Alex’s restricted mailbox; Jo’s A grants give B nothing. Revoke the agent and depart Alex from A while work is queued: new A actions stop, A’s Workspace resources stay, Personal/B stay usable. Repeat the workflow across supported provider families and two accounts of one provider; show offline/conflict/unknown-send recovery honestly.
