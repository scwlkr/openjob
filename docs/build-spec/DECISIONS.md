# Decision register and owner review

**Mixed authority, explicitly recorded.** [C01–C10](../ARCHITECTURE_ALIGNMENT.md) are owner-confirmed core decisions from the actual discussion. They supersede conflicting prior proposals only. ADR 0020 records that core plus Proposed details; ADRs 0019/0021 and unrelated defaults remain Proposed. This is not whole-package acceptance or development authorization.

## Remaining owner review

Do not re-ask the confirmed Workspace boundary, single human owner, resource grants,
central authorized Connections, connected-agent model, bounded Home or no initial
hosted Mail. Propose routine details; ask only consequential alternatives with their
implications. C09 confirms owner-first daily use and early iOS; C10 confirms
online-first shared work, preserved personal Task/Calendar offline support and
on-demand bodies before full offline Mail. Remaining proposals include:

1. **Detailed product/policy:** role presets, default resources, authentication eligibility, field behavior and full-product detail beyond C01–C10
2. **Hosting remains undecided:** Shane asked for options. Hosted-first Cloudflare/Firebase is only a proposal; local/self-hosted or other options require separate review. Neither pilot priority nor online-first work chooses hosting
3. **Privacy/storage mechanics:** cache/cleanup caps, encryption/storage and later offline mechanics remain Proposed. C10 settles initial online/offline behavior, not the entire data policy

**Separate future execution gate, not an unresolved design decision:** authorize the intended isolated provider account/calendar and development resources when connection setup begins. Design review can finish before those exist. Read, send, calendar write, credentials and publishing retain their applicable approvals; accepting this package does not create them.

No provider order needs to be chosen as a product decision now. Prefer the first provider whose approved test access, supported callback/credential runtime and adapter proof are available. If otherwise equal, Gmail has the most existing consent scaffolding; this is an engineering tie-breaker, not an enterprise-readiness claim.

## Defaults and their exact authority

| ID | Recommendation | Basis / consequence | Status |
|---|---|---|---|
| D01 | Adopt the mission and PR #87 as the platform baseline; integrate this detail into that document set | Avoid two changing visions; Linear is the execution queue | Mission standing; PR detail proposed |
| D02 | One modular application; typed domain repositories/application services; shared versioned API | Existing TypeScript engine/API/CLI is useful; avoids a rewrite before useful live behavior | Proposed, ADR 0019 |
| D03 | Keep npm, Node/TypeScript, React, Expo, Firebase/Firestore and Cloudflare | WStack explicitly preserves working stacks; Rust/Postgres is not a migration mandate | Proposed, ADR 0019 |
| D04 | One personal User participates in independent Workspaces; a company IS a Workspace; one transferable human owner and resource homes | C01–C03; no Company hierarchy or co-owner set; one initial Personal Workspace remains a proposed convenience | Core confirmed; detail Proposed |
| D05 | Invitations select resources/actions; internal groups/permission sets; restricted and shared Mail; bounded labeled Home | C04/C08; Owner/Admin/Employee/Guest presets and default visibility are not adopted | Core confirmed; presets Proposed |
| D06 | Company SSO stages later; proposed initial eligible personal authentication remains subject to assessment | C09 stages SSO only; existing global links/independent-anchor protocol not adopted | Staging confirmed; identity mechanics Proposed |
| D07 | Providers own Mail/external Calendar; OpenJob owns Tasks, OpenJob blocks, links and delegation | Two-way Google Tasks/Microsoft To Do/CalDAV task sync is not first-core scope | Proposed, ADR 0021 |
| D08 | Hosting remains undecided; hosted-first retained stack is an option, not selected. Existing npm demo stays synthetic | Owner asked for hosting options; online-first/pilot do not choose authority runtime | Unselected hosting proposal |
| D09 | Normalize owned resources and provider projections before live import; retain Firestore | Removes the 900 KB prototype aggregate as an Inbox ceiling without changing database | Proposed technical default |
| D10 | Durable operation/job records in Firestore; scheduled bounded runner in same server codebase | Persist intent before external effects, lease jobs, recheck grants, reconcile uncertain outcomes | Proposed, ADR 0021 elaboration |
| D11 | Initially fetch Mail bodies on demand and defer full offline Mail; proposed minimal metadata cache/no server body index | C10 confirms initial behavior; exact cache caps, retention/cleanup and storage remain Proposed | Initial behavior confirmed; data mechanics Proposed |
| D12 | Keep useful Personal/Group behavior; preserve old route adapters only for identified active consumers, otherwise allow coherent replacement of prototype contracts | Never silently turn Group membership into employment, Workspace ownership or Mail access; disposable fixtures need no migration program | Proposed technical default |
| D13 | External connected agent identity with independently revocable per-Workspace grants; members delegate subsets under policy | C06; no hosted agent runtime. Exact credentials, presets and human-only access administration remain proposed | Core confirmed; detail Proposed |
| D14 | New workspace APIs use explicit workspace IDs; any needed temporary compatibility route resolves Personal server-side | Replace obsolete fixture APIs where safe; never trust client owner IDs as authority | Proposed technical default |
| D15 | Owner-first basic Calendar first; advanced invitations/RSVP and series authoring stage later | C09 confirms staging, not every event schema or whole-product scope; initial non-recurring/no-attendee write boundary remains proposed | Staging confirmed; exact boundaries Proposed |
| D16 | New Mail compose/reply/reply-all and safe attachments; sending uses explicit identity and durable intent | Text-first editor; no rich-text suite, mass mail, send-later automation or permanent provider purge | Proposed product boundary |
| D17 | Online-first shared work; preserve existing personal offline Task/Calendar; full offline Mail later | C10; later shared-work offline expansion and conflict/cache mechanics still Proposed | Staging confirmed; later mechanics Proposed |
| D18 | Shane-first real Mail/Calendar/Tasks/agent-permission pilot, progressive real onboarding and early usable iOS TestFlight | C09 replaces web/API-only-first sequencing; broader multi-user/native/provider readiness is not a pilot prerequisite. Actual distribution/release approvals and platform gates remain | Pilot priority confirmed; distribution not authorized |
| D19 | Every roadmap slice is copied/reconciled into the relevant existing Linear issue only when selected | Slice IDs are design traceability, never a second live status board | Proposed operating default |
| D20 | Full npm app uses real authenticated service/provider capabilities; exact hosted/client authority profile awaits hosting choice | No silent installs; fixture demo stays distinct. Existing hosted-client design remains a proposal only | Proposed runtime/client detail; hosting undecided |

## Routine choices delegated to implementation

Choose file names, internal class/function structure, pagination batch size, test helpers and accessible responsive layout within these contracts. Use opaque stable IDs, UTC instants plus IANA time zones, entity revisions, conditional updates and idempotency. Use current official SDK/protocol documentation, not guessed library compatibility. Keep files responsibility-focused; do not add services for organizational neatness.

If a connector cannot run reliably in bounded Cloudflare invocations, propose a narrow integration-worker extraction with evidence. If Firestore cannot satisfy a measured query/transaction requirement, propose the smallest repository migration and rollback. Either is a new ADR change, not a reason to rewrite the whole app by default.

## Acceptance record

C01–C10 already have actual confirmation references; do not promote unrelated D defaults. After further review, record accepted/changed decisions with the owner's actual review reference and date in the canonical PR/ADRs. Keep rejected alternatives and reasons. Do not replace “Proposed” with “Accepted” merely because an implementation session starts. Any accepted design still needs specific authorization for provisioning, credentials, real correspondence, publication, production migration and destructive actions.
