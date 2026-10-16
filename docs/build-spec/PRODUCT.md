# Product requirements

**Proposed elaboration of the mission and PR #87.** IDs are stable traceability anchors, not issue IDs. “Core” is the complete in-scope product outcome, delivered through several slices; it is not a claim that the prototype already implements it. The first live pilot is deliberately smaller than that full outcome. Later required capabilities are specified below, not left as an indefinite wish list.

## Product promise and intended user

OpenJob gives a person and their separately authorized agents a coherent place to handle Mail, Calendar and Tasks across existing provider accounts and explicitly owned personal/company contexts. A useful human app works without an AI subscription. Initial pilot fit is an independent professional or small organization able to authorize its own accounts, including people working in several companies. That segment and value proposition are hypotheses to test, not demonstrated demand.

Company architecture is core: ownership, membership, roles, resource access and departure. Google Workspace/Microsoft 365 are analogies for company-level organization, not an instruction to recreate their office suites, identity administration or storage products.

## Core scope

| ID | Requirement and exact boundary | Completion evidence |
|---|---|---|
| OJ-I1 | Stable User with independent personal authentication/recovery and one Personal workspace; no email-based identity merging | Fresh proof links only the intended User; company context cannot recover or unlock Personal |
| OJ-I2 | Create Company, become initial Owner, invite intended verified people, accept/decline/cancel invitations; per-company Owner/Admin/Employee/Guest | Three people/two Companies fixture proves independent roles and invitation acceptance |
| OJ-I3 | Company owns workspaces/resources; every operation selects one context; grant and query checks apply server-side | Foreign-context IDs fail through UI/API/CLI; search and compose never bleed contexts |
| OJ-I4 | Suspend/depart members, transfer ownership to an active successor, reassign company work and revoke derived grants | Departure from A leaves Personal and B intact; last Owner cannot leave without successor |
| OJ-I5 | Guests collaborate on named Company task spaces/calendars; no cross-company shared ownership or automatic guest directory | Guest sees only assigned work/collaborators; Company B gains nothing from its employee's guest role in A |
| OJ-C1 | Connect multiple accounts, including two of one provider; destination ownership and upstream identity explicit | Two same-provider accounts retain distinct stable IDs, messages, send identities and source links |
| OJ-C2 | Capability- and consent-aware connection status, reconnect, disable and disconnect; explain unavailable features | Canceled consent, expired token, missing scope and revoked connection each yield useful honest UI/API state |
| OJ-C3 | Durable bounded synchronization, pagination, deletions, cursor recovery and visible freshness | Restart resumes; stale cursor resync deduplicates; revoked account stops credential resolution/queued work |
| OJ-M1 | Inbox/account/folder views, paged message/thread reading, account-scoped search, unread state and safe attachment download | Mail from multiple accounts can be read without changing identity; external HTML/scripts/remote images do not execute |
| OJ-M2 | Text-first compose, reply and reply-all with To/Cc/Bcc, subject, local saved draft and chosen verified sending identity | Draft survives navigation/reload; reply threading preserved where supported; identity remains visible |
| OJ-M3 | Explicit send with separately granted permission and durable status; provider accepted/rejected/unknown distinguished | Double submit does not create another intent; ambiguous network outcome never blindly resends; denial causes no provider call |
| OJ-M4 | Receive/download attachments and send user-selected files within advertised provider/app limits | MIME name/type/size validated; download authorization rechecked; executable content never auto-opened |
| OJ-M5 | Mark read/unread, archive and move to provider trash where supported; do not permanently purge | Writes reflect correct account/folder semantics and results; unsupported action fails before effects |
| OJ-T1 | OpenJob-owned tasks in Personal or a company task space: title, optional notes, open/completed, optional due date, optional priority and one assignee | Create/edit/complete/reopen/delete, filter/search and assignment work through shared app/API/CLI |
| OJ-T2 | Mail → Task keeps a typed private source reference; Task → source opens only with source permission | Same-source repeated creation offers existing task or explicit new task; shared task response reveals no private source metadata |
| OJ-T3 | Plan, replan and unschedule a task in an OpenJob block or explicitly selected external calendar | Local Task/block relationship is atomic; remote changes show pending/failed/unknown until reconciled |
| OJ-K1 | Calendar day/week/agenda with OpenJob blocks and authorized external calendars, displayed in selected time zone | Timed/all-day/recurring provider instances and DST boundaries display faithfully; stale availability labeled |
| OJ-K2 | Create/edit/delete OpenJob blocks; create/edit/delete non-recurring, no-attendee external work events with capability and authority | Correct calendar and revision; external write permissions checked separately from read/free-busy |
| OJ-K3 | Availability planning considers authorized busy intervals; suggestions never claim unseen calendars are free | Conflict identifies what can be disclosed; owner may choose explicit override; private sources remain private |
| OJ-K4 | Preserve current bounded iCalendar export/reviewed import; unsupported recurrence/timezone/file constructs explain rejection | Preview before import, collision/version handling, no silent lossy import or provider write |
| OJ-A1 | Agent is its own principal with personal/company controller and named managers; never human session or provider token | Credentials cannot authenticate as a human or another context; no upstream secrets in responses |
| OJ-A2 | Grant explicit task spaces/calendars/mailboxes or reviewed mailbox-set membership plus separate operations | Read, draft, send, modify and deletion are separable; resource-set expansion cannot silently expand existing grant |
| OJ-A3 | Show effective permissions and attributable actions; expiry/revocation stops new work, queued work rechecks | Allowed operation succeeds, forbidden operation fails before side effect, revoke-between-enqueue-and-dispatch denies |
| OJ-A4 | App, existing openjob CLI and versioned API share operations/auth; useful JSON/JSONL, IDs, errors and pagination | Equivalent authorized request has equivalent result/receipt on each surface; CLI cannot bypass UI policy |
| OJ-X1 | Stable context-aware Today/Mail/Tasks/Calendar/Agents navigation; Connections and company settings always reachable | First-run → useful task/calendar action succeeds without examples masquerading as account connection |
| OJ-X2 | Explicit offline, pending, conflict, reconnect and uncertain-operation states; preserve existing personal offline capability | Offline edits reconcile or stay visible for review; nothing sends or connects providers offline |
| OJ-X3 | Accessible responsive web; semantic parity for native clients; verified platform-specific release gates | Keyboard/screen reader/touch flows and interrupted navigation tested; unsupported platforms honestly labeled |
| OJ-X4 | Data lifecycle, redacted activity, export, deletion and cleanup state follow ownership and policy | Disconnect hides source content, task survives with unavailable reference, cleanup failure remains visible |

### Required full-product extension after the first live loop

These are part of “build this,” staged after initial live-provider proof. They are not permanent exclusions or optional polish.

| ID | Requirement and boundary | Completion evidence |
|---|---|---|
| OJ-K5 | Calendar invitations and RSVP, with explicit attendee review, sender/organizer identity, update/cancel notifications and separate invitation permission | Authorized test attendees receive intended updates; retries do not duplicate invitations; read/edit permission alone cannot notify people |
| OJ-K6 | Create/edit/delete supported recurring series and individual exceptions, choosing this occurrence vs entire series; no unsupported “this and following” simulation | DST/time-zone exceptions, moved/canceled instances and concurrent provider edits round-trip without corrupting a series |
| OJ-X5 | Optional bounded offline Mail read/cache and Company Task/Calendar editing on supported clients, with context isolation, secure local storage and visible access/conflict limits | Opt-in cache survives supported restart, lock/logout/disconnect cleanup works, revoked writes fail on reconnect and unsent drafts stay attributable |
| OJ-X6 | Full npm-installed authenticated app uses real service/provider capabilities and the same workflow as hosted web; fixture demo remains clearly separate. Automatic update checks notify; npm installs updates explicitly. `@latest` follows releases and `@dev` follows main-derived builds | Fresh install, login, two-context workflow, restart/update and uninstall/cache behavior tested; no mock result in real mode or silent auto-install |
| OJ-X7 | Verified iOS, Android, macOS, Windows and Linux distribution paths with feature/capability matrices | Named platform artifacts and runtime/device acceptance evidence; web availability alone is not called a native release |

Hosted server-side body retention is not necessary for the full product: on-demand provider retrieval plus provider search remains the default. Offline device caching is the deliberate extension. Broader hosted retention/indexing is an owner-reviewed data-policy change, not a requirement silently inferred from “full product.”

### Field semantics

Task title is required, plain text, 1–500 characters. Notes are optional plain text, capped at 20,000 characters. Status is open or completed; completion stores who/when. Due date is a date in the task's workspace time zone, not an invented midnight event; priority uses the existing Group contract's values rather than introducing a competing enum. One assignee is either the Personal owner or an active member with access to that task space; an agent can act on a task but is not its human assignee in first core. No automatic reassignment to the Company owner on departure: retain an unavailable former-assignee label and offer explicit reassignment.

Keep existing supported Group task fields/semantics. Personal/company Task adapters can present those fields consistently; do not drop useful Group behavior because the prototype Personal type is smaller. Task notes/attachments are not a document product; task file storage is excluded from first core.

A task has at most one active planning relationship in first core: an OpenJob block or a provider event, not both. Completing a task does not erase past/future calendar records or send a reply. Deleting/unscheduling a task removes its linked OpenJob block transactionally; for provider events ask for the explicit remote operation or preserve the event and detach. Never delete an unrelated provider event. Moving work between ownership contexts is excluded initially; an explicit title/notes-only copy with a reviewed destination may be added without copying private source data.

Mail search uses provider search when available, scoped to selected authorized connections; cached metadata search identifies its incomplete coverage. No server-side full-body index in the first live pilot. Folder/label semantics remain provider-specific. A thread is scoped to its connection; messages from two accounts are never silently combined. Reply quoting is off by default: preserve the separately authorized source reference instead of automatically copying provider text into a saved draft. Explicitly inserted/quoted text becomes reviewed draft content, follows the originating context and authored-draft retention, and must never be copied automatically into a shared task. Preview a selected attachment before sending; retain file bytes only for the pending authorized send, under the draft retention policy.

Export is bounded to selected authorized OpenJob Task/Calendar data: versioned JSON with ownership/IDs and supported iCalendar for blocks; authored drafts may be exported only by an authorized reader. It excludes provider secrets, hidden source metadata and an automatic full Mail archive. Company administrative role alone cannot export restricted Mail. Account/workspace deletion shows affected ownership, blocks new work first and reports each cleanup stage; provider Mail/Calendar deletion is never implied by deleting an OpenJob account.

## Provider capability target

| Provider family | First-core target | Honest exclusions / separate work |
|---|---|---|
| Gmail / Google Workspace | Mail read/search, drafts/send/attachments, labels/trash; Google Calendar read and bounded event writes | OAuth configuration and restricted-scope verification are actual rollout gates; Workspace admin provisioning and Google Tasks sync excluded |
| Outlook / Microsoft 365 | Graph Mail read/search, drafts/send/attachments/folders; Calendar read and bounded event writes | Tenant consent and shared-mailbox permissions vary; organization-wide app permissions and Microsoft To Do sync excluded initially |
| Purelymail / standards-based Mail | Verified TLS IMAP read/folders/flags plus authenticated SMTP send; MIME and attachments | IMAP does not imply Calendar. Connect another supported calendar or use OpenJob blocks. CalDAV is a later adapter only if a real provider/account supports it |

The core product targets all three families, but capabilities become available only after adapter, consent, runtime and conformance proof. First live milestone uses one authorized provider; subsequent milestones add the others and two accounts of one provider. A missing provider capability is visible, not simulated into apparent parity. No JMAP implementation is required without an actual target provider.

## Explicit non-goals for first core

Mail hosting/domain routing, provisioning provider employee accounts, documents/spreadsheets/chat/storage suites, generic agent execution/planning, AI model subscription, billing, marketplace, custom enterprise policy language, SAML/SCIM/enterprise directory, organization hierarchy, automatic cross-company aggregation, external task-list two-way sync, recurring-task rules, task dependency graphs, rich-text email authoring, mass mail, delayed-send automation, permanent provider purge, legal-hold/eDiscovery, multi-region architecture and production local/self-hosted synchronization.

First-live-pilot limits, separately: no invitation sending/series authoring, no persistent provider-body cache and no Company offline write expansion until their full-product slices pass. Calendar invitations/series and Company/offline/native/npm experiences are explicitly in the later required scope above.

These can become explicit future decisions after evidence. “Not first core” does not authorize removing an already useful supported behavior; preserve it or document a deliberate replacement.

## End-to-end acceptance story

Alex owns Personal, is Employee in A and Admin in B; Sam owns A and has no B membership; Jo owns B and is Guest in one A task space. Alex connects approved accounts in their declared contexts. Alex reads a message, creates a private source-linked task, schedules it in an explicitly chosen calendar, completes it and sends an authorized reply from the right identity. A narrowly granted agent can do its assigned subset through the existing CLI/API; denied source reads/send/admin actions make no external call. Sam cannot silently read Alex's restricted mailbox; Jo's guest role grants nothing to B. Revoke the agent and depart Alex from A while work is queued: new A actions stop, A-owned work stays, Personal/B stay usable. Repeat the workflow across supported provider families and two accounts of one provider; show offline/conflict/unknown-send recovery honestly.
