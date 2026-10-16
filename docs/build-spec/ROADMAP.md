# Dependency-ordered build roadmap

**Design artifact, not an execution queue.** [C01–C13](../ARCHITECTURE_ALIGNMENT.md) are confirmed core; other design defaults remain Proposed and C13 authorizes bounded owner-useful development. Phases express dependencies and proof. They have no invented dates, staffing, estimates or live status. Linear OpenJob remains the sole backlog/status source; use an existing matching issue before creating anything. Slice IDs below are stable references to design outcomes, not instructions to open a batch of issues immediately.

## Stage outcomes

| Phase | Outcome | Exit proof |
|---|---|---|
| P0 · Adopt and reconcile | Reviewed product/architecture defaults and one current handoff | Confirmed core distinguished from remaining Proposed detail; development authorization recorded before implementation; current PR/code/Linear reconciled; no unnecessary rediscovery |
| P1 · Establish ownership | Personal and multiple Workspaces, explicit grants, safe membership lifecycle | Owner-first identity/resource isolation for enabled paths; full three-person/two-Workspace scenario remains broader-readiness proof |
| P2 · Unify the product | Coherent shell and owned Task/Calendar work with scoped agents | Shane’s usable owned-work loop with API/CLI policy, preserving personal offline; early iOS adaptation alongside it |
| P3 · Connect real accounts | One authorized provider's live read/sync with secure credentials and minimal retained data | Shane participates in incremental approved account/mailbox onboarding; real read/reconnect/cleanup plus early iOS pilot evidence |
| P4 · Close the real work loop | Real Calendar planning, draft/send, useful agent subset and honest uncertain effects | Receive/read → Task → provider Calendar → complete → authorized reply; deny/revoke tests |
| P5 · Complete the platform | Provider breadth, richer Calendar, Workspace offline, native and full npm experience | Broader provider/multi-user/platform completion and late offline/advanced Calendar; early iOS pilot is not deferred to this phase |

## Confirmed owner-first pilot path

C09 makes Shane’s daily-use pilot the first delivery target, not a broad launch.
Under C13’s current development authority, complete the minimum
R10–R12 ownership/access foundations needed for enabled paths, R20/R21/R22 owned
work/permissions, then incrementally connect real resources through R30–R33 and
R40–R43. At each connector step, ask Shane to set up/authorize the particular
account/mailbox/calendar and verify its identity and actual behavior together.
Do not request every provider/account up front or imply a connected demo is live.

R53 has an **early iOS pilot milestone** alongside R20–R33 and the evolving live
loop, so Shane can use the app physically before broad provider/multi-user/native
completion. It may first expose only verified owned-work/read-connected features,
then gain the approved Calendar/send/agent capabilities as those pass. Full R53
platform parity and R55 whole-product readiness remain later outcomes; an early
milestone does not mark those entire slices Done. Actual TestFlight distribution
and required native/privacy/device/artifact gates still apply separately.

Full invitation/admin UI, role breadth, the complete three-person lifecycle matrix,
Android/desktop breadth, advanced Calendar (R51), company SSO and full offline Mail
(R52) must not become prerequisites for the first narrow owner pilot unless an
enabled path actually depends on them. Do not weaken account/context isolation,
current-rights/revocation checks, safe Mail rendering or send-safety boundaries.
Keep unverified features unavailable. Preserve personal offline Task/Calendar;
shared work starts online and Mail bodies are initially on demand (C10).

Dependencies below distinguish **minimum pilot foundations** from full slice
acceptance. Keep the same IDs and one Linear execution queue; select bounded
milestones in existing issues rather than creating a second pilot backlog.
C11 selects portable Linux hosting; exact target/configuration remains unresolved: choose/review actual runtime before live bindings; this
path does not select Cloudflare, local authority or a deployment automatically.

## P0 · Adopt and reconcile

### R00 · Adopt the reviewed build contract
Dependencies: confirmed baseline C01–C13; no new ritual whole-package adoption gate. Trace: all requirements; D01–D20.

Deliver: existing owner-confirmed core plus accepted/changed remaining decision record in canonical PR #87 docs, preserving mission and proposed/accepted distinctions; link adopted index from existing handoff. Reconcile deck, architecture and these requirements. Keep review-only copies immutable or clearly superseded.

Acceptance: owner choices are recorded with actual review reference; specific provider/effect/distribution authorization remains separate; Workspace/offline/native/npm/calendar follow-on scope is not silently dropped. C13 lifts the prior feature pause for bounded owner-useful work; preserve specific consequential approvals.

### R01 · Establish the exact resumable baseline
Dependencies: R00 and authorized development environment. Trace: OJ-A4, OJ-X3, OJ-X6.

Deliver: current Git/PR/Linear/WStack/AGENTS comparison and one bounded reproducible baseline, reusing existing evidence. Confirm npm artifact/publication state, existing local-CI setup and unfinished WLK-302 checkpoint before overlapping work.

Acceptance: current commit/branch, relevant checks, runtime mode and exact next action recorded in Linear/w.md; synthetic and live states distinguished; existing shared data/artifacts preserved; no repeated full discovery or unrelated cleanup campaign.

## P1 · Establish ownership

### R10 · Introduce workspace-owned repositories
Dependencies: R01. Trace: OJ-I3, OJ-T1, OJ-T3, OJ-X4.

Deliver: explicit User/Workspace/Resource identifiers, per-entity repositories and context-qualified ownership checks; retained User/data mapping where needed; coherent replacement of obsolete fixture contracts, with temporary compatibility only for identified active consumers.

Acceptance: ownership-qualified CRUD denies foreign IDs; useful Personal/shared-task behavior remains; obsolete project-owned tests are revised honestly; Tasks and Calendar no longer require one growing Mail aggregate. Regenerate disposable fixtures. Test a migration/rollback only if actual data must be retained; no production migration without authorization.

### R11 · Add independent identity and Workspace onboarding
Dependencies: R10. Trace: OJ-I1, OJ-I2.

Deliver: personal-anchor eligibility handling, Workspace creation with single human owner and proposed default resources, explicit intended-recipient invitation acceptance and per-workspace membership. Keep workspace SSO disabled and preserve existing Personal identity during assessment.

Pilot acceptance: Shane’s existing identity and selected Workspaces retain explicit ownership/access without duplicate login; disabled multi-user features remain unavailable. Full slice acceptance: Alex/Sam/Jo can create/join the specified two-Workspace fixture; existing User adds a membership rather than duplicate login; wrong recipient, expired/canceled/replayed invitation and known managed-only identity cannot acquire wider access; single owner, explicit permission sets/internal groups, and proposed role limits enforced; callback/context interruption tested.

### R12 · Enforce resource grants and Workspace lifecycle
Dependencies: minimum R11 identity/membership foundations for enabled pilot paths; complete broader invitations/lifecycle later. Trace: OJ-I3–I5, OJ-C1, OJ-A2, OJ-X4.

Deliver: named resource operations, explicit connection ownership/controller metadata, guest visibility, suspension/departure, successor transfer and lifecycle cleanup coordination.

Pilot acceptance: foreign-resource access and unauthorized read/send/grant operations fail, with current sponsoring-right revocation on enabled paths. Full slice acceptance: Admin cannot inspect restricted employee Mail; guest has only named resources; Workspace B learns nothing from employee's guest role in A; departure first denies new A actions and preserves A work plus Personal/B; sole owner cannot depart before recipient accepts transfer; transfer preserves resource homes/grants; pending provider cleanup is visible. Test API and repository paths, not just hidden controls.

## P2 · Unify the product

### R20 · Build the context-aware app shell
Dependencies: minimum R11/R12 ownership/access foundations for enabled pilot paths; full multi-user breadth is not required for the early pilot. Trace: OJ-X1, OJ-I3, OJ-C2.

Deliver: authorized labeled cross-Workspace Home, Workspace Today/Mail/Tasks/Calendar/Agents/settings and account-level authorized Connections, durable selected context, deep links and first-run empty states. Keep examples visibly separate and retain old Groups access.

Acceptance: a new user can create a Task/block without connecting a provider; Home reveals only permitted tasks/events/unread counts and enters the correct Workspace for actions; central Connections has no master resource owner or management bypass; no unusable fake Connect control; Back/Forward, reload and context switch retain the correct draft/item context; inaccessible deep link leaks no title/address; responsive keyboard/touch navigation works.

### R21 · Finish owned tasks and planning semantics
Dependencies: R10/R20. Trace: OJ-T1–T3, OJ-K2–K4.

Deliver: consistent useful shared + Personal/workspace task fields; TaskSource protected relation; local Task/block transaction; conflict-aware availability; keep useful import/export behavior. Implement bounded versioned JSON export of authorized OpenJob Task/Calendar data and authored drafts, alongside existing iCalendar exchange. One canonical relationship, no duplicate scheduling engine.

Acceptance: create/edit/assign/complete/reopen/delete and list filters work in UI/API/CLI; repeating source creation opens existing task or explicitly creates another; shared task does not expose source; schedule/reschedule/unschedule/delete leave no orphan link; concurrent edit and DST/invalid interval reject or recover correctly. Completion neither sends Mail nor deletes calendar history. Export omits provider credentials, hidden source metadata and unauthorized drafts; Workspace Admin status cannot export restricted Mail.

### R22 · Extend scoped agent/API/CLI contracts
Dependencies: relevant R12 access checks and R21 owned operations; pilot scope first. Trace: OJ-A1–A4, OJ-I3.

Deliver: connected external agent identity with independent per-Workspace operation-granular grants, reviewed mailbox sets, expiry/revoke UI, context selection/structured CLI output, additive OpenAPI endpoints/adapters.

Acceptance: one allowed and one denied operation per resource family; write-only response contains no read content; credential cannot act as human; mailbox-set addition does not expand existing grant; same app/API/CLI action has same semantics; old fixture token gains no live authority; generated types and API checks pass. Members delegate only permitted subsets of current rights under policy. Workspace A revoke leaves unrelated B grant valid; membership loss stops derived A work. No persistent Workspace agent runtime. Human-only access administration remains proposed.

## P3 · Connect real accounts

### R30 · Implement durable integration execution
Dependencies: relevant R10/R12/R22 ownership/permission foundations for enabled pilot operations. Trace: OJ-C3, OJ-M3, OJ-A3, OJ-X4.

Deliver: Operation/outbox/job/lease repositories, conditional updates/idempotency fences, scheduler entry point, connection/binding revision checks, observable failures and durable cleanup. Implement against synthetic providers first.

Acceptance: restart after enqueue resumes; two runners cannot double-dispatch the same leased intent; crash at each dispatch/receipt boundary produces confirmed/rejected/unknown honestly; revocation before dispatch prevents provider call; same key/different payload conflicts; expired receipt never makes a send replay fresh. No provider calls in transaction callbacks.

### R31 · Bind one authorized live connection
Dependencies: R30; separately reviewed selected runtime/data defaults and specific resource/credential authorization. Trace: OJ-C1, OJ-C2, OJ-I1.

Deliver: incrementally onboard one Shane-approved account/resource with his participation; implement only the separately reviewed credential/runtime design, central authorized connection management, explicit resource-home bindings, provider consent callback or supported standards authentication, upstream identity verification, refresh serialization, reconnect and durable revoke cleanup for the selected provider. Finish the chosen credential/runtime design before real tokens; existing encrypted-repository/key-rotation proposal is not accepted by pilot approval.

Acceptance: cancel/replay/wrong-state/wrong-subject paths fail closed; original context remains bound during login; tokens stay server-side/redacted; expired refresh or removed scope becomes reconnect-required; credential rotation/revocation and cleanup retry proven in isolated setup. Prove resource-detach versus whole-provider revocation impact/authority across any shared upstream binding; central navigation must not grant global credentials/content. Production remains disabled until authorized bindings and verification exist.

### R32 · Integrate real Mail reads and sync
Dependencies: R31. Trace: OJ-M1, OJ-C1–C3, OJ-X4.

Deliver: real authorized Inbox/folders/message retrieval, lazy body reads and safe decoding/rendering before display, capability-gated attachment retrieval, search/pagination, incremental or bounded polling sync, metadata cache and cursor/tombstone handling. Select provider by approved access/feasibility, not invented priority.

Acceptance: actual test account identity matches; second page and duplicate/colliding IDs remain correct; old cursor safely resyncs; deleted message disappears without deleting its Task; last-read timestamp/stale/blocked state truthful; metadata expiry/disconnect makes data inaccessible; no persistent body cache in pilot. Before exposing the first live body, prove bounded safe MIME/text decoding, inert/sanitized HTML, blocked active content and no automatic remote-image fetch; malformed content fails safely. R42 expands attachment support, not this minimum reading boundary. Injected transport tests alone do not close the live criterion.

### R33 · Complete the first connected human journey
Dependencies: R20/R21/R32. Trace: OJ-X1, OJ-T2, OJ-T3, OJ-M2, OJ-C2.

Deliver: Shane’s read-connected useful daily slice and early R53 iOS handoff; unified connected Mail instead of disconnected provider preview, live source-linked Task, OpenJob planning block and durable local draft through the coherent shell.

Acceptance: sign in → connect → read → linked Task → plan locally → prepare reply works; source unavailable after disconnect while Task remains; repeated navigation preserves draft and From identity; an empty real account stays empty rather than loading examples. Record what Shane actually used and the next specific account/resource to attach. This milestone is read-connected, not completed provider Calendar/send; those extend the same pilot rather than waiting for broad launch.

## P4 · Close the real work loop

### R40 · Connect Calendar and external task planning
Dependencies: R30/R31/R33. Trace: OJ-K1–K3, OJ-T3.

Deliver: external calendar list/read/free-busy and faithful recurrence expansion; selected non-recurring/no-attendee event create/update/delete; typed remote PlanningLink and reconcile state.

Acceptance: correct calendar identity; timed/all-day/DST/recurring instance reads; busy-only grants redact content; stale/missing calendar is not “free”; local Task update cannot pretend a remote write succeeded; provider edit conflict and unknown result handled; unschedule never silently deletes an external event.

### R41 · Implement durable Mail drafts and sending
Dependencies: R30/R31/R33. Trace: OJ-M2, OJ-M3, OJ-A2.

Deliver: local vs provider draft distinction, text compose/reply/reply-all, To/Cc/Bcc and verified From identities, separately consented send, immutable reviewed outbound snapshot/hash, provider receipt and reconciliation view. Reply quoting is off by default; explicitly inserted text follows protected draft retention. Use approved test recipients only.

Acceptance: exact authorized test reply appears in the intended provider account/thread; wrong-account/unsupported alias/send-without-scope rejected before effect; repeated click/key yields one intent; editing a Draft after enqueue cannot alter approved outbound bytes and payload mismatch blocks dispatch; crash/timeouts produce unknown instead of resend; app/API/CLI expose equivalent operation state; no claim that accepted mail was delivered/read.

### R42 · Complete essential Mail actions and attachments
Dependencies: R32/R41. Trace: OJ-M1, OJ-M4, OJ-M5.

Deliver: safe MIME parsing, on-demand attachment download/upload/send, advertised size limits, read/unread, archive/trash with provider semantics. File bytes follow outbound retention/cleanup policy.

Acceptance: international filename/content-type/binary/oversize/invalid MIME tests; sanitized/blocked active content; no remote image fetch by default; attachment source permission rechecked; wrong-account flags/folder mutation denied; no permanent provider purge. Standards provider proof includes real TLS/login/MIME where applicable.

### R43 · Prove the live human-and-agent loop
Dependencies: R22/R40/R41/R42. Trace: OJ-A1–A4 and end-to-end story.

Deliver: live delegated workflow through the existing CLI/API, attributable receipts and human grant/revoke controls using the same services as the app.

Acceptance: approved agent reads one named mailbox, creates a Task, schedules only its permitted calendar and drafts/sends only if explicitly granted. Forbidden second mailbox/send/admin attempts yield no provider traffic. Revoke while queued and suspend sponsor: new effects stop. Human can complete the workflow with no AI service. Record exact commit/environment/account capability evidence without secrets.

## P5 · Complete the platform

### R50 · Add all priority provider/account combinations
Dependencies: R43; per-provider approved resources. Trace: OJ-C1–C3, OJ-M1–M5, OJ-K1–K3.

Deliver: missing Gmail/Google, Outlook/Graph and Purelymail/standards adapters; two accounts of one provider; tested capabilities and ownership/controller limits. Reuse contract suite. Recover/inspect WLK-302 before IMAP TLS/login work. Do not imply Purelymail provides Calendar; pair its Mail with an authorized external Calendar or OpenJob blocks.

Acceptance: for every claimed provider capability repeat identity/cursor/refresh/revoke/write-uncertainty conformance and real approved-account workflow; two same-provider accounts with colliding IDs never cross; missing capability is clearly unsupported. Finish each provider as a bounded Linear outcome rather than one giant compatibility issue.

### R51 · Complete invitation and recurring Calendar behavior
Dependencies: R40/R43; approved test recipients/calendars. Trace: OJ-K5, OJ-K6.

Deliver: explicit attendee review and invitation/update/cancel/RSVP operations; separate `calendar.invite`/response permissions; recurring-series creation and occurrence/series edit/cancel semantics, preserving provider-specific recurrence metadata.

Acceptance: selected organizer/identity and exact attendees shown before notification; no duplicate invitation after retry; single-instance exception leaves series unchanged; series edit/cancel correct; DST and moved/canceled occurrences round-trip; unsupported “this and following” fails before effects. Native/web/CLI present same scope choice.

### R52 · Deliver controlled offline Workspace and Mail work
Dependencies: R12/R21/R43. Trace: OJ-X2, OJ-X5.

Deliver: per-context offline policy, opt-in bounded Mail cache on supported secure clients, explicit Workspace Task/block edit queue, local authored draft retention and conflict/access recovery. No offline provider effects.

Acceptance: encrypted cache/key handling verified on each supported client; lock/logout/disconnect disables access; departing Workspace cannot upload queued work; concurrent version conflict retains authored changes safely; context switch never exposes cached other-workspace Mail; browser limitation is explicit where platform protection is inadequate. State claims list what was actually exercised.

### R53 · Early owner iOS pilot, then complete native verification
Dependencies: early iOS milestone follows stable enabled R20/R21/R22 contracts and relevant R31–R33 read-connected capabilities; full parity follows relevant R40–R43 and R51/R52 only for features actually advertised. Trace: OJ-X3, OJ-X5, OJ-X7.

Deliver: early usable iOS TestFlight candidate for Shane, incrementally reflecting verified owned/read-connected/live capabilities, with a per-build supported/limited list. After this pilot milestone, complete iOS and Android native feature parity for Workspace/context, connected Mail/Tasks/Calendar/Agents and authorized offline scope. Apply existing accessibility, privacy, encryption, notification, OTA-signing and device-release ADRs.

Early iOS acceptance: exact candidate runs on Shane’s supported device with usable enabled flow, correct identity/Workspace and permission denial/revoke behavior, interrupted login/reconnect, preserved personal offline Task/Calendar and clear online-only shared/Mail states. Distribution, credentials/provider effects and production release need applicable separate approvals. Preserve required native/privacy/device/artifact gates; if an existing gate blocks a narrow TestFlight pilot, report that exact gate for review rather than bypass it or silently defer iOS. Full slice acceptance: simulator/emulator plus required physical-device evidence for exact artifacts; login interruption, deep link/context switch, keyboard/touch/screen reader, background/foreground, offline restart, grant revocation and update recovery; record unavailable checks as blockers. Store submission/OTA release remains separately authorized.

### R54 · Deliver the full npm-installed desktop experience
Dependencies: stable R20–R43 contracts; R52 for claimed offline features. Trace: OJ-X6, OJ-X7.

Deliver: real authenticated packaged app/CLI; local secure client bridge; npm-managed macOS/Windows/Linux installation where verified; automatic update notice, explicit update action, `@latest` reviewed-release and `@dev` main-derived version/channel behavior. Fixture demo remains separate.

Acceptance: fresh install/login/connected workflow/restart on each claimed platform; local CSRF/Host/Origin and credential-store tests; two-context data isolation; no synthetic results in real mode; update detects correct channel, preserves data and never auto-installs; package/source/hash/channel readback after separately authorized publication. Existing unpublished approved artifact/auth blocker is not silently replaced.

### R55 · Pass whole-product release and recovery evidence
Dependencies: accepted applicable R50–R54 outcomes. Trace: OJ-X3, OJ-X4, all core requirements.

Deliver: full requirement/capability/platform matrix, privacy/data inventory, production backup/restore proof only when consequential data/rollout justifies it, cleanup/reporting, user-facing support limits and Shane’s observed pilot learnings plus later broader-user validation; no invented general demand. Set operational objectives only after measured behavior, not invented availability promises.

Acceptance: critical negative permission tests and source-link retention checks pass on release head; authorized real provider workflow complete; restore cannot revive revoked grants; no unresolved ambiguous send hidden as success; exact published/deployed artifacts verified; production rollout permission separate. Market value claims remain hypotheses until actual user evidence is recorded.

## Requirement-to-slice traceability

| Requirements | Primary slices |
|---|---|
| OJ-I1–I2 | R10, R11, R31 |
| OJ-I3–I5 | R10, R12, R20, R22 |
| OJ-C1–C3 | R12, R30–R33, R50 |
| OJ-M1–M5 | R32, R33, R41, R42, R50 |
| OJ-T1–T3 | R10, R21, R33, R40 |
| OJ-K1–K4 | R21, R40, R50 |
| OJ-K5–K6 | R51 |
| OJ-A1–A4 | R22, R30, R43 |
| OJ-X1–X2 | R20, R33, R52 |
| OJ-X3–X4 | R12, R30, R32, R53–R55 |
| OJ-X5–X7 | R52, R53, R54 |

## Every slice's evidence contract

Selected Linear item links requirement/slice IDs and contains changed surfaces, exact source commit, fixture vs live evidence, checks run/passed/failed/not run, relevant permission denial, UI proof where useful and delivery status. Routine cycle: cheap compile/type + affected happy path and changed isolation/send-safety boundary. Run broader matrices only where actual users/consequences or applicable release gates justify them or when a change invalidates them, not after every minor edit. The acceptance lists identify evidence the outcome eventually needs; they are not a mandate for a large fresh test campaign per commit.

Follow current `npm run`/AGENTS required gates and external protections. Revise obsolete project-owned expectations when needed for the accepted prototype evolution; do not disguise failures. OpenAPI/type, browser/CLI/native and secret checks apply where affected. Re-read scripts before invoking; a documented command is not permission to deploy/reset/provision. Test migration/rollback only for actual data/consumers that must be preserved, never as ceremony for disposable fixtures.

“Done” requires the issue's acceptance and delivery criteria, not merely a PR or successful build. Architecture acceptance, implementation merge, live test and production release are four different facts. If blocked on external authorization, complete independent fixtures/contracts/UI and report the exact required account/resource/action instead of repeating discovery or calling the full slice complete.

C12 pilot verification: cheap compile/primary-flow checks, relevant isolation/
scopes/revocation/no-accidental-send and secret checks plus external protections.
Do not run exhaustive full suites, backup/failover drills or fixture migrations as
a gate for disposable solo-prototype changes. Revise obsolete project-owned test
expectations honestly. Production/native releases retain their applicable scope.
