# Decision register and owner review

**Proposed additions to PR #87, not accepted decisions.** A recommendation below is the default to review, not a record that the owner already agreed. Mission requirements and historical ADRs retain their existing authority; proposed ADRs 0019–0021 remain proposed.

## One short owner review list

The owner can accept this package as a whole, or change these three consequential choices. Routine implementation choices below do not require a product questionnaire.

1. **Product and ownership:** accept the PR #87 model: equal Mail/Calendar/Tasks, one personal identity, independent Companies, named roles, explicit company/resource ownership and separate revocable agents. First core intentionally excludes office-suite modules, enterprise SSO and external task-list synchronization
2. **First live runtime:** accept hosted-first on the existing Cloudflare/Firebase stack, with local Mac verification/package/publish kept separate. A secure local-first service is a valid alternative but changes identity, credentials, background execution and remote-agent work
3. **Privacy and offline experience:** accept online-first Mail in the first live pilot, followed by deliberate opt-in offline Mail/Company work on supported clients. Personal and restricted Company mail stay private; administrators get no hidden content access. RUNTIME.md supplies the technical cache/cleanup defaults so the owner need not choose storage knobs. Validate actual hosting/data-location terms before real accounts

**Separate future execution gate, not an unresolved design decision:** authorize the intended isolated provider account/calendar and development resources when connection setup begins. Design review can finish before those exist. Read, send, calendar write, credentials and publishing retain their applicable approvals; accepting this package does not create them.

No provider order needs to be chosen as a product decision now. Prefer the first provider whose approved test access, supported callback/credential runtime and adapter proof are available. If otherwise equal, Gmail has the most existing consent scaffolding; this is an engineering tie-breaker, not an enterprise-readiness claim.

## Proposed defaults

| ID | Recommendation | Basis / consequence | Status |
|---|---|---|---|
| D01 | Adopt the mission and PR #87 as the platform baseline; integrate this detail into that document set | Avoid two changing visions; Linear is the execution queue | Mission standing; PR detail proposed |
| D02 | One modular application; typed domain repositories/application services; shared versioned API | Existing TypeScript engine/API/CLI is useful; avoids a rewrite before useful live behavior | Proposed, ADR 0019 |
| D03 | Keep npm, Node/TypeScript, React, Expo, Firebase/Firestore and Cloudflare | WStack explicitly preserves working stacks; Rust/Postgres is not a migration mandate | Proposed, ADR 0019 |
| D04 | One User/personal workspace per installation; Companies own company workspaces | Independent memberships and ownership survive employment change | Proposed, ADR 0020 |
| D05 | Owner/Admin/Employee/Guest; explicit invitations; no domain-based membership or global inbox | Small policy model, clear context; no implicit mailbox access | Proposed, ADR 0020 |
| D06 | First Company release uses independent personal authentication only; company SSO is disabled | Existing global links require assessment; no invented employer-isolation guarantee | Proposed, ADR 0020 elaboration |
| D07 | Providers own Mail/external Calendar; OpenJob owns Tasks, OpenJob blocks, links and delegation | Two-way Google Tasks/Microsoft To Do/CalDAV task sync is not first-core scope | Proposed, ADR 0021 |
| D08 | First live profile hosted; existing packaged npm app remains a labeled synthetic demo | Remote agents and identity are already hosted; does not turn local CI into a hosting choice | Proposed, owner review |
| D09 | Normalize owned resources and provider projections before live import; retain Firestore | Removes the 900 KB prototype aggregate as an Inbox ceiling without changing database | Proposed technical default |
| D10 | Durable operation/job records in Firestore; scheduled bounded runner in same server codebase | Persist intent before external effects, lease jobs, recheck grants, reconcile uncertain outcomes | Proposed, ADR 0021 elaboration |
| D11 | Mail metadata cache plus on-demand body fetch; no persistent provider-body/attachment or body-search index for first live pilot | Reduces copies of sensitive content. Does not pretend headers are non-sensitive | Proposed, owner review |
| D12 | Keep useful Personal/Group behavior; preserve old route adapters only for identified active consumers, otherwise allow coherent replacement of prototype contracts | Never silently turn Group membership into employment, Company ownership or Mail access; disposable fixtures need no migration program | Proposed technical default |
| D13 | Personal and company agents are explicit principals; grants name resource sets and operations; no access-administration capability in first core | Least privilege without an enterprise policy language or autonomous agent platform | Proposed product default |
| D14 | New workspace APIs use explicit workspace IDs; any needed temporary compatibility route resolves Personal server-side | Replace obsolete fixture APIs where safe; never trust client owner/company IDs as authority | Proposed technical default |
| D15 | First live slice writes non-recurring, no-attendee events; full build target includes deliberate invitations/RSVP and recurring-series authoring | Stage consequential calendar behavior behind explicit permissions and occurrence/series semantics; do not permanently narrow Calendar | Proposed staging boundary |
| D16 | New Mail compose/reply/reply-all and safe attachments; sending uses explicit identity and durable intent | Text-first editor; no rich-text suite, mass mail, send-later automation or permanent provider purge | Proposed product boundary |
| D17 | Existing personal offline Task/Calendar edits remain; expand Company offline writes only after permission-aware conflict proof | Revocation is enforced on the next service action; no promise to recall downloaded content | Proposed product default |
| D18 | Web plus API/CLI is first live acceptance; target native/device breadth remains required, verified separately | A cloud build is not iOS/Android/desktop release evidence | Proposed staging, mission unchanged |
| D19 | Every roadmap slice is copied/reconciled into the relevant existing Linear issue only when selected | Slice IDs are design traceability, never a second live status board | Proposed operating default |
| D20 | Full packaged npm app is an authenticated client of the chosen hosted service, with real provider capabilities and supported offline behavior | Preserve installable experience without falsely treating the fixture server as secure production hosting; local-authoritative server is a separate profile | Proposed product/runtime default |

## Routine choices delegated to implementation

Choose file names, internal class/function structure, pagination batch size, test helpers and accessible responsive layout within these contracts. Use opaque stable IDs, UTC instants plus IANA time zones, entity revisions, conditional updates and idempotency. Use current official SDK/protocol documentation, not guessed library compatibility. Keep files responsibility-focused; do not add services for organizational neatness.

If a connector cannot run reliably in bounded Cloudflare invocations, propose a narrow integration-worker extraction with evidence. If Firestore cannot satisfy a measured query/transaction requirement, propose the smallest repository migration and rollback. Either is a new ADR change, not a reason to rewrite the whole app by default.

## Acceptance record

After review, record accepted/changed decisions with the owner's actual review reference and date in the canonical PR/ADRs. Keep rejected alternatives and reasons. Do not replace “Proposed” with “Accepted” merely because an implementation session starts. Any accepted design still needs specific authorization for provisioning, credentials, real correspondence, publication, production migration and destructive actions.
