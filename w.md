# R40 native Calendar integration — in progress

21 October 2026 UTC: isolated codex/p-wlk-6-native-calendar integrates native
PR120 source446162d with delivered main e0451e8. Both handoff histories below are
preserved. Root/native TypeScript and 21 focused integration checks pass;
no native files changed in this merge. The native provider Calendar flow and its
runtime proof are pending; prior receipts do not prove this integrated source. Primary checkout and
all34 recorded untracked files remain untouched. No live Calendar/Android/release
authority is inferred.

# R40 connected Calendar fixture source — reviewed

21 October 2026 UTC: source `723c83da7f1f8b8edc920e02ecf15a5954788470`
continues backend `4ad9dc8` on `codex/p-wlk-6-google-calendar`, from main
`0304b6b`. Managed worktree:
`/Users/shanewalker/.codex/worktrees/p-wlk-6-google-calendar/openjob`.
Independent read-only critic accepted this exact source with no consequential
findings. [PR131](https://github.com/scwlkr/openjob/pull/131) merged21 October
06:18:12 UTC as `e4297d6d98033c77095422e9ab281a5425738f54`; remote main matched.
No required check/ruleset was configured, the PR was clean/mergeable, and the sole
repository workflow was verified manual-only/nonpublishing at the exact base.
No deployment or publication ran. R40 remains In Progress.

The explicit invented Google fixture now persists its provider ledger and composes
Calendar account discovery, list/events/FreeBusy, durable operations and planning
in the existing pilot. Normal and portable runtimes still configure no Calendar
service. Mail consent grants no Calendar rights. OpenAPI56 paths/77 operations,
generated CLI types and shared strict web/CLI response validation cover the source
surface. CLI enqueue accepts frozen intent; explicit run-fixture alone executes.
Wrong receipt identity/input and hidden fields fail closed. No write auto-retries.

Tasks show provider relationship state and open the connected Calendar panel.
Authored time/title fields and exact uncertain requests survive module/Workspace
navigation; disposable readers abort and discard observations when hidden.
Timestamp seconds/milliseconds survive title-only edits. Current provider version
acceptance keeps authored edits. Active remote Tasks cannot be locally scheduled
or deleted; dirty provider editors/pending requests guard local Task deletion too.
Explicit editor discard does not discard frozen requests.

Detach leaves the provider event and has its own exact persisted receipt. Review
also saves a receipt atomically with link changes, recovering a lost successful
review after deletion. Queued/executing/unresolved unknown links cannot detach.
Positive resolution can unlock a new intent while the old operation remains
unknown. Detach and queued provider-delete are separate UI/CLI actions.

Practical synthetic browser proof passed: invented Mail → source-linked Task →
provider create → title-only update with exact milliseconds → fixture restart →
restored provider link/history → local completion → saved Reply-all draft. To used
Reply-To plus teammate; Cc retained observer; self was excluded. Nothing was sent.
Sam was denied pilot admission and saw no Alex work. Native Chrome confirmation
controls completed the dirty-editor deletion guard after in-app browser dialog
control failed. The first date-fill probe had not changed React state; the repeated
AX field edit visibly set dirty state and passed the guard. No automation failure
is counted as an application pass.

62 focused checks pass (60 API/provider/actual CLI/reply/contract checks plus two
editor regressions), with final root types, affected lint, OpenAPI/CLI type check,
brand generation/check32 and secret scan. The contract audit now explicitly
inventories existing connected routes and task.notes, preserves legacy
status-specific checks, and checks connected owner/default-error envelopes. New
YAML uses no aliases; original path prefix/components remain byte-identical.

Evidence, screenshots, test logs and source hashes (synthetic only):
`/Users/shanewalker/Desktop/dev/openjob/output/r40/calendar-journey/`.
Primary remains446162d/PR120 Draft; all34 primary untracked files retain their
recorded hashes, including the original26. No new native build, deployment,
publication, live Calendar read/write or persistent real access occurred.

Post-merge fetch found two invalid copied Git refs with spaces in their names.
Their exact bytes are preserved under `output/r40/git-ref-recovery/`; commit
c3770ae5 remains reachable through `refs/codex-recovery/r40-copied-native-ref`.
Only the invalid duplicate entries moved; active native refs were unchanged.
Fetch then passed.

NEXT: reconcile this delivered source with native draft120 and implement/test the
advertised native Calendar fixture flow before claiming
native parity. Keep ADR0017 simulator/emulator/physical and release gates open;
the Android SDK/UI-method question remains unanswered. Real Calendar requires
separately authorized account/resources/scopes and practical provider evidence.

## Historical R40 backend checkpoint — superseded by the source above

21 October 2026 UTC: source `4ad9dc814d62418d2dcbff831028cb9df3effdac` on
`codex/p-wlk-6-google-calendar`, from main `0304b6b`. Managed worktree:
`/Users/shanewalker/.codex/worktrees/p-wlk-6-google-calendar/openjob`.
Primary native draft120 remains at446162d; no merge or new native build.
Sole implementation owner; read-only source/protocol helpers only.

Provider Calendar reads and managed timed/nonrecurring/no-attendee create/update/
delete are implemented with fixed account/home/resource bindings, separate scope
families, default-closed approval, injected transport and no retry. Reads retain
all-day exclusive dates, zones, moved recurrence identity and unknown ends;
collection access is checked after CalendarList access. Busy-only FreeBusy has no
event details, and stale/error/missing observations never mean free. Mutation
preflight checks the full managed event, freezes original ETag and private origin,
then rechecks current ownership/authority/lease/intent immediately before HTTP.

R30's CAS/lease repository and bounded runner are extracted into shared durable
modules; reply.simulate schemas/collections/sim_ receipts remain unchanged. The
Calendar codec uses separate v1FixtureCalendar records and cop_ IDs. Its Task
reservation, operation, frozen payload, job and index share one Workspace CAS.
Local schedule/unschedule/delete and whole-projection offline sync cannot displace
an active remote link. Personal writes now preserve sidecars. Completion, notes,
titles and grants remain local; no provider effect is inferred from them.

Canonical human-only pilot source routes expose Calendar list/events/availability,
remote planning, Calendar operations and explicit run-fixture/review. Normal and
portable runtimes configure no Calendar service. Only source tests compose it with
an inseparable invented credential/fake HTTP provider. The development launcher,
CLI and web UI are NOT wired yet. No actual Calendar account is connected.

72 focused checks pass, including actual existing reply CLI regressions. Invented
state-flow checks cover Mail Task→reservation→repository/provider reconstruction→
create/update/delete; lost create/delete→explicit read reconciliation; provider
edit conflict→review→new ETag intent; no replay; queued revocation recovery;
concurrent identical intent and local-schedule CAS races; late ownership/lease
changes with zero provider writes; Personal sidecar retention/offline exclusion.
Root typecheck/final tsc, affected lint, brand generation/check32 and secret765
pass. Independent read-only review found and confirmed fixes for freshness,
unspecified ends, collection role, all-day conversion, rejected-create recovery,
DELETE tombstones, enqueue receipt recovery and late execution fencing. Final
review found no consequential remaining issue in this backend boundary.

Evidence (synthetic only):
`/Users/shanewalker/Desktop/dev/openjob/output/r40/calendar-backend/`.
No browser/CLI acceptance for the NEW Calendar flow is claimed. Early test authoring
caught invalid fixture arguments/notes and one async callback syntax error; fixed
and included in the final passing run. Existing reply behavior remains covered.

NEXT: implement explicit safe detach (leave provider event) for linked/review-required
states, while queued/executing/unknown reservations require resolution. Document
new routes in OpenAPI and generate CLI types; add CLI Calendar/planning operations.
Compose fixtureCalendar and persist its provider ledger in dev-owned-workspaces.
Wire existing Workspace Calendar and Task status UI without putting remote events
inside the offline projection. Exercise the complete invented browser/CLI journey,
restart, conflict and disconnect/revoke behavior; then review, push/merge the
nondeploying completed slice and integrate native draft120 with exact-input proof.
R40 remains In Progress, not delivered. Full goal/provider/native/release gates stay
open. Follow existing Linear R30 discussion7f612b86-7725-46b1-8474-8a2a680da5eb;
R40 start999c9abe-59f2-4aad-9b52-2e0a5d3bee71; pushed backend checkpoint
a8d5add1-775b-4a4f-80db-633b7f260f2d. Do not create a new backlog.

Primary34 untracked files are hash-identical to
`/tmp/openjob-r40-primary-untracked.json` (includes original26). Primary tracked
files unchanged. Existing Android5213 PID45491 and Metro8088 PID45723 remain;
no simulator, Android SDK/UI, real Mail session, Calendar consent/effect, persistent
real access, security/hosting, deployment or publication action occurred.

# Native integration of Gmail protocol main — P-WLK-6 / R41–R53

21 October2026 UTC: PR130 merged main0304b6b6a0f32c41a1ff361da79d106354e0e6b5;
reviewed final head4125a6e, source4578720. Native draft PR120 integrates that main.
Only FEATURES.md/w.md conflicted; both native and protocol feature/history additions
were preserved. All136 native/shared/package inputs remain byte-identical to
c3770ae; native has no send dispatcher. Prior native Mail/Agents simulator receipts
remain their exact source checkpoints, not new build evidence for this merge.

An isolated staged-tree archive at
/var/folders/m4/wq1lz5wj6n5cxzp07hwn9ckh0000gn/T/openjob-r41-native-integration-9h2tl_7n
hash-matches the complete resolved source. Root/native types and12 focused native
HTTP/agent/Google/protocol checks pass, including both Workspace home types.
Generated CLI types and brand32 pass. Archive secret check could not run without
Git; the canonical checkout scan passed1108. Original26 plus four newer duplicate
files are preserved. No shared dependencies, native sources, proof artifacts,
Android5213/Metro8088 or foreign simulator changed.

PR130 source merge was nondeploying: remote main matches and only a manual
nonpublishing artifact workflow exists; no checks/protections/rulesets/deployments
were configured at review. Native PR120 stays Draft; full R30/R41/R22/R53 remain
In Progress. Live outbound storage/composition, approved send account/recipients,
exact real thread, provider Calendar, Mail delegation, native live/device/storage,
Android UI-method answer and release gates remain open. No further real read,
provider effect, persistent real access, deployment or publication occurred.
Continue Linear R30 7f612b86-7725-46b1-8474-8a2a680da5eb and R53
ba6592c3-b3e1-4908-b830-3532ab70aaf4. Next dependency-ready source outcome is R40:
one source-linked Task selects a named invented Google Calendar, checks truthful
availability and manages one nonrecurring/no-attendee remote planning block through
shared API/CLI/UI. Use separate Calendar intent/receipt and typed remote PlanningLink;
keep local offline Task/Calendar projections intact. Require account/home/scope
isolation, all-day/timezone/expanded recurrence reads, busy-only redaction, ETag
conflicts and durable unknown/no replay under injected fake HTTP. Actual Calendar
scope/consent/effects remain unapproved. No earlier credential-independent live
runtime gap was found; real activation still needs selected storage/runtime/access
review. Do not repeat the completed bounded alt read.

# Gmail reply protocol delivery — P-WLK-6 / R41

21 October2026 UTC: source45787209cab42d7dd7574163417aed6162fdd966 on
codex/p-wlk-6-gmail-reply-protocol, based on main5b21875. Native PR120 stays
separate at c3770ae until main integration. This supersedes pending proof below.

The default-disabled, unbound Gmail reply adapter validates exact owned binding,
verified subject/From and separate gmail.send scope before one POST through a
mandatory injected transport. It serializes frozen reviewed Unicode text, exact
To/Cc/subject/threading and saved timestamp into bounded MIME/base64url. Wrong
binding/scope/alias, malformed headers/threading and invalid Unicode cause no POST.
Known rejection is distinct from unknown; no automatic retry. The fixture's
invented send credential/fake HTTP are inseparable. Only its own sim_ receipts enter
reply.simulate operations. Current read OAuth, default/portable absence of a
dispatcher, provider capability gates and actual mail.send denial remain intact.

40 focused checks pass: new protocol/durable8, related CLI/reply/Google22,
OAuth readonly/lifecycle9 and actual-send403/no-side-effect1. Root types, affected
lint, generated CLI types, brand32 and secret749 pass. Independent read-only review
found no consequential issue. Shared draft validation extraction matches native
PR120's helper. No package, native code, real consent or provider setup changed.

Actual browser proof on source4578720: create source Task; review Reply all;
save88 Unicode characters at revision1; queue; save77-character revision2; stop and
restart the saved fixture; reopen exact revision2 and queued revision1; execute.
UI reports Simulation confirmed / Nothing was sent. Fake provider's single durable
request hash exactly matches frozen revision1 MIME, with unchanged payload hash.
Three further actual API run requests return confirmed, keep POST count1 and leave
saved Tasks/Calendar byte-equal. Actual CLI tests cross the same fake boundary for
normal and accepted-but-lost provider responses; file-backed repository/provider
reconstruction proves unknown cannot replay. No real receipt is relabeled.

Synthetic screenshot, receipt, source hashes and logs are retained on this Mac:
/Users/shanewalker/Desktop/dev/openjob/output/r41/gmail-reply-protocol/.
First interrupted npm parent left own lock34069; PID and5214 listener were absent,
then only that dead lock was removed before restart. Cleanup disconnected the
invented connection, closed own tab and stopped own5214 service. Prior5213/8088,
foreign simulator and original26 plus four newer duplicate-suffix files remain.

Full R30/R41 stay In Progress. Real send permission, outbound storage/composition,
approved recipients/exact real-thread proof, provider Calendar, Mail delegation,
native live/device/storage and release gates remain open. Next: reviewed
nondeploying source PR/merge; integrate main into native draft120 with unchanged
native input verification, then continue the existing Linear queue. R30 discussion
7f612b86-7725-46b1-8474-8a2a680da5eb owns this bounded R41 milestone. No real Mail
read repeated, real provider effect, persistent real access, security/hosting
change, deployment or publication.

# Gmail reply protocol checkpoint — P-WLK-6 / R41

21 October2026 UTC: isolated branch codex/p-wlk-6-gmail-reply-protocol from
main5b21875. Native PR120 stays separate at c3770ae. Prior goal turn completed
native Agents verification; this turn adds the next provider protocol boundary.

The unbound/default-disabled adapter validates exact owned binding, verified
subject/From and separate send scope; serializes frozen text/recipients/threading;
and performs one bounded POST through mandatory HTTP injection. The invented
launcher uses an inseparable fake transport/credential and persistent synthetic
acceptance ledger. reply.simulate/sim_ contracts, read OAuth and actual-send denial
stay intact. Read-only source review found no consequential issue.

Baseline11 and new8 protocol/durable checks pass; CLI/reply/Google regressions22
pass, including actual CLI normal/lost-provider-response cases. Root types,
affected lint and brand32 pass. Test startup caught an unsupported TS parameter
property, then a revoke test used a nonexistent method; both corrected/rerun.
Shared validator extraction matches the native PR120 helper and keeps semantics.

Practical browser/CLI proof is in progress on own5214 with fresh state under
/var/folders/m4/wq1lz5wj6n5cxzp07hwn9ckh0000gn/T/openjob-r41-proof-h5efrwwr.
Next: queue revision1, save revision2, restart fixture, execute original intent,
inspect synthetic receipt/frozen MIME hash and no replay; clean own resources.
Continue Linear R30 7f612b86-7725-46b1-8474-8a2a680da5eb through reviewed
nondeploying PR delivery. Full R30/R41/live/provider/native/release gates stay open.
Original26 plus four newly observed duplicate-suffix files in the primary checkout
are preserved. Prior Android5213/Metro8088 and foreign simulator stay untouched.

# Native Agents delivery — P-WLK-6 / R22–R53

21 October 2026 UTC: source `62a8fd34c364e8ce9f4ad59376c22c3e54938254` is pushed
on draft PR120, based on main `5b21875`. This supersedes the pending simulator
state below. Native owners can review exact independent-Workspace grants and
confirmed actions, open current saved items, and confirm revocation. One DELETE,
exact acknowledgement and current revoked readback precede success; uncertainty
clears stale access data and requires manual refresh. Issuance remains CLI.

Native types, affected lint and 23 UI/API checks pass, including the fresh locked
copy. Root native-HTTP/CLI/domain/navigation (12), existing native Mail HTTP (3),
actual-send denial/no-side-effect (1), root types, brand (32) and secret safety
(1094 files) pass. Read-only review found no consequential issue. Original 26
shared files hash-match. No dependency or real-account access changed.

The 759-file source snapshot built in `/tmp/openjob-native-agents-a3tmb9zb`, with
one recorded proof-only fixture-port 5213→5214 delta. Fresh npm lock and all 201
locked Pod entries match; ExpoModulesCore/Hermes checksum differences normalize
to absolute-root paths only. The initial Xcode call timed out while compilation
continued; its completed log reported two SwiftCompile commands exiting 0 without
output. One incremental build then explicitly passed in 30.3 seconds (35 warnings,
zero errors). The verified OpenJobDev/dev.openjob.app.dev embedded Release artifact
was reinstalled before UI checks on owned OpenJobR53Connected, iOS 27.

Practical native proof passed: retained Personal shows its existing Agents route;
A displays exact scopes/resources, expiry, last-check time and three confirmed
actions. Action links opened the exact planned Task and standalone Calendar block.
An unfinished human Task title survived Agents/Calendar navigation. Cancel left A
usable through actual CLI. Confirm showed revoked/no effective access; actual CLI
then exited 3 and HTTP returned 401 for A while independent B remained usable
(exit 0/HTTP 200). Saved Tasks/Calendar stayed byte-equal. B's own native view showed
only its grant and no actions; native revocation cleaned it up and HTTP then denied
it. Both created credential files were removed. Invented-data screenshots,
source/fixture manifests, artifact hashes and receipts: `output/r53/native-agents/`.

Only the owned app/simulator and fixture 5214 service were stopped. Build Space
lease `a36660e551508f02aa7f26a8` was released succeeded. Prior Android service 5213,
Metro 8088, source/build artifacts and foreign simulator were preserved. R53 and
full R22 stay In Progress; PR120 stays Draft. Android UI-method answer, native live
login/provider/device/storage, Mail delegation, full sync and release gates remain
open. No real Mail read was repeated and no real provider effect, persistent real
access, security/hosting change, deployment or publication occurred.

Next dependency-ready source slice: R41, a default-disabled Gmail reply protocol
adapter exercised only through an injected fake HTTP transport and the existing
frozen durable-operation fixture. Keep `reply.simulate` synthetic, normal runtimes
without a dispatcher, exact read-only OAuth scopes and real `mail.send` denial.
Continue existing Linear R53 `ba6592c3-b3e1-4908-b830-3532ab70aaf4` and R30
`7f612b86-7725-46b1-8474-8a2a680da5eb`; do not infer real-send permission.

# Native Agents checkpoint — P-WLK-6 / R22–R53

21 October2026 UTC: existing draft PR120 branch, based on bcfb374/main5b21875.
Native Connected Workspaces gains owner review/revoke of existing independent-
Workspace agent grants and bounded confirmed actions. Exact public DTO validation
rejects foreign resources/owners, credential fields and malformed history. Existing
session/epoch guards fence list and DELETE. Confirmation precedes one mutation;
exact200 acknowledgement plus current revoked readback precedes success. Uncertain
results clear stale scopes/history and require explicit refresh, with no retry.
Current-item navigation refreshes saved work and refuses missing/removed items.
Task intents and authored reply buffers survive Agents navigation. Retained Personal
points to its existing Agents view without inferring context type from its name.
Issuance remains CLI; no backend/provider/dependency/real-access capability changed.

Native types, affected lint and23 UI/API tests pass. Twelve actual-native-HTTP,
CLI, scope/revocation/race/preservation and navigation checks pass; the existing
native Mail HTTP flow passes for both homes (3), and real-send403/no-side-effect
passes (1). Root types and brand32 pass in the isolated source copy. Read-only
review found no consequential gap. Native's stricter compiler required explicit
index guards in the shared navigation parser; existing parser semantics/tests
remain intact. Simulator proof for this changed source is still pending.

New independent proof root: /tmp/openjob-native-agents-a3tmb9zb. Fresh native npmci
from the unchanged lockfile applied the existing Sentry patch. Build Space lease
a36660e551508f02aa7f26a8 reserves10GiB with20GiB floor (57.5GiB observed free).
Only its guarded fixture entry selects loopback5214; source/fixture manifests record
the delta so existing Android5213/Metro8088 remain untouched. Prior f8830d8 iOS
artifact and practical proof stay immutable at their recorded input checkpoint.

Next: build/verify this exact source in the owned OpenJob simulator, exercise
review/cancel/revoke and exact action links with temporary invented A/B grants,
then verify CLI A denial/B usability and preserved authored work. Revoke passed
fixture grants, remove their private temporary files, stop only own resources and
release lease with actual outcome. Record final source/artifact/result in Linear
R53 ba6592c3-b3e1-4908-b830-3532ab70aaf4 and PR120. Draft/full R22/R53/live/native
provider/device/storage/Android-method/release gates remain open. No real Mail test
repeated, persistent real access, deployment or publication.

# Current native Mail delivery — P-WLK-6 / R32–R53

21 October2026 UTC: source f8830d805d5cdf5d7a669676fe57d5cae462584f is pushed on
draft PR120, based on main5b21875. This supersedes the pending simulator state in
the checkpoint below. Native metadata paging/folders/search, explicit transient
bodies, freshness/Pause and retained exact Task recovery controls are implemented.
Two read-only review findings were fixed and confirmed resolved. Native types,
affected lint,14 UI/API tests,12 native HTTP/freshness/Google isolation checks,
real-send403/no-side-effect, root types, brand32 and secret1090 pass. Original26
shared files hash-match; dependencies and real-account sessions were preserved.

The exact755-file snapshot (one recorded fixture-port5213→5214 delta) built as
OpenJobDev / dev.openjob.app.dev / embedded Release on owned OpenJobR53Connected,
iOS27. Locked npm inputs and all201 Pod entries match; two Pod checksums change
only absolute paths. Initial deployment-mode Pod install rejected those paths;
normal no-repo-update install passed. XcodeBuildMCP's first call timed out300s
while the compiler continued. Its process finished; a subsequent incremental
build explicitly passed in70.8s with35 warnings/zero errors. The verified artifact
was reinstalled before UI proof; binary/bundle/plist hashes and logs are recorded.

Actual simulator proof passed: metadata before Read message, body open/close,
Pause, Next page, submitted search, folder selection and empty result; authored
title retained across filters/pages. Explicit receipt opened the reviewed Task;
schedule21October14:00–14:30UTC linked Calendar to that exact Task, then completion
retained the block. Current source and reviewed Reply all saved54 authored
characters at revision1. Text survived Calendar navigation/authority refresh;
stop/relaunch reopened exact body/mode/account/recipients. Disconnecting only the
invented5214 account made Refresh Mail hide metadata/body and stop auto refresh,
while retaining the authored title and denying create. Authenticated HTTP confirmed
saved Task/Calendar/reply, and saved work stayed byte-equal across disconnect.

Device Hub AX setValue corrected ineffective Xcode replacement input; no keyboard
setting changed. A receipt-script assertion initially used nonexistent plannedStart;
corrected to scheduledSlot and rerun. These automation mistakes are not app passes.
Practical evidence, source/fixture manifests and two invented-data screenshots:
output/r53/r32-native-mail/. Snapshot/build: /var/folders/m4/wq1lz5wj6n5cxzp07hwn9ckh0000gn/T/openjob-native-r32-jkx3l0kk.
Owned simulator shut down, own5214 service stopped after disconnect, Build Space
lease60fb2b0fa7739f6dcc186c67 released succeeded. Existing Android5213/Metro8088
sessions, artifacts and foreign simulator were preserved.

PR120 stays Draft and R53 stays In Progress. Android method answer, native live
login/provider/device/storage/release gates and full sync remain open. No repeated
real Mail read, real provider effect, persistent real access, deployment or publication.
Next bounded slice: native review/revoke of existing independent-Workspace agent
grants and recent confirmed actions, using delivered R22 contracts; issuance stays
in CLI. Continue R53 discussion ba6592c3-b3e1-4908-b830-3532ab70aaf4, linked to R22
266d9fdf-fa1e-4e9d-9d03-7b234821a591 / receipt33d528ea-e2a8-4dfd-9e9f-759a3cba5c2e.

# Native Mail follow-up — P-WLK-6 / R32–R53

21 October 2026: native source checkpoint on the existing draft PR120 branch,
based on 84c502d4af39da53bcd0f03c8d6c4218db84d4b1 and main5b21875.
Connected Workspaces now use metadata-only First/Next pages, bounded Gmail folder
selection and submitted search, explicit transient plain-text bodies, last-read/
stale/expiry state and at-most-minute visible-first-page refresh. Hidden, offline,
expired or changed contexts discard provider details and late responses; recovery
is explicit. Pause also fences an already queued refresh callback.

Authored Task titles, immutable uncertain create inputs and receipts remain above
the disposable reader. Navigation does not auto-open a completed mutation. Exact
retry preserves an additional Task UUID. Two-step Stop retrying warns about an
existing Task, drops only that uncertain request and keeps title/previous receipt,
so deleted sources do not permanently lock folder/search/page controls. Existing
source/reply editors and normal native authentication remain in place. No package,
consent, provider Calendar, sending or persistent real-access capability changed.

Native typecheck, affected lint and14 focused rendered UI/API tests pass. Actual
native HTTP/coordinator, shared freshness and Google scope/revocation/isolation
checks pass (12), including metadata query-bound cursors and explicit body reads.
A targeted actual-send403/no-side-effect check passes. Root npm run typecheck and
brand32 pass in the exact isolated copy. The initial test typecheck caught global
vs globalThis in the timer test; corrected and rerun. Original26 shared files are
preserved. Simulator proof is In Progress, not implied by these tests.

Fresh locked native dependencies and development iOS prebuild are in
/var/folders/m4/wq1lz5wj6n5cxzp07hwn9ckh0000gn/T/openjob-native-r32-jkx3l0kk.
Only that proof's fixture entry changes loopback5213 to5214 to preserve the existing
Android fixture/Metro; the delta/hash is recorded there. Build Space lease
60fb2b0fa7739f6dcc186c67 reserves10GiB with20GiB floor. CocoaPods deployment mode
first rejected absolute-path-derived checksums for ExpoModulesCore and Hermes;
podspec comparison showed path-only changes. Normal no-repo-update install and
locked-version comparison follow. No shared dependency tree was repaired.

Next: verify the exact source in the owned iOS simulator, record its artifact and
practical result, then update this handoff/Linear/PR120. Android UI-method answer,
real native/provider/device/storage acceptance, full sync and release/distribution
remain separate. No extra real Mail read or deployment/publication occurred.

# Current native integration — durable operation main

21 October 2026: draft PR120 integrates PR129/main
`5b218755605120c4c734aec7f1db6862b077bdc2` at merge source
`b26fcc01fdc7cfeb73751ea21a18a9291a375ec4`. Only FEATURES.md and this handoff
conflicted; both feature/history records are preserved. The new main adds the
bounded fixture Operation/service/API/CLI/web flow. Native files, packages and
identity configuration are byte-identical to prior native `8c8b4f3`; its controls
do not gain a dispatcher.

All 750 tracked files at that merge source hash-match a fresh isolated archive.
Native types and 16 focused actual-native-HTTP/source/reply/operation checks pass,
including independent and retained Personal homes. Root npm run typecheck passes
after its normal Cloudflare declaration generation; an initial raw tsc attempt
failed because the archive had no ignored generated Cloudflare types. Shared
primary dependencies/sessions were not changed. PR129's 47 focused tests, explicit
real-send denial and practical browser/CLI proof cover identical operation source;
no redundant full test suite or native build was run. Secret scan 1085 passes.

Original 26 files hash-match. Of 25 recorded build-source hashes, 23 match; the
previously extended HTTP regression and shared/connected-reply.ts differ. The
latter only adds sameReplyPlan, unused by the native client; all functions it
imports are unchanged. Prior iOS/Android binary/runtime evidence remains at its
recorded checkpoint, not a new current-hash native build. Existing APK, Metro,
fixture sessions and simulator evidence are preserved.

PR120 stays Draft. Android UI-method answer, native Mail/agent controls, integrated
live/native/provider/device acceptance and release/distribution remain open.
No extra real read, provider effect, persistent access or deployment/publication.
Receipts: output/r53/r30-main-integration/ and native-integration-receipt.json.
Continue the existing Linear/roadmap queue; the broader R30/R31 policy/runtime/
cleanup and live-send gates remain open after its bounded fixture foundation.

# Native integration history — Workspace Mail main

21October2026: draft PR120 integrates PR128/main e483988b9b92ecfbb7ab644f1b871d559d3433bd
(web sourcec4e5f09e7e093714899c98e890f96835101b58e7, reviewed PR head
8e244a3382a89cc87e1f8953a69a334e5e1a138c). Only FEATURES.md and this handoff
conflicted; both histories are preserved. Native/db/server/package bytes are
unchanged relative to prior native927668d; the neutral catalog type extraction
was already identical. The integration adds web Mail composition, its four
boundary tests and usage/history records, with no native behavior change.

All739 tracked source files hash-match the existing isolated proof environment.
Root/native types and four new Mail boundary tests pass; secret1074 passes.
PR128's15 tests/practical web flow/brand32/lint evidence remains at the same web
source; prior native17 actual-HTTP/source/reply/agent checks cover the unchanged
backend/native runtime. No repeat native build or wider suite is warranted by this
web-only integration. Primary root dependencies remain incomplete as previously
recorded; exact-source isolated checks supply compile evidence.

All24 app runtime/package/identity input hashes and original26 shared files still
match, with only the previously expanded recorded HTTP test differing from its
build manifest. Existing iOS fixture journey and Android APK/Metro/fake5213 proof
remain intact. PR120 stays Draft: Android UI-method answer, native Mail controls,
live/provider/device and release/distribution evidence remain open. No further
real read, persistent access, provider effect, deployment or publication. Exact
pushed head and receipt live in Linear R53 and output/r53/native-integration-receipt.json.

# Native integration history — owned Workspace agent main

21October01:27UTC: draft PR120 integrates PR127/main4263b46bab3564f1369dce829b40d30eae1dbb95
(R22 source7b59ba0414d8a9378c65d56486ff1cb7d40c68b9, reviewed head
aee7f4f439168429404d27ba70bf476e61f3beaf). Only FEATURES.md and this handoff
conflicted; both feature/history records are preserved. Native runtime/package/
identity bytes remain unchanged. Human connected snapshots retain their shape;
new agent sidecars remain private and survive native/human edits.

The exact734 tracked source files were hash-verified in the existing isolated
proof directory openjob-native-current-main-iv1yv0rr. Root/native types and17
focused native actual-HTTP, Task-source/reply and agent isolation/race/sidecar
checks pass there. The native HTTP flow covers both independent and retained
Personal homes, including provider401 reconnect409 and retained saved drafts.
OpenAPI43/60, generated CLI types, brand32 and secret1069 pass. Primary native
types pass too; primary root types/tests failed on missing imports because its
existing node_modules lacks google-auth-library/email-addresses. No root install
or shared dependency/session change was made. The isolated pass uses the exact
merged source rather than treating that dependency failure as a pass.

All24 recorded app runtime/package/identity input hashes and original26 shared
files still match. Only the recorded HTTP test differs from the original build
manifest, as documented previously. Existing iOS fixture proof and Android APK
remain evidence at their recorded unchanged app inputs; no Android UI pass is
inferred. PR120 remains Draft pending Android UI-method answer and its separate
live native/provider/device/release gates. Native agent controls and R32 native
search/paging/lazy/freshness controls remain unavailable. R22's bounded owner
Tasks/Calendar milestone is delivered; its broader policy/Mail acceptance remains
In Progress. Exact PR head/receipt and next action are recorded in Linear R53.
No further real read, provider effect, persistent access, deployment or release.

# Native integration checkpoint — PR126 history

21October00:44UTC: PR126 merged as4eb212f65cadc3d7190305e755bba60a4ab10303
(source163ffbcb07f0b71ed9eaa55444c2353e53ed7f65, head
a180375256228a66877c8e99abd37a09bddb6a02). Main includes PR125 freshness and the
provider-auth correction. Draft PR120 now integrates that main; the final merge
changes only this handoff relative to reviewed integration314752e. All code bytes
match the isolated final HTTP proof. No additional build/test rerun is necessary
for this documentation-only ancestry reconciliation. Exact remote head/merge are
recorded in Linear and the ignored local integration receipt.

Native runtime/package/identity inputs remain unchanged; one recorded HTTP test
was extended. Original26 files hash-match. Android SDK UI-method authorization,
live native/provider/device and release gates remain open; PR120 stays Draft.
No additional real read, provider effect, persistent access or deployment.
Next source implementation is the accepted owner-only Tasks/Calendar agent-grant
slice in Linear R22 thread266d9fdf-fa1e-4e9d-9d03-7b234821a591. Its initial empty
branch was made from7dc3d02; integrate current main before implementation. Keep
Personal/Groups grants independent and Mail delegation unavailable.

# R30 fixture foundation — delivery history

21 October 2026: source `7bb253352485723abc0bd0fc8cd3fe810640e566` in
[PR129](https://github.com/scwlkr/openjob/pull/129) follows main `e483988`.
Linear execution discussion: `7f612b86-7725-46b1-8474-8a2a680da5eb`.

The invented Google launcher now freezes a reviewed saved reply into private
payload, redacted operation and leased job records. Shared Workspace API/CLI and
the existing reply UI enqueue accepted intent, explicitly run a bounded injected
simulation and inspect confirmed/rejected/unknown outcomes. The launcher persists
every operation commit before runner acknowledgment and restores the original
invented connection across process restarts. Normal/portable runtimes receive no
dispatcher; Google consent and real-send denial are unchanged. Usage and limits:
[docs/REPLY_OPERATIONS.md](docs/REPLY_OPERATIONS.md).

Verification: 47 focused tests plus one existing real-send HTTP 403 case; root
types, affected lint, OpenAPI 46 paths/64 operations, generated CLI types, brand
32 and secret scan. Source review fixed an editor race, confirmed resolved.
Actual headed browser recovered exactly one queued operation after a deliberately
lost accepted response. It reopened saved draft revision 2 after process restart,
then confirmed the original frozen revision 1 with identical hash/body/addressing.
A forced overlapping queue/save response kept the newest text and did not restore
a cleared request ID. Three simulations confirmed; final authored revision 4 kept.
Sam was denied without Alex's content. Layouts fit at 390/768/1200; operation
controls are at least 44px. Only expected injected failure/admission console errors.
Evidence: `output/playwright/r30-operations/` (local, invented content only).
Own synthetic connection disconnected and own browser/5214 stopped; authored
fixture state retained at `/tmp/openjob-r30-reply-state.json`.

This closes only the bounded synthetic foundation. R30 still needs production
scheduler/cleanup and selected runtime/data policy; R31/live send, provider
Calendar and broader permission policy remain separate. The receipt-expired flag
does not delete records; the pilot index is capped at 100 operations per owner.
Continue the existing roadmap/Linear queue from this delivered foundation.

Native draft PR120 was preserved at `8c8b4f394d6213eff1e18635904d965949b2057f`
during this work. Integrate the eventual merged main and verify its affected
boundary before claiming current-head native coverage. Installed app inputs,
Android APK/Metro/fixture sessions and the original 26 files are preserved; the
26 hashes match. Android UI-method answer remains pending. Do not repeat the
completed real Timothy read or infer new real access/release authorization.

# P-WLK-6 / R20–R33 — Mail inside its assigned Workspace

21October2026: sourcec4e5f09e7e093714899c98e890f96835101b58e7 follows merged
PR127/main4263b46bab3564f1369dce829b40d30eae1dbb95. The owner-pilot shell now has
Mail beside Today/Tasks/Calendar/Agents, scoped to the connection's fixed home.
It reuses the existing metadata/folder/search/page/lazy-body/freshness reader and
shared API. Optional exact-Task callbacks keep source creation inside /workspaces;
Connections retains its existing links. Setup/consent/refresh/disconnect remains
central. No new provider capability or admission/access activation.

Reviewed Task intents live in retained owner/Workspace memory above disposable
provider views. Module/context switches clear reader content and timers, preserving
authored titles/receipts/pending UUIDs and existing reply buffers. The shared signed
Connections request keeps session abort fences, public error codes and no mutation
retry. Public catalog types move to a neutral shared file identically to native
PR120's pending extraction; private Google state remains server-owned.

15 focused scope/request/freshness/source/reply tests pass, root types, affected
lint, brand generation/check32 and secret732. Read-only source review has no
findings. Actual390px browser completed retained Personal Mail→reviewedTask→notes→
OpenJob plan→complete→freshsource→correctlyaddressed saved Reply all in /workspaces.
A→B→A kept authored title and unsaved reply; refreshed address review retained text
before saving revision1. B showed no account. Injected additionalTask503 kept one
UUID/title across switches; explicit confirmation sent the exact same input, yielded
two total Tasks and cleared pending.65seconds hidden produced zero Mail reads.
Delayed body could not restore into B. Central Connections disconnect then blocked
Mail/source while Task/notes/block and saved reply remained; no provider body on
disk or reply text in public work. Sam was denied admission without Alex content.
Final390/768/1200 layouts fit with44px Mail buttons. One Playwright check() reported
before asynchronous completion settled; the observed checkbox and saved fixture
confirmed completion, with no second click. Expected503/409/403 network faults are
recorded, with no unexpected JavaScript errors. Evidence: output/playwright/r33-
workspace-mail/. Own5214/browser stopped after disconnect; fake authored work kept.

Continue Linear project discussion779e97e0-bebf-48ff-9e10-5775355c00a5. This closes
only the bounded web shell follow-up; R33 live integrated acceptance, full R32 sync,
provider Calendar/send and native/provider/device/release gates remain. Do not
repeat the completed standalone real alternate read. Native draft PR120 is at
927668df5513a9d8d035e3ac302948faa3f6db65 with PR127 included and unchanged build
inputs; integrate this new main before eventual delivery. Android UI-method answer
remains pending. Original26 files and existing native proof sessions are preserved.

# P-WLK-6 / R22 — scoped owned Workspace Tasks/Calendar agents

21October01:20UTC: source7b59ba0414d8a9378c65d56486ff1cb7d40c68b9 follows merged
PR126/main4eb212f65cadc3d7190305e755bba60a4ab10303. The previously empty R22 branch
now implements exact owned Workspace Tasks/Calendar grants through shared API,
existing CLI and the Workspace Agents UI. Human owners issue24-hour credentials
into a new private0600 file; service stores only a hash. Agents receive filtered
read families and minimal write receipts, with no human-session fallback. Current
owner/sponsor, grant/expiry/hash and exact resources/operations fence each call;
same-document CAS and active-User fences prevent stale writes beating revocation.
Linked Task/Calendar mutations require both writes. Normal runtime stays disabled
without existing explicit pilot admission; no real access was activated.

The UI reviews exact scopes/resources/expiry/revocation and200 bounded confirmed
actions, linking retained Tasks/blocks. A failed revoke clears stale metadata and
requires explicit refresh. Mail/source/reply sidecars survive human and agent work.
Mail delegation, administration, Home/catalog and availability planning are denied
to these credentials. Source review found one authorization-annotation mismatch,
fixed before delivery; final review reported no findings. The secret scanner now
rejects all three agent credential formats without printing them; two old fake
credential-shaped response examples were removed while preserving their schemas.

36 focused domain/API/CLI/secret tests pass, plus final root types, affected lint,
OpenAPI43paths/60operations, generated CLI types and brand generation/check32.
Actual CLI + headed browser proof used only synthetic Alex/Sam: created Task,
notes and planning; created a Calendar-only block; followed exact work links;
injected revoke503, explicitly recovered and revoked. After restarting the same
saved fixture, the revoked credential returned401, an independent Family grant
still returned200, Calendar-only reads excluded Tasks/notes/Task IDs, and its Tasks
CLI was denied. Sam saw neither Workspace. Width390/768/1200 fits; action targets
are44px. Evidence: output/playwright/r22-agents/. Own5214 fixture/browser stopped;
all synthetic grants revoked/private token files removed, authored fixture work
retained. Original26 untracked files hash-match; native PR120/builds/sessions intact.

Usage: docs/WORKSPACE_AGENTS.md. Continue existing Linear R22 discussion266d9fdf-
fa1e-4e9d-9d03-7b234821a591. This closes only its bounded Tasks/Calendar owner-pilot
milestone; Mailbox-set delegation, multi-person sponsoring rights/lifecycle,
broader policy, native controls and integrated live acceptance remain. R53's
Android UI-method answer is still pending. Native PR120 needs this new main
integrated before eventual delivery; no device/live/release claim follows from
web checks. Do not repeat the completed standalone real alternate Gmail read.

# P-WLK-6 — Mail reconnect preserves OpenJob authentication

21October00:40UTC: source163ffbcb07f0b71ed9eaa55444c2353e53ed7f65 corrects a cross-client P2
found while integrating PR125/main7dc3d023939080ebe92023066c5656589109c3aa into
native draft PR120. Configured Gmail authentication failures returned401, which
native treats as an ended OpenJob session. The Connections boundary now returns
reconnect_required409 for upstream authentication_required. Invalid/missing OpenJob
identity still returns401; current-access checks and provider denial remain intact.
No native runtime/package or response-shape change was needed.

10 focused freshness/flow/runtime-CLI checks pass, plus root types and affected
lint. The integrated native HTTP regression passes both independent and retained
Personal homes (3tests), checking provider401 during Mail/source/reply/save becomes
409, Task access remains and the unchanged saved reply reopens after recovery.
That regression lives in draft PR120, which owns the native feature. Read-only
review confirmed the P2 resolved with no new findings. The original26 files and
native app build inputs are preserved; only the HTTP test expands. Android UI-method
approval remains pending; no native/live/device/release pass is inferred.

PR125 freshness/browser evidence remains valid apart from its superseded assertion
that an upstream auth failure should return401. No additional real read, provider
effect, persistent access, deployment or publication. Continue Linear R32 thread
845d4c0c-61a1-4a62-b9c3-96d0b5e3473a. The next source-only product slice is owned
Workspace Tasks/Calendar agent grants in R22 thread266d9fdf-fa1e-4e9d-9d03-7b234821a591;
its empty branch starts at main7dc3d02 and source implementation has not begun.

# Native draft integration — current Mail read contracts

21October00:35UTC: integrate main7dc3d023939080ebe92023066c5656589109c3aa
(landed PR123 search, PR124 lazy bodies and PR125 freshness) into draft PR120.
Only FEATURES.md and this handoff conflicted; both product/delivery records are
retained, with the provider-auth correction described below. This supersedes the older integration
records below. The native full-read contract stays exact; native paging/search,
metadata/lazy controls and freshness remain separate. R32 current-page polling is
bounded, not complete mailbox history sync; integrated live acceptance remains open.
Original build artifacts/services and the completed bounded real read are preserved.
Android SDK UI-method authorization remains pending and PR120 stays Draft.
All24 recorded runtime/package/identity input hashes and original26 shared files
match; only the recorded native HTTP test expands for the regression below. The
isolated merged source passes root/native types, actual authenticated native HTTP
flow for both home types (3tests), OpenAPI39/55, generated CLI types, brand32 and
secret1059. Initial direct tsc lacked ignored Cloudflare runtime declarations; the
normal npm typecheck generated them and passed. A review P2 was fixed: provider auth failure becomes409reconnect_required, keeping
401 for OpenJob authentication. Final actual HTTP3 regression checks Mail/source/
reply/save plus retained Tasks and unchanged saved draft after provider recovery.
Review confirms no remaining findings. No native runtime or installed build changed;
prior native suites/platform evidence retain their exact recorded app inputs. No
Android/live/device/release pass is inferred.

# P-WLK-6 / R32 — bounded Mail freshness and retained Task requests

20October2026: source1d041d5dd6d2afaff478e493647a6b9882e9f84d follows PR124/main
ff1815be682a03e031295334ab0539836609c1dc. Metadata-view responses add conservative
observedAt/staleAt/expiresAt bounds: observation starts before the scan, stale after
at most60seconds, expiry at most5minutes and capped by the current credential.
Final current-access checks run on success/failure. Full/native, exact-body and
standalone response shapes stay unchanged. Freshness never authorizes access.

Web keeps one transient metadata page and one explicitly opened body; no parent
copy or disk cache. Request-start monotonic and elapsed wall-time limits prevent
transit, clock rollback or sleeping timers from extending the view. Expiry clears
messages/folders/cursors/body and stops automatic reads. Visible first-page polling
is sequential and at most once per minute; it pauses while hidden/offline, reading,
confirming a Task or viewing later pages. Any failure clears content and latches a
stop until explicit action. Synchronous current-window/pause guards reject old timer
callbacks. Refresh Mail retains applied filters; invalid cursor restarts page one;
missing folders have an explicit Read All Mail recovery preserving search. Provider
401/scope/policy errors remain fixed redacted blocked categories.

Reviewed titles, exact additional request IDs and receipts now live above disposable
Mail pages in owner-epoch Connections memory, without provider summaries/bodies or
untouched subject defaults. Pending cards survive expiry/refresh/disconnect, never
auto-retry, and can check Workspace in a new tab. Explicit two-step Forget warns a
Task may already exist, retains the title and frees navigation. Leaving Connections,
reload, identity change or sign-out clears this memory; no durability claim.

25 focused API/domain/CLI/source/reply checks pass; final freshness3 rerun plus14
standalone checks pass (overlapping groups). Final types/affected lint, OpenAPI39/55,
generated CLI types, brand generation/check32 and secret scan pass. Four review P2s
were fixed and confirmed. Browser caught a fifth stale-pending-fields bug on a200
retry: normalized target IDs now prevent old draft fields entering a confirmed row.
Fresh final fixture proved503 -> expiry -> explicit refresh -> same UUID/title ->200
and a clean confirmed UI. It also proved open-body expiry/clearing, explicit Forget,
disconnect and Sam isolation. Earlier same-source logic proved bounded auto reads,
no reads after blocked403 even after121seconds of controlled time, and missing-folder
All Mail recovery retaining search. Phone width390, checkbox label target46px; no
overflow. Synthetic screenshots/receipt/CLI history: output/playwright/r32-freshness/.

No additional real read, provider effect, persistent access, deployment or release.
Original26 files hash-match. Native PR120/build inputs remain untouched and Android
UI-method authorization is still pending; current-main integration remains necessary
before its eventual delivery. R32 still needs global/history sync and tombstones,
integrated live acceptance and native freshness/lazy controls. Current-page polling
is not a complete mailbox sync. Continue the existing Linear R32 thread845d4c0c-
61a1-4a62-b9c3-96d0b5e3473a and roadmap; do not repeat the completed alternate-only read.

# P-WLK-6 / R32 — explicitly requested connected Gmail bodies

20October: source f4226dae06c14d93bd1cd2e1ba36bc2959e87aa9 follows merged search
PR123/main161538dec4fd5ee791325c89cca235e45026a5e0. Configured web browsing now uses
GET Mail?view=metadata: summaries contain headers/identity/labels/date/read state,
with no body or snippet. Gmail requests format=metadata and only Subject/From/To
headers. The existing full Mail response remains exact for current native/clients;
standalone one-read behavior is unchanged. This is an explicit representation
choice, not a provider permission or a new credential path.

Read message uses GET /connections/{id}/mail/{upstreamId} for one fresh full read.
Account/home derive from the connection, current owner/binding/expiry/consent/profile
checks fence provider calls, and current access is checked on both success/failure
before disclosure. Queries and malformed/foreign routes fail closed. Deleted Mail
returns redacted message_unavailable404 and leaves authored Tasks. Exact Task-source
and reply reads remain full/filter-independent; Task creation now verifies metadata
without fetching a body. CLI: mail --metadata-only and message <id> <upstream-id>.

The web holds one opened body in component memory, clears it on close/navigation,
and keeps the Task form/title/receipt mounted through open/close/failure. Pending
additional Task confirmation blocks body opening/search/navigation. Plain text uses
inert React rendering, bounded existing MIME/base64/UTF-8 decoding and explicit
HTML/attachment-unavailable fallback. No attachment requests or remote-image fetches.
Decoder tightening skips nested message containers and rejects non-ASCII content
that declares US-ASCII. The official metadata read contract was checked:
https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get.

43 focused adapter/API/CLI/source/reply checks and14 standalone-session checks pass
(overlapping groups, not cumulative). Types, affected lint (two existing warnings),
OpenAPI39paths/55operations, generated CLI types, brand32 and secret safety pass.
Independent source review found no issues. Practical headed390px browser proved
metadata response without body, explicit first/second-page reads, edited title and
created-Task receipt retained through close, injected unavailable-body recovery,
uncertain additional Task blocks body opening then confirms, paging clears bodies
and retains title, delayed full response cannot restore Mail after disconnect, and
Sam sees no Alex connection. Body control44px, document/viewport390px. Synthetic
screenshots/receipt/CLI history: output/playwright/r32-bodies/.

No additional real read, provider effect, persistent access, deployment or release.
Original26 files hash-match. Native PR120/build inputs remain separate and unchanged;
its existing full-read consumer remains eager, and Android UI-method authorization
is still pending. R32 still needs sync/metadata lifetime/stale state and integrated
live acceptance. Native metadata/body controls and eventual default-contract
convergence remain open. Continue the same Linear R32 thread845d4c0c-61a1-4a62-b9c3-
96d0b5e3473a; do not repeat the completed alternate-only real read.

# P-WLK-6 / R32 — connected Gmail search

20October: source d923fd0a2185f8a5c0dce3411646747f3ce2fecd adds submitted Gmail
search through the configured adapter/API/existing CLI/web. Search is scoped to
the verified account and selected Gmail label; outer whitespace is trimmed while
operators, case, internal spaces and Unicode are forwarded unchanged as Gmail q.
Input is nonblank, at most512 JavaScript characters, with no control characters.
Canonical gm3 cursors bind a SHA-256 query fingerprint plus folder, owner, account
and Google subject. Old or mismatched cursors require page one. Query text is not
stored in cursors or connection persistence. Provider400 on the first search page
returns redacted search_rejected; a later-page400 remains invalid_cursor. Neither
retries silently nor falls back to unfiltered results.

Web editing and applied search are separate: Next/First/folder changes use the
submitted query; Search Mail and Clear search reset page one. Bodies replace per
page. Authored titles survive query changes. Pending/unconfirmed additional Task
requests block search, folder and paging until confirmed. Exact saved source/reply
identity stays independent of filters. The existing client accepts --search along
with --folder and a matching --cursor; other Connections routes and the standalone
one-read route retain their query prohibition.

Thirty-nine focused adapter/flow/source/reply/API/CLI checks and fourteen standalone
session checks pass (overlapping groups, not cumulative). These cover exact Unicode
query forwarding, maximum bounded cursors, denial before provider/credential access,
owner/folder/query binding, redacted errors, empty results, unchanged exact Task
source, query nonpersistence, disconnect and real-send denial. Root types, affected
lint (two pre-existing warnings), OpenAPI38paths/54operations, generated CLI types,
brand32 and secret safety pass. Independent source review found no issues.

Practical headed fixture browser: unsent edited input leaves Next on the applied
query; submit gives empty results; Clear restores browsing and authored title;
rejected query clears bodies and offers edit/clear; injected cursor error recovers
first page with query retained; Review retains query and resets page one; additional
Task uncertainty disables search/folder/page controls, then retry confirms it;
disconnect clears Mail and Sam sees no Alex connection. At390px, search height44px
and document/viewport widths390px. Screenshots/receipt: output/playwright/r32-search/.
The fixture recognizes only explicit invented queries; it does not emulate Gmail's
full search parser. This is connected-flow fixture proof, not live Gmail acceptance.

No additional real read, provider effect, persistent access, deployment or release.
The original26 files remain byte-identical. Native PR120 and its unchanged build
inputs remain separate; Android UI-method authorization is still pending. R32 still
needs lazy bodies, sync/stale metadata and integrated live acceptance; native
search/folder/paging controls remain separate. Continue the existing roadmap in
Linear thread845d4c0c-61a1-4a62-b9c3-96d0b5e3473a; do not repeat the completed real read.

# P-WLK-6 / R32 — configured Gmail folder selection

20October: source 7bd06e8784912166af053e146b1ddd74a8934955 extends merged PR121 with one
account-qualified Mail folder selection through adapter/API/existing CLI/web.
The picker uses returned Gmail label IDs and display names, validates against the
current label list, and binds selected folder/null into canonical gm2 cursors.
Old gm1 and mismatched folder cursors require a first-page restart. No persisted
cursor migration or sync claim. Duplicate/unknown queries and other-account refs
fail closed; simulated and standalone session query input stays prohibited.

Next/First page retains the selected label; changing folders resets to page one.
Authored titles survive both transitions. Uncertain Task requests block both picker
and paging. Missing folders clear bodies and offer All Mail/another folder recovery.
Explicit Spam/Trash selection sets includeSpamTrash. Ordinary results also recheck
current message labels to omit messages moved there after listing (review P2 fixed).
Exact source/reply reads stay independent of labels; authored Tasks survive movement
or label removal. [Provider contract](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

Thirty-five focused adapter/flow/source/reply/API/CLI checks passed, including actual
loopback runtime/CLI folder+cursor forwarding. Fourteen standalone-session identity,
lease, revocation and unsafe-operation checks also passed. Earlier groups overlap.
Final source types/lint pass (two pre-existing warnings); OpenAPI38paths/54operations,
generated types, brand generation/check32 and secret-safety scan726 pass. Independent
review confirmed the moved-to-Spam/Trash fix and found no remaining issues.

Practical headed browser proof: Inbox pagination, Review resets to page one, edited
titles retain across labels/pages, empty Spam, injected missing-folder recovery,
uncertain additional Task disables the picker until confirmation, disconnect clears
Mail and Sam sees no Alex connection. The final source was restarted in a fresh
fixture and folder/page/title/disconnect/isolation flow rechecked. At390px, picker
height44px and document/viewport widths390px. Connections now applies its existing
Workspace control styles so controls receive semantic brand roles and touch sizing.
Synthetic screenshots and receipt: output/playwright/r32-folders/.

No real read, provider effect, persistent access, deployment or publication. The
original26 files remain byte-identical. Native PR120/source/build inputs remain
separate and Android UI-method authorization is still pending. R32 still needs
search, lazy bodies, sync/stale metadata and integrated live acceptance; native
folder controls are separate. Continue those existing roadmap gaps in the same
Linear thread845d4c0c-61a1-4a62-b9c3-96d0b5e3473a; do not repeat the real read.

# P-WLK-6 / R32 — configured Gmail page continuation

20October: source d36cd954180b5636d01e58257abd1ad287b72a40 makes the adapter's nextCursor
reachable through configured Connections API, the existing CLI and web Mail.
Only configured Google GET /connections/{id}/mail accepts one bounded cursor;
unknown/repeated queries and foreign owner/account/subject cursors fail closed.
Other Connections routes and simulated onboarding keep their query prohibition.
Invalid cursors return a redacted400 with first-page recovery. Current account,
home, expiry and disconnect checks still fence every page and in-flight result.

Web Next page / First page replaces message bodies rather than accumulating them.
Edited Task titles stay in memory while paging within that mailbox. Pending Task
requests, including an unconfirmed additional Task, block paging until confirmed.
API/CLI proof reaches message eleven, creates its exact source-linked Task, returns
to page one, then rereads the correct source. A deleted source leaves authored work.

Practical loopback browser proof passed at390px: two pages; edited titles retained
both ways; injected invalid-cursor recovery; page-two Task -> normal Workspace ->
correct source; interrupted additional Task -> paging denied -> retry confirmed;
disconnect clears bodies; Sam sees no Alex connection. Expected503 standalone
session discovery, injected400/503, and Sam403 errors are not provider failures.
Synthetic screenshots: output/playwright/r32/page-two-{phone,task-source}.png.

Thirty focused checks passed (29 adapter/flow/source/reply/CLI regressions plus one
actual loopback portable-runtime/CLI composition). Root types, affected lint
(two pre-existing warnings), OpenAPI38paths/54operations, generated CLI types,
brand32 and tracked-source secret scan passed. Read-only review found no issues.
Source delivery is authorized and the repository has only a manual artifact workflow,
no push/PR publish job, no branch protection/ruleset or recorded deployment.

R32 remains incomplete: connected search/folders, lazy body loading, sync/stale
metadata and actual integrated live work remain open. Native paging is separate;
native R53 stays in draft PR120 with its prior iOS proof and pending Android
UI-method authorization. Its source/build/Metro inputs were left untouched.
The standalone real read remains completed once and disconnected; this slice used
only invented fixtures and granted no new provider access. Original26 files stay
byte-identical. Linear execution thread:845d4c0c-61a1-4a62-b9c3-96d0b5e3473a.

# WLK385 — correctly addressed authored replies from connected Mail

20October: source87d4082971a4ebdde5754af8df968316ac942633 completes the next
bounded R33 slice after PR117/118. One local implementation owner; read-only review
found and then confirmed the fix for unfinished-reply deletion. Same authoritative
Personal/Owned envelopes retain private OpenJob drafts, separate from source bodies
and ordinary Task/Calendar, offline, Home/export and agent DTOs. All central writes
preserve drafts within combined byte limits. Task deletion prunes source links but
keeps saved authored replies; recreating the same source Task reopens its draft.
Disconnect denies draft/source reads and saves; authorized reconnect recovers it.

App/API/existing CLI share fresh source-derived From, Reply-To-or-From, explicit
reply/reply-all, deduplicated To/Cc excluding self, subject and RFC Message-ID /
References threading. Bcc and automatic quoting never enter the draft. Address parsing
uses pinned email-addresses5.0.0 (MIT, bundled types, no install script). Unsupported
headers fail closed. Full-envelope review tokens reject stale addressing; revisions
prevent lost edits; exact same-body/envelope retries return the saved revision.
Unsaved editor text stays through Workspace modules; save before leaving/reloading.
Dirty replies block Task deletion until saved or explicitly discarded. Saved drafts
are OpenJob records only: no provider draft writes, sending or external Calendar.

Practical browser proof on isolated loopback fixture: invented Mail -> edited Task
-> normal Calendar block20October14:00–14:30UTC -> completed Task -> source ->
Reply-To and reply-all From/To/Cc review -> authored draft -> Calendar/linked-Task
round trip retains unsaved text -> save -> reload reopens exact text/account/mode.
Attempted Task deletion with unsaved reply was refused; explicit discard preserved
the saved draft. Sam could not access Alex's connection. Disconnect then source
reopening denied while Task/block stayed. Responsive390/768 widths had matching
content width. Temporary viewport/emulation overrides cleared. Synthetic screenshots
only: output/wlk-385/reply-{saved-desktop,phone,tablet,disconnected}.png.

Focused API/CLI tests additionally cover independent Owned and retained Personal
homes, normal writes/agent grants/offline sync preserving drafts, reconstruction,
concurrent stale edits, changed source envelope, exact retry, source recreation,
foreign owner/home, agent denial, oversized input and in-flight revocation. Compile,
affected lint, OpenAPI38paths/54operations, generated types, brand32 and root secret
scan pass. The later targeted regression group passed59 checks; earlier groups overlap
and are not cumulative. Root shared dependencies/output were left unchanged; proof
used fresh npm ci --ignore-scripts after inspecting root/native install scripts.
All source files hash-match the isolated snapshot. Original26 untracked files remain
byte-identical. Initial isolated build failed because the copy has no.git; retry uses
the build's explicit OPENJOB_GIT_COMMIT input and passed all five bundle stages,
without modifying build/protection rules.

No repeat live read, Mail content capture, live saved-work writes, operator/1Password,
new credentials/security settings, provider effects, deployment/publication or native
release. Existing Timothy session/5202 launcher preserved, disconnected and key-free.
This is fixture delivery, not full R33 live acceptance. Next: connect the same saved-
work flow to an approved memory-only live test without acquiring persistent provider
access; preserve the remaining runtime/data-write approvals and native release gates.
R41 editable composition/send and R40 provider Calendar remain later work. WLK324's
PR95 download hold and WLK302 unrecovered IMAP hold remain separate.

---

# WLK384 — connected Mail source Tasks; WLK318 real read passed

20October: this local chat is sole implementation owner. Supported Edge control
now works. Timothy profile0003 completed signed account verification, explicitly
authorized unverified-app continuation and one real read. UI: Read complete ·7
messages. Sanitized server health: mailReads1/ready/realSendingfalse. Then local
Mail disconnect cleared the view and showed access off. No live content/screenshots,
secrets or tokens copied into artifacts; no sends, changes, Calendar, operator/
1Password or persistent credentials. Google may retain consent. Existing launcher
had exited while approval waited; port5202 was unused before restarting the same
reviewed key-free snapshot. Six launcher/auth/reader/UI files hash-match merged
PR116/main7452af06828383e8412f3de8013282add5083a88. This supersedes zero-read,
control-unavailable, awaiting-merge and owner-click requests in older entries.

WLK384/R33 source milestone: configured Google Mail -> reviewed title -> create/
find private Task in fixed home -> existing planning/completion -> freshly fetched
source. Private refs save atomically beside authoritative Personal/Owned work;
ordinary Tasks, offline projections, Home, exports and agent replies omit them.
Default creation deduplicates; explicit additional Tasks freeze a stable request
and title across uncertain responses. Task deletion/offline reconciliation prunes
sources. Exact current home/account/connection and Task checks fence source reads.
Standalone temporary Mail route and real provider-write limits stay unchanged.

Verification: isolated exact changed source reused existing locked dependency tree;
compile, affected lint, OpenAPI/generated types, brand32 and root secret scan pass.
Focused API/CLI tests cover both home types, restart, duplicate/CAS, foreign access,
revoked reads, scoped-agent redaction/revoke, sync pruning and real-send denial.
Root dependency/duplicate-output compile attempt failed as previously documented;
initial isolated compile needed generated Cloudflare types, then exposed/fixed an
unknown JSON typing error. Initial lint exposed/fixed effect state reset. Secret
scan of a nongit proof copy failed; root scan passes. None counted as passes.

Actual supported-browser fixture: read invented Mail, edit title, create Task,
repeat opens same ID, open exact Task, save planning block, complete, return to
fresh source. Disconnect then source-read denial preserves Task/block. Inspected
1280/768/390 layouts; phone/tablet no horizontal overflow. UI date automation
showed21October in inputs but saved the prior20October14:00–14:30UTC; evidence
claims only that actual saved block. API planning independently passed21October.
Synthetic screenshots: output/wlk-384/source-{desktop,tablet,phone,disconnected}.png.
Review found uncertain additional-task retry title drift; fixed immutable pending
intent. No remaining material source-review blocker.

Delivered source3610b862498d666402efd40009991b2e51d852af in PR117, merged
20October21:21:42UTC at8b3ce2e9bb0315f3040eb8917f306a35738ffa03. Remote main
tree exactly matches checked source; local main fast-forwarded. Validation groups
30 and29 passed (overlapping, not59 distinct checks). WLK384 is Done for the
bounded source milestone.26 original untracked files remain byte-identical. Live session read does not prove the integrated saved-work
journey, durable reply, provider Calendar/send, native/device or release support.
Next R33 step is correctly addressed authored reply preparation under the same
source authority, then authorized integrated live proof. Persistent Google/runtime
activation, PR95/WLK324 download hold and WLK302 unrecovered IMAP stay separate.

---

# WLK318 — real alternate identity verified; Mail read still pending

Owner19:51 reports Mail connected. Independently read only sanitized existing pilot
health: lastAccountCheck ready, accountShape primaryEmailfalse/googleProvidertrue/
providerEmailtrue, mailReads0, nonprod/sendingfalse. This confirms the real account
contract: Google provider email is present while Firebase top-level email is absent.
Signed Google/Firebase binding and current self-account checks have now passed live.
Connection itself is user-reported; health does not expose a connection receipt.
No completed bounded-read receipt exists. Did not reload, disconnect, repeat sign-in,
extract session credentials or read Mail via another path. CUA remains unavailable
from the established -10005 initialization failure; no repeat attempt without change.
Smallest owner action: click Read Mail once in the already connected Edge0003 page.

Source delivery: [PR116](https://github.com/scwlkr/openjob/pull/116) contains
reviewed68d8645 plus sanitized documentation on the sole WLK318 branch. Cumulative
read-only review found no material blockers; GitHub reports clean/mergeable with
no configured checks. Ready for the authorized nondeploying source merge.
19 API/auth tests,7 rendered UI tests, type/lint/brand/secret checks previously pass;
no implementation changes since. Remote main remains9d575280 (PR115); no rulesets,
required protections or repository hooks; sole workflow is manual artifact-only,
no publishing. Ordinary source PR/merge is authorized and cannot auto-deploy under
this verified repository configuration.26 unrelated untracked files preserved.
No production/Google configuration, credentials, grant scope or stored data changed.

---

# WLK318 — Firebase email contract corrected; signed Google identity repair served locally

Supersedes the prior email-scope diagnosis below. Live sanitized health after the
owner's failed retry reported google_email_missing, mailReads0. This proves the
normal end-user accounts:lookup response lacked a top-level email. SDK source
maps that optional field directly to User.email; providerData email is separate.
Official Firebase documentation explicitly permits missing top-level email for
federated users in multiple-accounts-per-email mode:
https://firebase.google.com/docs/auth/admin/manage-users
Actual project account mode and live provider-email presence remain unverified;
no admin configuration/lookup, account mutation or guessed-email fallback used.

Both self-session backend and secondary Mail popup incorrectly required Firebase
primary email/emailVerified. Replacement verifies the already-returned primary
Google ID JWT with official google-auth-library signature/issuer/audience checks,
plus azp, current expiry, email_verified, exact selected address and Google subject
bound to the signed Firebase UID/provider subject and current self-account lookup.
Firebase validSince/revocation/disabled checks remain. Google proof stays in page
memory, never storage/logs. The separate Mail access token still requires verified
email, exact audience/subject and only read-only Gmail plus identity scopes.
All asynchronous read fences also check Google identity expiry; no relaxed grant.
UI displays the server-verified address and no longer claims Google omitted email.

A realistic provider-only Firebase REST/SDK fixture (no primary email or verification
flag, Google provider email present) reproduces the exact401 google_email_missing
on prior966308d, then passes with this fix.19 API/auth tests,7 rendered interaction
checks, type/affected lint, brand32 and secret1033 pass using locked isolated deps.
Read-only critic found and we fixed expiry-during-read; final review found no other
material issue. Synthetic desktop/phone screenshots inspected. Initial browser run
could not locate its expected1228 binary; rerun uses existing1248 Chromium, no install.
Optional npm-exec-node regression invocation stalled and was stopped; direct local
Node reproduced the expected pre-fix failure. Shared dependency install untouched.

After notice, restarted only owned Node68773. Current owned Node9855, exec58769,
http://127.0.0.1:5202/mail-session. Reviewed backend/frontend files match owned pilot
copy hashes; actual /main.tsx imports and /@fs public modules contain this repair.
Health200 nonprod/sendingfalse, lastAccountCheck not_checked, mailReads0 at startup.
No new live acceptance, Gmail consent or read is claimed. Browser control remains
unavailable (-10005 initialization timeout), with no repeat attempt or workaround.
Next normal owner action: Complete Google sign-in on the existing Edge0003 page,
then Connect Gmail for this session and Read Mail once if account verification
succeeds. No Google settings change, operator key or1Password access required.
The former memory proof was disposed, so a normal popup completion supplies it.
All unrelated26 pre-existing untracked files remain preserved. Activation/server,
PR95 no-retry and WLK302 recovery gates remain unchanged.

---

# WLK318 — temporary sign-in email repair installed; awaiting normal user check

Owner19:20 screenshot shows intended alternate display name, Google sign-in badge,
no SDK email, failed account check, no Gmail receipt. Source inspection confirms
Firebase Google provider default adds profile only. Temporary login and Mail popup
now explicitly request standard email identity scope. Default saved-work login
unchanged. Temporary observer uses onIdTokenChanged so same-UID completion updates
identity/session metadata. No server email/UID/subject/scope/revocation check relaxed.

Regression reproduces profile-only response without email: POST
/api/v1/connections/session/status returns401 email_permission_required with
sanitized google_email_missing, and zero Gmail/provider-token calls. UI asks
Complete Google sign-in; only actual email mismatch prompts account selection.
16 API/self/revocation/auth checks,7 UI interaction/layout checks, type/lint and
rootsecret1033 pass using locked isolated dependencies; shared install unchanged.
Root attempts still fail on known missinggoogle-auth-library, not claimed passing.

After disclosed temporary-login warning and authorized repair scope, stopped only
verified owned Node14826, synced reviewed source, restarted own key-free pilot.
New Node68773, execsession92273; health200 nonprod/sendingfalse, lastAccountCheck
not_checked, mailReads0. Backend diagnostics now active; no post-restart user
request yet observed. Underlying original real401/provider reason remains
UNVERIFIED (missing SDK email is observed, failure mechanism reproduced, not a
new live acceptance claim). No live Gmail consent/read. CUA initialization remains
unavailable; no further failed-control retries. Normal owner sign-in/check on
existing Edge0003 page supplies next exact sanitized receipt; no account switch
suggestion without real mismatch. Operator/1Password permission remains withdrawn.

---

# WLK318 — Mail screen state and styling fixed; live auth remains unverified

Current branch codex/wlk-318-alt-self-session contains committedd4e1868 key-free
alt route plus this UI follow-on. Parent supplied current screenshot: signed-in
checking state, no Gmail controls/receipts. Verified source causes: standalone page
omitted required workspace root styling; session account status swallowed failure
and had no deadline. No eligible-account failure receipt existed to prove its
underlying provider cause. No account/binding/protection weakened to accept it.

New compact branded card explicitly shows Google name/email from normal SDK
metadata, signed-out/checking/signed-in/wrong-account/error states, separate Gmail
access-off/connected/read-complete states, primary next action, secondary account
switch/signout. Account check has8s deadline (including getIdToken), clear Retry,
and friendly typed provider failures. Temporary identity metadata never authorizes
API access. Exact server self/Gmail checks unchanged. No false read receipt.
15 API/self/revocation/auth checks and6 browser state/interaction/layout checks
pass; TypeScript/affected lint/brand32/rootsecret1033 pass. Initial fixture globals,
Node strip-only syntax and lint failures fixed honestly before final checks.
Rendered synthetic desktop+390px phone screenshots inspected:
/tmp/openjob-mail-session-desktop.png and /tmp/openjob-mail-session-phone.png.

Frontend sources copied to the existing proof server for normal hot update after
warning that a reload clears temporary login. No browser reload/signout or server
restart issued. Current backend remains prior running module until a later safe
restart; new sanitized account failure reason/receipt counters are prepared in
source. Existing service health/anonymous denial verified earlier. Supported CUA
failed initialization; no further retries until something changes. Actual current
Edge rendered result, Google eligibility, consent or Mail read remain UNVERIFIED.
Never duplicate owner actions. No operator/1Password use, Google settings repeat,
main-account credentials, deployment or publication. Original26 files preserved.

---

# WLK318 — alternate-only local service ready; browser control timed out

Owner withdrew operator document access. No further 1Password/credential reads.
Branch codex/wlk-318-alt-self-session from merged9d57528 supplies scoped source:
new standalone self-authenticated Gmail composition + npm run dev:google-session.
Only public nonprod Firebase config/selected alternate address. No Firestore,
operator loader, saved OpenJob User or Task/Workspace routes. Existing backend
users.resolve/deletionPending checks unchanged. Standalone route cannot observe
OpenJob Firestore deletionPending and grants no saved-work capability.

Normal Google sign-in uses separate memory-only Firebase app. Signed Firebase
identity plus end-user accounts:lookup{idToken} checks exact selected verified
mailbox, UID, Google provider subject, disabled/unlinked/revoked state. First UID
learned only from authenticated self; core lease pins UID/subject/auth_time with
strict Google client/audience/scopes and10min token-memory bound. No admin lookup,
other-user enumeration, database permission changes, refresh/send/Calendar route.

15 focused signed synthetic/self/revocation/auth-regression checks pass;
TypeScript/affected lint/brand32 pass, rootsecret1030 pass. Reviewer found
shared basic-auth persistence; corrected to separate memory-only app and repeated
changed compile/lint gates passed. Added regression covers temporary-auth persistence
and saved primary-session isolation. Root check attempt failed on known stale dependencies;
all passing checks use prior locked isolated proof copy, shared install unchanged.

Live service started from $TMPDIR/openjob-local-proof-5m1q071h with selected alt,
loopback127.0.0.1:5202/mail-session; exec session3598, process14826. Actual health200
local_mail_session/nonprod/sendingfalse and unauthenticated API denial verified.
ALTS_SESSION=openjob-318-alt-self selected existing0003; alts open confirmed Edge
profile0003 and requested local URL. No operator credential involved.

BLOCK: cua.getApp(Microsoft Edge) timed out after33s and reset kernel; subsequent
cua.getState timed out after31s/reset. No browser UI/sign-in/consent was observed
or controlled. A fresh permitted getApp(Edge) retry also failed: Computer Use
server error-10005, timed out waiting for initialize from codex app-server (32s),
before any current-page observation/action. No further retry until something changes.
No Gmail consent/read or Google settings changes. Stop repeating
stalled control; restore supported Edge computer control (or owner handoff on
already-open local page) to perform approved selected-alt sign-in, connect Gmail,
one bounded read, disconnect. Stop at unexpected warnings/verification/allowlist.
Previous denials remain unexecuted and withdrawn credential request stays closed.
PR95/WLK302/WStack-installer holds unchanged. Original26 unrelated files preserved.

---

# WLK318 — merged local session source; operator account resolved by metadata

PR115 merged20Oct18:52UTC at9d5752809f77b58f052da531ea78f27e504b3d8c;
merged tree matches reviewed/tested8babdd7. Local main fast-forwarded, original26
untracked files unchanged. No required remote checks/rules, repository hooks empty,
only workflow manual artifact-only; no deploy/publication triggered.

Parent explicitly permitted metadata-only credential-account diagnosis. Configured
Shane account resolves by exact UUID, and the known operator vault resolves as
My Passwords under that account. Email selector had returned no accounts. No
operator document retrieval was retried; no key loaded, no pilot listener started.
Private exact references remain in /tmp/openjob-318-session-launcher.mjs; retry
must replace its email selector with verified account UUID only after approval.
The needed existing document is OpenJob Preview QA Fixture Operator (dedicated
openjob-nonprod Firestore service account, documented roles/datastore.user). It
lets the existing API resolve the active saved OpenJob user. Gmail online popup
needs no Google client secret. No new account/credential or additional IAM needed.

Next: approve one document read bound to that verified owning account and known
vault, RAM-only local launcher; then recover selected alternate binding from its
own authenticated session. Saved Gmail API/read-only scope verified, Google marks
scope unverified. No actual Gmail consent/read, verification submission, allowlist
or warning bypass. Broader identity enumeration and account-unbound credential
retry remain denied/not executed, with no bypass. PR95/WLK302 holds unchanged.

---

# WLK318 — local session Gmail source ready, 20 October 2026

Branch `codex/wlk-318-local-gmail-session` from c03dd075. Default-off nonprod
loopback mode adds separate in-memory Firebase Google popup, exact human/UID/
subject/mailbox/client/scope checks, bounded explicit Mail read and disconnect/
expiry/in-flight fences. No Google refresh credential, token persistence, send,
Mail modification, provider Calendar or persistent connector change.

Synthetic signed-API/Google/config/existing-connection checks20 pass, browser3
pass, TypeScript/affected ESLint/brand32/secret scan pass. Independent source
review found no consequential issues; added expiry-during-read case passes.
Use locked isolated dependencies as noted below; shared install untouched.

Shane explicitly approved the scoped local alternate test at18:11UTC via parent.
Gmail API enabled and confirmed in openjob-nonprod. Only gmail.readonly was saved;
Google confirmed Data access changes saved, marks scope unverified and requests
verification. No verification submission/warning bypass/allowlist. Real popup/
consent/read remain UNVERIFIED. Browser timeout reconciled before Save/readback.
Existing operator document loader failed (no key loaded). Metadata-only CLI account
access works outside sandbox, but exact email account selector returned no account. Private runner /tmp/openjob-318-session-launcher.mjs
uses existing approved document reference, never logs/stores keys or tokens; its
selected self-session observer has not run because startup failed. Exact selected
UID/User binding remains unresolved; no new account or relaxed binding.

Automatic approval review denied admin batch enumeration of up to100 identities
as broader than the selected alternate lookup. It did not run and was not retried
or bypassed. A later credential read without explicit account was also denied
before execution because it could select the wrong account; no retry/bypass.
Smallest next step: confirm the exact existing 1Password account owning the operator
document reference, restore that scoped access, then use the alternate's own
authenticated session to recover its exact binding. Google provider verification
is an additional possible gate; stop at warnings or unexpected requirements.
Only one bounded read is approved. No production/main Mail, server/DNS/deploy,
PR95 retry, WLK302 overlap or WStack installer activity. Original26 files preserved.

---

# Local MacBook takeover — WLK318, 20 October 2026

Active checkout: `scwlkrmac.local`, `/Users/shanewalker/Desktop/dev/openjob`.
Local `main` fast-forwarded from `3ed6a69` to verified remote
`c03dd075df9ef4682e1d84539ca5a499a530fcbb` (PR114); no product source edits.
All 26 pre-existing untracked ` 2` files remain byte-identical. Their path/size/hash
audit is in `$TMPDIR/openjob-local-takeover-ly7tnlqp/untracked-before.json`.
Fetch initially failed on invalid `.git/refs/remotes/origin/main 2`; its unchanged
contents are preserved at `.git/openjob-local-takeover-backup/refs-remotes-origin-main-2`.
No other refs or unrelated files were removed. WStack local/remote both `c3e3ac6`.

Verified this exact source on local Node26.5.0/npm11.11.0: 58 focused synthetic
Google/store/config/deletion tests, actual ephemeral loopback HTTP/existing CLI,
root TypeScript, brand32 and secret scan1015 pass. Shared dependencies are stale
(missing google-auth-library); left untouched. Tests/types used a git-archive copy
at `$TMPDIR/openjob-local-proof-5m1q071h` with locked root dependencies installed
using scripts-disabled npm ci. No native install/build, full npm test, browser
consent, live Google/Firestore, deployed service or device acceptance is claimed.

Linear and remote PR state re-read: only PR95 is open. Next queue action remains
the pending pilot.openjob.dev activation decision; do not configure secrets, grant
access, change DNS/network or deploy. Pilot is alternate0003 Timothy,
scw.builds@gmail.com; no main-account use. PR95 browser delivery remains uncertain,
no retry before reconciliation. WLK302 source remains in the stopped cloud owner;
no overlapping implementation or owner restart. WLK327 needs its policy decision.
No independent accepted unblocked source task found. Continue in this local chat;
prior owners remain idle. This continuity note is the only new tracked edit.

---

# WLK318 — necessary home/deletion-worker prep complete, 20 October 2026

From3e20299. Explicit Googlepilot admits same selected User/GoogleUID to existing
Workspace setup; startup/catalog do not map. Person clicks Open existing Personal
context, keeps byte-identical saved Task/Calendar data, then selects retainedhome.
No general onboarding/employer-independence inference. Key-free cleanup factory
is attached to existing deletion runtime ONLY via separate default-off
GOOGLE_CONNECTIONS_CLEANUP_MODE. Exactpendingowner/requestCAS removes cipher+home
reference before identityfinalization; failurepending. No workerlaunch/binding,
actualdeletion, key/secret/grant/deploychange. 46focused checks and actual2s synthetic
loopback Personalmapping→Google/CLI lifecycle pass; final review/checks inPR/Linear.

Stop at concrete activationready handoff docs/PORTABLE_SERVICE.md#activation-ready-checkpoint.
No more theoretical infrastructure. Knownlimits: no newhome interactiveUI/liveWorker/
Googleprovider/deployedTLS/liveDB acceptance. PR95 remains separateheld/unverified;
WLK302 originalsource unrecovered/noformerownerrestart; WLK327 generalidentitypolicy
not prerequisite for this boundedpilot. No independent accepted codequeue item is
newly unblocked by these sourcechanges.

---

# WLK318 — explicit portable Google wiring/config preparation, 20 October 2026

From021d10a, optional portable runtime composition injects existing encrypted store,
Google/Mail transports and exact User/Google UID/mailbox admission. Default mode
remains503/noGooglesecretreads. Separate bounded explicit-file config loader imports
nonextractable existing key only on later configured startup; tests use invented
bytes/files. Optional Compose secret overlay remains disabled/hostloopback; config
--quiet validated with synthetic files, no daemon/container/service start. Portable
SSR bundle compiled without execution. Cheap actual loopback Google/CLI proof now
runs through createPortableRuntime itself. Existing pilot/sessions unaffected.

No real credential delivery, key generation, grants, Workspace mapping/admission,
provider calls, deployment/network/security changes. Exact operational setup inputs
in docs/PORTABLE_SERVICE.md; chosen owned Mail home and deletion-worker hookup are
not silently created by the flag. Final checks/review/landing in PR/Linear.
PR95 unverified and unrelated; WLK302 recovery untouched.

---

# WLK318 — actual loopback Google/CLI integration proof, 20 October 2026

From mergedPR111/dfc39f0, npm run test:google-local composes actual shared Personal
application + Google flow + encrypted Firestore backend on an ephemeral loopback
HTTP socket, driven by existing CLI. Synthetic callback→snapshot restore/new store→
refresh→fake Mail→disconnect→same-ID/home reconnect passes; foreign/agent/senddenial
and output redaction pass. All provider/database/identities synthetic. No browser
consent/live durability/Google acceptance claimed. Existing pilot/sessions unchanged.
Initial restricted-sandbox bind failed EPERM; authorized loopback execution passed.
No product/runtime wiring or dependency change. Final exact proof/review/landing
in PR/Linear. Runtime/store/secret/deployment/Google activation inputs are concrete
in docs/providers/PRIVATE_GOOGLE_STORE.md; composition injection is engineering,
not a new owner architecture choice. PR95 unrelated and remains unverified.

---

# WLK318 — disabled token cleanup and injected key lifecycle, 20 October 2026

Follow-on from mergedPR110/c96611a. Branch codex/wlk-318-token-lifecycle adds bounded
previous-key decryption, explicit current-key CAS re-encryption, local disconnect-all
and exact pending-User/request-fenced ciphertext deletion without requiring a key.
Optional deletion-worker dependency runs before identity finalization; normal
runtimes remain uninjected. No real keys, grants, deletion, migration or provider
revocation. Fifty-one focused synthetic Google/store/deletion tests pass; final
checks/review/landing are recorded in PR/Linear. Physical record deletion is not
backup erasure or Google project-wide revocation. Operator key retirement still
requires accounting for all owners/backups/processes, not just one successful rewrite.

PR95 existing evidence reconciliation found no returned path, suggested filename,
download artifact ID or URL. Original browser tab6 call awaited download then
requested path(), without saveAs; metadata failed and raw output is unavailable.
Narrow local task/tmp/Downloads name checks found no matching OpenJob export, which
cannot exclude browser/cloud storage. Prior outcome remains uncertain/unverified;
no retry, permission change or endpoint action performed. WLK302 untouched.

---

# WLK318 — disabled encrypted private Google backend, 20 October 2026

Source preparation on codex/wlk-318-private-google-store from8980a21. Existing
sign-in and Timothy Task/Calendar persistence are complete. Concrete Firestore CAS
backend encrypts complete private connection envelopes with injected AES256-GCM
key, owner/document/version-bound authentication and active-user commit fences.
No runtime binding, key loader, secret access, deployment or provider activation.
Eleven focused synthetic flow/store tests pass: first-consent→refresh→fake-Mail→
disconnect/reconstruction, corruption/isolation/CAS/ambiguous-write/deletion/expiry/
capacity. TypeScript, affected lint, brand32, secrets672 and diff checks pass.
Independent source review found no consequential findings; exact integration
identity is recorded in PR/Linear. See docs/providers/PRIVATE_GOOGLE_STORE.md.

Remaining live gates: approved HTTPS origin/deployment, actual secret/key delivery,
server-only collection access, operational key/retention/deletion cleanup, Google
configuration/verification and explicit selected-mailbox consent. Backend selection
is engineering work, not a mandatory owner decision. PR95 held while original
instruction/tool outcomes are traced; no download retry. WLK302 source unrecovered,
no former-owner restart or overlapping TLS work. Existing pilot/sessions preserved.

---

# WLK307 COMPLETE — exact registry artifact verified, 19 October 2026

Owner completed manual npm web authentication/publication. npm accepted the upload
but immediate readback failed while processing; NO root publication retry occurred.
At12:47:57UTC registry confirmed exactversion0.3.8-dev.1792161876.9ba3929fbf0c,
approved SHA512, dev pointing to that version and latest unchanged0.3.7. At12:49UTC
independent public tarball download was680634bytes and matched the original approval
byte-for-byte. Original source9ba3929fbf0ccc3e24e2577410a355fa3798736e unchanged.

Fresh empty prefix/cache registry install with scripts disabled PASS; installed
version/source matched. Actual packaged app ran outside source checkout on a separate
ephemeral loopback port: JS/CSS/brand assets, create→schedule→complete Task, owner
isolation, Host/Origin denial, source-file denial and shutdown PASS. Synthetic
fixture proof only: no later-main Google/real-pilot features, live provider, native
device, deployment or stable release claimed. Existing real pilot/session untouched.

Durable handoff directory openjob-publication-handoff contains registry-processing.json,
registry-install-receipt.json, original approval/bytes and no-republish notice.
DO NOT rerun publication. Owner checkout remains18da3ff unchanged after its command;
source auth-error repair PR108 merged5cf825d with23 focused checks/review. WLK307
can close; original approval is fulfilled, not authorization for future artifacts.

Use npm install -g @scwlkr/openjob@dev for this published prototype; latest remains
0.3.7. Requires Node>=22.13.0. App is explicitly simulated; real sending disabled.
Gmail alternative test account/HTTPS/backend activation, parkedPR95, WLK302 and
WLK327 retain their own gates. Docker installed does not imply app deployment.

---

# WLK307 — owner E401 authentication handoff, 19 October 2026

Subsequent owner report: web login completed as scwlkr; owner reran the existing
handoff and npm printed acceptance of the exact approved dev version with registry
processing pending. Immediate readback was unconfirmed. DO NOT PUBLISH AGAIN.
Root public registry read12:43:56UTC stillversion404/devold/latest0.3.7. This is
pending processing, not proof of a rejected upload. Only read-only reconciliation
and, after exact integrity/tag confirmation, isolated registry install/run follow.
No authentication/security URL from the owner's output is copied here.

Shane ran the repaired command and parent reports npm whoami E401 at12:39UTC,
before publication. No root publish retry/login/credential/security change.
Installed npm11.11.0 docs and login implementation confirm manual owner command:
`npm login --auth-type=web --registry=https://registry.npmjs.org`, then
`npm whoami --registry=https://registry.npmjs.org` must report scwlkr. Login saves
a local user npmrc credential; owner completes browser authentication privately.

Names/presence-only readback in root process: no NPM_CONFIG_*/npm_config_*,
NPM_TOKEN or NODE_AUTH_TOKEN environment names; prepared project npmrc absent;
user npmrc has registry.npmjs.org authToken key with no environment substitutions;
global npmrc absent. No credential values output. Shane's Terminal environment
may differ; do not claim its overrides ruled out. No automatic config removal.

checkApprovedNpmLogin now redacts child errors/security links and reports the exact
manual action/local credential effect. Wrong account also stays redacted.23 focused
checks cover redaction and stopping before registry/publish; lint/brand32/secrets669/
diff pass. Review/PR/landing in Linear307. No auth or publication attempted here.

---

# WLK307 — immutable approved npm handoff recovered, 19 October 2026

Parent authorizes repairing the original exact publication handoff. Approved
version0.3.8-dev.1792161876.9ba3929fbf0c, source9ba3929fbf0ccc3e24e2577410a355fa3798736e,
and SHA512 are bound in distribution/approved-publication.mjs to original owner
approval Linear307/comment457f8b14. Registry read19Oct12:27UTC: exactversion404,
devstill37c322b/latest0.3.7. No renewed artifact approval or different package.

Original /tmp archive disappeared. Recovered exact plan and680634-byte tarball
from original openjob-wlk-303/dist; SHA512 matches the approval byte-for-byte.
Durable read-only copies now at
/Users/shanewalker/Documents/Codex/2026-10-16/task/openjob-publication-handoff/approved-dev-9ba3929/.
Recovery receipt records17 unrelated untracked duplicate-file hashes; all unchanged.
Original checkout/source, duplicate files, tarballs, pilot/session/data preserved.

Separate npm:resume:check / npm:resume use a clean current-main publisher, original
source identity+main ancestry, fixed reviewed approval receipt, exact bytes/manifest,
current registry owner/channel/monotonicity/existing-version integrity and private
staging/no artifact scripts. Normal prepare/publish freshness remains unchanged.
Check makes no npm/auth calls; publish makes at most one attempt with existing login,
stops on EOTP/ambiguity, then requires registry reconciliation before another run.
No build/repack, login/token/2FA/config change, stable release or new approval.

Focused publisher/distribution21 tests, compile, affected lint, brand32, secrets669
and diff checks pass. Independent exact-head review4452db8 confirmed no remaining
consequential findings after disabling npm's internal network retries. PR107,
landing and actual durable check-only result recorded in Linear307/PR. Publication and fresh registry install
remain UNVERIFIED until the original approved bytes actually reach npm. Owner handoff
will use a separate durable clean checkout and direct command outside /tmp.

Latest parent infrastructure readback: Docker/Compose installed, active, zero app
containers; exact public HTTPS/deployment handoff still pending. No infra actions
here. app.openjob.dev remains only a recommendation. Personal Gmail activation is
not requested now: alternative Timothy Friedman test account awaits exact address
and ownership/authorization with parent. No Google/credential/browser/Terminal action.

---

# Hosting dependency reconciled — 18 October 2026, 21:02 UTC

Parent relayed the sole infrastructure owner's completed inventory of the purchased
Linux target and staging of private bootstrap templates. First inventory is no
longer pending. Container runtime installation awaits specific daemon/network
approval; no app containers or deployment are active. Infrastructure remains with
owner01a14a00 in the private infrastructure repository. No VPS action by this task;
host, access and configuration details stay private.

Next cross-repository dependency: infrastructure owner completes approved runtime
setup and supplies the exact approved HTTPS origin/deployment handoff. OpenJob
still needs its reviewed private-store/key/retention and secret-delivery policy,
concrete backend, and specific Google setup/consent before activation. Inventory
does not authorize these steps. No repeat approval request made.

Local pilot health200 at21:02UTC, providers unconfigured, realSendingfalse. Current
useful detached process is PID66919, started17Oct17:03:29UTC (see PR105 operational
receipt); older PID/session records below are historical. Session/data untouched.
Live main0b3ff88 and sole draftPR95 unchanged; complete Linear queue still only
WLK302/324/327 unfinished with their recorded gates. No new accepted independent
feature is unblocked. This corrects dependency facts only; no feature/live proof.

---

# Local real pilot recovered — 17 October 2026, 10:04 a.m. Central

At resumed UI qualification, both browser and curl received connection refused on
127.0.0.1:5202; lsof showed no listener and old execution session50291 was absent.
No retained exit record establishes why the process stopped. Previous health/pass
receipts are historical observations, not current uptime proof. Parent explicitly
prioritized restoring the existing approved real configuration before other work.

Unchanged private /tmp/openjob-318-real-launcher.mjs restarted successfully against
unchanged pilot source bf5ae4630ae2370d88cef6e792c63968d3b22ecb. Existing approved
operator Document loaded only into process memory; no new credentials/access,
secret files/logs, configuration changes or fixture replacement. NEW owned PID49520,
execution session17753; birth Sat17Oct2026 10:03:31Central, command node
/tmp/openjob-318-real-launcher.mjs. Bound only127.0.0.1:5202. Health200 at15:04:43UTC:
local_real_pilot/nonprod, providers unconfigured, realSendingfalse,
credentialsVerifiedfalse (presence-only health, not credential audit). Receipt
/tmp/openjob-318-restored-health.json. Keep this short-lived useful process alive;
no launchd/autostart/persistent access was installed. Recheck health after a host/
execution reset rather than assuming an old PID/session remains owned or running.

Browser verifier01a149f4 recovery PASS: own tab939997013 on exact5202/workspace
restored existing signed-in Personal session automatically and loaded exact Task
“Local pilot verification 17 October”, with linked Personal block18Oct2026
15:00–15:30UTC /10:00–10:30Central. Calendar showed same title/time, linked-task
label and open-linked-task control. Read-only; no new writes/sign-in/provider actions.
Closed only own tab. Shane tab939996978 and persisted Task/block preserved.

Merged Google Connections callback UI remains NOT browser-qualified. Supported
browser surface lacks interception/fulfill/setContent. Advertised CDP documentation
was read only on the owned approved-origin tab, with no prompt/denial. It describes
tab-current-origin raw send/readEvents but does not enumerate permitted commands
or establish Fetch interception/fulfillment, fixture serving or isolation guarantees.
No raw command, evaluate, service worker, alternate origin/port, fixture runtime
replacement or approval bypass attempted. Exact next qualification dependency:
a supported documented isolated fixture surface at the approved origin, or explicit
new fixture-origin authority; no new request made here. Existing real app has no
Google flow injected and cannot qualify the merged fake callback flow itself.

Queue rechecked: WLK324/PR95 browser download is explicitly parked/no retry;
WLK327 needs consequential policy; WLK302 remains reserved/unrecovered; WLK318
live Gmail target/token policy/Google setup/consent remain pending. No independent
unblocked accepted queue slice was found; none invented. Source checkpoint remains
2605be860cc1a1f24e762e8d97943174be6b9193 plus this documentation-only recovery
receipt. No feature, deploy, publication, live Gmail or infrastructure changes.

---

# WLK334 landed receipt — 17 October 2026

PR103 https://github.com/scwlkr/openjob/pull/103 merged source-only at
b1130f18e85307371677c39507b8f1d3ef704f26, checked/reviewed source head
9d8a8b68eab9895afdd9b9dcf2df9986b6d16141, branch codex/wlk-334-google-flow,
base b73487c3c49180ce360e66a396cb60c996942648. Landed tree exactly matched candidate.
56 focused checks + signed CLI1 passed; landed6 flow checks and compile passed.
Current main integration is clean; this receipt changes only handoff documentation.
Real roots remain unconfigured; existing signed-in pilot source/process/tab/private
Task+block preserved. Interactive UI/live provider proof remains unverified; no
settings, credentials, private backend, Google consent, deploy or release activated.
Remaining dependency-ordered setup and Proposed token policy are below and in
Linear WLK334/WLK318. Stop here; no next feature or infrastructure writer.

---

# WLK334 — disabled Google callback/state/private persistence orchestration

Branch codex/wlk-334-google-flow, /tmp/openjob-google-flow, base/mainb73487c.
Linear WLK334 (actual allocated issue; no WLK333 work claimed). Parent authorizes
source-only implementation/review/nondeploying integration, no live setup. Current
AGENTS/mission/w.md/WStack0.2/Linear/PR refreshed. Existing onlyopenPR95 preserved.

Chose dedicated Google engine with existing public lifecycle/API/UI over widening
the preselected-subject simulated engine: proposer/critic agreed mock/live mode
confusion was material. No accepted architecture/token-policy decision invented.
First verified subject binds after signed address check; sticky home/subject on
reconnect. Atomic injected private repository holds one-use state + private grant,
without a cross-store promotion gap. No production backend/store/key/secret loader
or activation. Configurable HTTPS origin, source callbackpath
/connections/google/callback -> signed POST/api/v1/connections/google/callback.
Private state/callback, refresh claim/CAS, disconnect/localcleanup, fakeMail read,
public status/consent/reconnect controls; no send/Calendar/provider revocation.
See docs/providers/GOOGLE_CONNECTION_FLOW.md for exact actual vs simulated proof,
Proposed token policy, crashes/uncertain completion and remaining live inputs.

Verification:56/56 focused Googleflow/officialadapter/Connections/OAuth/vault/store
tests PASS; existing signed CLI loopback regression1/1 PASS. TypeScript, affected
ESLint, OpenAPI35paths50operations + generatedtypes, brand32, secret666, diff pass.
Broader combined contractrun17/18 retains known Personal commandoneOf19vs18 baseline;
caused path/count/example expectations updated, unrelatedbaseline not changed.
Static React render confirms fixture labels/consent/refresh/read/disconnect and
project-revocation qualification, with Node-only explicitNext .js resolution;
no browser/layout/interaction proof claimed. Local output/wlk-334 and /tmp logs.

Independent Spec/security review on ef54711 found no consequential issues.
Integration review found stale connected catalog after failed statusrefresh; fixed
by preserving catalog only whilepending and clearing/rethrowing on rejection.
No broad mode/refactor/provider policy changes. Final exact head/review/checks/PR
and landedtree readback are recorded in Linear. New UI remains unverified in a
browser; signedpilot surface was preserved, no alternatebrowser/port workaround.

Actual signed-in pilot unchanged on /tmp/openjob-connections-slice bf5ae46,
PID16066/session50291/tab939996978, private testTask+block retained. No ordinary
Chrome/native/heavy phase or new browser-scope request. New UI interactive proof
not claimed; API/core fixture proof is distinct from real Mail. Existing official
library dependencies reused via isolated332tree; no install or shareddeps changes.
WLK302 source remains unrecovered/stopped; no duplication/restart.

Hosting update: OVH VPS purchased, allserverinfra private scwlkr/0o10, sole owner
01a14a00-ce06-7721-a75a-9939f141802d, PR9 merged. Inventory is complete per18Oct
handoff above; runtime daemon/network approval and exact HTTPS deployment handoff
remain pending. No server/config/deploy/credential changes here.
OpenJob+PatriSearch primarilyVPS; Minecraftprimarilyhome. Pending approvals stay
pending; no repeat notification/checklist. Final exacthead/check/review/landed
results in Linear/PR. No newGoogle calls/grants/API enablement/client/secret/key/
callbackregistration/storageactivation/publication/TestFlight/release.

---

# WLK332 — disabled Google adapter source prerequisite

Branch codex/wlk-332-google-oauth in /tmp/openjob-google-oauth, base/mainbc5d6f3.
Linear WLK332 / PR102; parent now explicitly authorizes source-only integration. Existing
signed-in pilot stays on /tmp/openjob-connections-slice bf5ae46, PID16066/session50291,
tab939996978 and private verification Task/block unchanged. No heavy/native/browser
phase. Existing shared dependencies unchanged; official Google library installed
in isolated /tmp/openjob-332-google-deps, scriptless, root npm lock pinned11.3.1.

Adapter uses official Google OAuth2Client for PKCE, auth URL, code exchange, token
refresh and signature/issuer/audience verification; tokeninfo checks actual granted
scopes/subject/audience/expiry. Snapshot bindings, current authorization fences,
fixed endpoints, timeout/response bounds, no auto token POST retry or raw errors.
Private result's access-token entry fits existing broker, refresh token separate.
No live routes/state orchestration/store or real composition changes; mock lifecycle
stays mock. Provider revocation absent and project-wide consequence explicit.
See docs/providers/GOOGLE_OAUTH_ADAPTER.md for bounded proof and exact remaining
configuration/runtime decisions. Selected future mailbox shane.caleb.walker@gmail.com,
no actual consent/API activation/secret retrieval/client/callback settings or deploy.
No domain invented; all infra solely scwlkr/0o10.

Implementation e2a7fac2acfd40f415f21758fcd048e1355d5d96:50/50 focused tests pass,
including9 new official-library/fake-transport cases, oldOAuth/store/vault/Connections.
TypeScript, affectedESLint, brand32, secret658, diff and lock/pinnedversion checks
pass; exact-clean rerun retained /tmp/openjob-332-exact-e2a7fac.log. Independent
Spec/security and Standards reviews on exacte2a7fac found no consequential issues.
Reviewers explicitly retain missing live routes, one-use state/initial subject
binding, private token persistence/refresh coordination and live composition.
Final docs-only checkpoint/PR and exact rerun are recorded in Linear. No full-suite,
liveGoogle, installedapp/build or native proof claimed; broader baseline failures
from previous integration remain unchanged. PR102 source-only integration candidate
is verified against unchanged mainbc5d6f3; authoritative landed hash/readback is
recorded in Linear WLK332 and PR102. No push-triggered deployment workflow/hooks
or required branch rules/checks found. Stop after integration; no next feature.

Remaining Gmail handoff, in dependency order:
1. Establish current Data Access/Verification facts; External/In production is not
   Gmail verification. scwlkr/0o10 owner supplies exact approved HTTPS target;
   owner reviews concrete private token mechanism and shared-project revoke impact.
2. Separately authorize source orchestration: actual start/callback, durable
   one-use owner/state/home and initial subject binding, private CAS persistence,
   refresh coordination and metadata-first disconnect. Keep real mode disabled
   until those pieces and the concrete activation setup are reviewed.
3. With exact callback/runtime reviewable, obtain specific approval for existing
   client callback registration, Gmail API enablement, existing-secret delivery
   and credential repository activation. No new client/key implicitly required.
4. Only then human read-only consent for shane.caleb.walker@gmail.com, verify actual
   scopes/subject/address and explicit home, then one bounded authorized read.
   No send/modify/provider Calendar or deployment follows from this integration.

---

# Source integration checkpoint — 17 October 2026

Reconciled source2dca2acf13e2ad08f7f035522c840eb6ac68ae9f passed51/51 focused
notes/Home/isolation/grants and Connections/OAuth/signedCLI tests, TypeScript,
affected ESLint, OpenAPI34paths49operations, generatedtypes, brand32, secret653
and diffcheck. Exact-source read-only reconciliation review found no consequential
issues. This final documentation checkpoint changes no source. PR101 is submitted
for the already-authorized source-only merge; actual landed hash/readback is recorded
in Linear WLK331 and PR101. No full-suite or deployment readiness claim.

PR100 merged at b0fed00cc93de69fd4a92d0b1cc5dc64b9b7f401 after exact-head review,
focused16/16 tests, TypeScript, affected lint, brand32/secret642 and actual notes UI
proof. Initial compile lacked ignored Cloudflare declarations; restored existing
matching declarations then compile passed. PR101 reconciliation retains both source
changes: fixture250KB bound plus Connections dispatch/persist; only w.md conflicted,
both histories preserved below. Historical draft/pending wording below is superseded
by this current checkpoint and actual-service sign-in proof. PR95 remains draft.

Integration is in /tmp/openjob-100-101-integration, separate from running source
/tmp/openjob-connections-slice at bf5ae46. Preserve PID16066/session50291, tab939996978
and the verification Task/block. No simulated onboarding injected in real runtime.
PR101 prior exact-head35/35 lifecycle+Connections+signedCLI checks, TS, affectedlint,
OpenAPI34/49/types, brand32/secret652 passed. First CLI run hit sandbox loopbackEPERM;
approved ephemeral listener rerun passed. Broader historical54/56 baseline failures
(command oneOf18vs19, expired-date provider expectation) remain, not full-suite green.
No required branch rules/checks or hooks; only manual artifact workflow, no push/deploy.
All infra remains scwlkr/0o10. No provider access, storage activation or release.

Remaining Gmail-read gate is in docs/LOCAL_ACCOUNT_ONBOARDING.md: existing public
nonprod Firebase identity client/handler is not a verified Mail OAuth registration
or runnable callback. Real lifecycle is disabled/mock-only with no production vault,
exchange/verifier/read bindings. No actionable consent URL yet; selected mailbox
remains shane.caleb.walker@gmail.com. Do not solve this by enabling fixture mode.

---

# Local setup / existing drafts UI checkpoint — 17 October 2026

PR101 Connections UI PASS at sourceHEAD6eacb66/implementationcf618e2 on exact5202:
create UI331 Work, simulated Gmail/home consent/cancel/reconnect/readMail/disconnect,
correct Calendar home link and explicit OpenJob-block label; 390px nooverflow.
Sam switch hid Alex data but showed sign-in, so signed-in Sam UI isolation remains
unproven; signed API denial tests are separate. PR100 notes UI PASS atHEAD1235ae1/
implementation263321c: two editors, stale-save denial retains B; Refresh shows saved
A + B draft + alert/disabledSave; discard/reopen adopts A; saveB-new and clear pass.
Ownersupplied Git heads independently checked by root, source clean during eachrun.

Screenshots inline only in verifier01a149f4-5c50-7146-aa7b-a7dbfd2d1010 tool transcript:
PR101 'Capture desktop evidence and inspect responsive viewport API' and
'Verify narrow Connections layout and capture evidence'; PR100 best screenshot
'Capture visible conflict warning, retained draft, and disabled Save'. No artifact
URL/file/stableimageID exposed; no screenshots claimed exported. All syntheticQA
tabs closed/viewportreset. Preserve fixturestates /tmp/openjob-331-ui.LtpatP/state.json
and /tmp/openjob-330-ui.HvXGiJ/state.json (private files, not encrypted). Owned
fixturePIDs11870/14232 stopped; locks released. No port workaround; exact5202 throughout.

WLK318 approved domainaddition DONE/readback: only127.0.0.1 added to openjob-nonprod,
other domains preserved. Operator reference metadata found; approved Document loaded
only in short-lived real-pilot process, no key values/logs/files/newcredentials.
Whole-item lookup auto-rejected before execution; safer metadata+Document-only
actual-use route succeeded, no retry/bypass of rejected lookup. See current
LOCAL_ACCOUNT_ONBOARDING.md for exact scopes, receipt, history and remainingproof.

Real UI at5202/workspace now renders in helper's owned handofftab939996978 with
ContinueGoogle, no restoredsession. Initiallyblank preview fixed only in private
launcher publicdefines; productsourceunchanged. Process16066/session50291 owns
/tmp/openjob-318-real-launcher.mjs, operator onlyRAM, kept for immediatehumanhandoff.
Shane completed human Google sign-in and returned. Actual-service UI PASS: loaded
Personal workspace signed in, Task created “Local pilot verification 17 October”,
one linked OpenJob block persisted 18Oct2026 15:00–15:30UTC /10:00–10:30Central.
Initial date input did not take; same block corrected, final one-block agenda and
linked Task verified after Refresh. Task/block intact; tab939996978 preserved on
Calendar. No visible identity label/auth inspection; no live mailbox connected.
Screenshot inline in verifier01a149f4 call “Capture persisted actual Calendar block
and preserve Shane handoff”; no exported artifact URL/path. See onboarding doc.
No helpercredentials, provider scopes, real sending, providerCalendarwrite or releases.

Hosting update: OVH VPS purchased per Shane; all infrastructure in scwlkr/0o10,
owner01a14a00-ce06-7721-a75a-9939f141802d. OpenJob+PatriSearch primarilyVPS,
Minecraftlocal/Octal8home+VPS. ActualVPSspecs/IP/OS unverified. Preserve app portable
artifacts here; no competing infra/config/deploy. PR95/100/101 remain separatedrafts;
PR99 historical approvalqualification preserved, not retroactively cleared.

---

# Approved setup resume — capability handoff, no execution claim

Shane17Oct12:57UTC approved pending DevTools127.0.0.1:5202 supported access and
WLK318's exact two actions: only127.0.0.1 Auth-domain addition in existing nonprod
and existing operator-credential reuse. Selected mailbox shane.caleb.walker@gmail.com.
Details/current handoff in docs/LOCAL_ACCOUNT_ONBOARDING.md. Those owner approvals
are no longer pending; actual setup/UI verification remains pending. Historical
PR99 authorization-scope qualification remains, not retroactively cleared.

This resumed session has no callable browser/DevTools approval tool. No alternate
browser/controller/port attempted. Existing op CLI/document-reference path known;
no credential retrieved/entered, no service launcher, domain/settings change or
real sign-in/provider grant performed while UI capability is unavailable. Restore
supported DevTools capability for the approved5202 request, then continue already
authorized setup and UI proof; secure user-entry handoff if needed, no repeat
consent checklist. No new OAuth client/key, send/Calendar-write or release scope.

Resource coordination acknowledged: PatriBible sole owner has bounded read-only
Search SSH work; no heavy/browser conflict, all sessions preserved. PR95/100/101
remain draft; implementation source cf618e2 unchanged, only this approval handoff.

---

# WLK331 — Connections application, isolated draft

Branch codex/wlk-331-connections in /tmp/openjob-connections-slice, main9a5c0c5.
Independent of PR100 notes263321c/docs1235ae1; no cherry-pick/merge dependency.
Linear WLK331: https://linear.app/wlkr-labs/issue/WLK-331.
Parent authorizes bounded R30/R31 implementation after existing review; stop at
source review/draft. Read current AGENTS/mission/WStack0.2 and existing connector
ADRs/specs. One integration writer; existing critic read-only, no browser.

Connections UI/API/CLI now share owner-scoped onboarding: choose invented Gmail
account and explicit owned home, review/simulate read consent, cancel, read actual
mock mapper output, disconnect, retry cleanup and reconnect same subject/home/ID.
Firestore CAS persists bounded application metadata/cleanup intent, no tokens.
Normal hosted/portable roots leave onboarding UNSET503. Simulated factory only in
owned-Workspace fixture. OAuth/broker reused with per-attempt fake metadata/credential
state; fixture credentials are ephemeral, restart read yields reconnect-required.
No real refresh/scheduler/vault/crypto implementation; proposed defaults unaccepted.
Mail remains simulated; Calendar link names OpenJob blocks, not provider Calendar.
Live source-linked Task integration remains next R33 work, not completed here.

Read-only review caught portable /connections route/mode omission, fixed in both
service-server and web entry. Strict API schema caught overbroad home metadata,
now ID/name only. CLI/API signed fixture proof passes, including response schemas.
Affected broad run exposed existing stale Personal command-count18 vs19 and an
expired-date provider fixture expectation; unchanged baseline assertions reproduced
in output/wlk-331. Do not claim whole suite green or expand into notes/provider churn.
Final core37/37 plus signed CLI/schema journey pass; TS/focused lint, OpenAPI
34paths/49operations, generated types, brand32 and secret652 pass. Broader run54/56
with the two reproduced baseline failures above; no full-suite green claim.
Alternative frontend-only chooser rejected: it would not prove policy, persistence
or CLI behavior. Read-only reviewers found no remaining material defects after
portable wiring fix. Exact head/PR recorded in Linear/PR.

WLK302 latest blocked handoff recovered via Linear1bbe36a4/owner final history:
uncommitted codex/wlk-302-imap-tls-runtime from5358f6c, no PR/full gate; historical
focused checks only. Source NOT recovered, cloud NOT restarted, TLS/login untouched.
PR95/PR100 remain draft. PR99 IAB3/tab12/port5203 observations retain unresolved
approval scope; preserve evidence, no clean authorization claim. Pending browser,
WLK318 setup and live-account consent all unchanged. No browser/launcher/heavy phase,
secret retrieval, real account/provider call/grant, configuration, deploy or release.

---

# Connection prerequisite review — documentation only

Existing provider guide now contains a short Proposed first-connection review:
[docs/providers/README.md](docs/providers/README.md#first-connection-review--17-october-2026-proposed).
Reuses R30–R33/EXPERIENCE/ADR0021; records actual composition/mock-mode/source-link
and Workspace resource-home gaps, Node/Compose runtime recommendation, opaque
server credential-reference boundary and exact setup versus independent source work.
Next bounded source slice: Connections/onboarding contract using existing injected
OAuth/broker/repositories, with one read-path durable refresh/cleanup lifecycle.
No implementation in this review; no new Linear execution queue. WLK310 holds design
review, WLK302 blocked code, WLK318 parked sign-in approvals. First real view is Mail
plus OpenJob blocks; provider Calendar is not implemented or consented.

Recovered WLK302 HANDOFF via Linear1bbe36a4/owner final turn: uncommitted cloud branch
based5358f6c, no PR/full gate, historical focused checks only. Source NOT recovered,
cloud NOT restarted, no TLS/login duplication. Former /tmp checkout no longer exists;
read existing PR100 branch into clean /tmp/openjob-connection-review without install.
Original synced checkout/unrelated link preserved. PR95 and PR100 remain draft;
PR99 UI qualification unresolved. No browser, secrets, account access, config or release.

---

# Documentation-only stop checkpoint — PR100 / WLK-330

Parent direction: pause browser execution; no further notes/data-edge-case work.
PR100 https://github.com/scwlkr/openjob/pull/100 stays DRAFT and UNMERGED.
Reviewed implementation/source head263321c93d8213cc3a4eeed0839313f41d30786d:
30 focused tests, TS, focused ESLint, brand32 and secret642 passed; exact-head
read-only review found no actionable findings. This checkpoint changes docs only.
No historical evidence or claims below have been deleted or rewritten.

PR99 browser observations occurred in existing Codex IAB browser3, tab12,
http://127.0.0.1:5203/pilot. Approval scope was NOT verified against the unanswered
localhost5202 DevTools permission. UI qualification therefore remains unresolved,
not cleanly authorized. Preserve exact screenshots/source receipts/state paths and
PR99 comment https://github.com/scwlkr/openjob/pull/99#issuecomment-6233342505.
Source/API results stand independently. No browser retry, alternate route, new
permission request, security/config change, release or further implementation here.

Next substantive accepted-roadmap milestone: R31 -> R32/R33, one Shane-approved
real read-only account through account-level Connections, verified upstream
identity and explicit resource home, then actual Mail -> linked Task -> local
planning -> authored reply draft. Provider choice is not assumed; WLK302 IMAP
checkpoint must be recovered before overlapping TLS/login implementation.
Exact prerequisites: selected runtime/data and credential design reviewed before
real tokens (C11 portable Linux is a direction, not a selected configured target);
Shane authorizes the particular account/mailbox/resource and read scopes. R31's
R30 dependency should be bounded to the selected read/refresh/revoke lifecycle:
durable execution/revision/lease/cleanup with restart and revoke-before-call proof,
not an unrelated universal send/platform buildout. Existing fake provider/vault/
OAuth seams do not establish real credentials or live connection readiness.

Existing local sign-in path WLK318 remains parked: approval to use the existing
OpenJob Preview QA Fixture Operator reference for this pilot process and to add
only127.0.0.1 to openjob-nonprod Auth authorized domains remain pending. Google and
Apple Enabled metadata is already known; no provider-enable change is needed.
Those approvals would permit the documented sign-in scope, NOT mailbox consent,
new credentials, production/runtime configuration or real sends. Do not conflate
the pending DevTools browser permission with either setup approval.

Next owner action is resolve/review this narrowly selected connection prerequisite,
then queue one coherent connection slice in Linear. Nothing implemented or new
permission requested in this checkpoint. Existing state, pending permissions,
original checkout issues and PatriBible sessions preserved. Stop here.

---

# WLK-330 — guarded Workspace Task notes (draft)

Branch `codex/wlk-330-notes-conflict`, clean source checkout
`/tmp/openjob-329-source-check-tqJ2GW`, base/main9a5c0c5f.
Reproduced two empty-base editors both200 with stale overwrite before repair.
Notes-specific exact expectedNotes chosen over whole-Workspace revision to avoid
unrelated-write conflicts. Read-only critic accepted design and implementation.

Normal Workspace notes require original base; exact comparison happens within
every owned/retained Personal authoritative CAS retry. Same-base race one200/one409;
missing/malformed400; unavailable Personal guard503; strict command fields retained.
Refresh keeps original editor text/base; explicit discard/reopen adopts latest.
250KB bounded payload fits two maximum JSON-escaped notes. Legacy Personal/offline/
CLI commands unchanged; value guard permits same-value ABA, not full revision lock.
Actual runtime admission remains UNSET, D06 Proposed; no real provider/config/access.

Verification: TS and focused ESLint pass; 30 affected repository/API/Home/grants
checks pass; brand32 and canonical secret642 pass in clean checkout. UI behavior UNVERIFIED: draft
must remain unmerged pending authorized browser proof. No browser/DevTools/native/
heavy phase or new permission request performed. PatriBible sessions preserved.

Browser qualification for previous WLK329: observations came from existing Codex
IAB ID3/tab12 at127.0.0.1:5203/pilot. They did not complete the unanswered localhost5202
DevTools permission; its exact scope was not established, so observations are NOT
proof of granted authorization. No retry/alternate browser/port workaround now.
PR99 clarification https://github.com/scwlkr/openjob/pull/99#issuecomment-6233342505.

Original synced checkout preserved: malformed origin/main 2 ref and untracked
native/node_modules 2 link untouched; root secret invocation there EISDIR remains.
Clean checkout reuses matching existing Desktop dependencies without installation.
WLK318/PR95 parked; cloud WLK302 unrecovered; no publication/deploy/admission.

---

# WLK-329 — bounded authorized Workspace Home

PR99 https://github.com/scwlkr/openjob/pull/99; reviewed implementation05e9bb3.

Branch codex/wlk-329-workspace-home from PR98/main93711ac. Parent explicitly selected
next coherent accepted-roadmap progress; C08/R20 Home dependencies now ready for
owner-only Tasks/Calendar. Read current AGENTS/mission/WStack0.2/Linear/livePR state.
Two bounded alternatives reviewed: selected server minimal projection over client
snapshot fan-out (unnecessary notes transfer/partial/stale handling). No new grants,
identity classification or real admission. D06 remains Proposed/future policy.

Normal `/home` + Workspace Home, GET `/api/v1/workspaces/home`, same gated server
and existing repositories. Current owner-qualified Work/Family/mappedPersonal only;
no auto mapping/copy/cache authority. IDs/titles/times/counts/asOf only, no notes,
Mail/unread/drafts/grants. Bounds51contexts/4concurrentreads/5Task+5blockrows each,
next7days including ongoing; actual totals/truncation visible. Failed context read
fails whole response, final binding/User rechecked, read-only Home cannot mutate.
Actual runtime admission remains UNSET. Later setup/admission permissions separate.

Navigation qualifies Workspace/item in fragment, Back/Forward/reload supported,
exact existing Task/Calendar handles focus item; re-entry awaits scoped read while
keeping editors mounted. Home entry/refresh/foreground re-read; failed/offline
refresh clears previous summaries. Explicit catalog retry recovers initial loading.
Synthetic browser observed 3contextlabels, exactWorkTask+Familyblock, unsavedWorknotes
retained throughHome/Family, saved completion updatedHome, BackHome, failedrefresh
clearedallrows,390/640nooverflow. Sourcecopyoutside sync required due stalledVite
reads using synced source/deps; existingDesktopmatchingdependencies reused, noinstall.
Owned preview source root recorded /tmp/openjob-329-preview-root; current savedstate
/tmp/openjob-329-owned-Y0YeSH/state.json private0600/notencrypted. Keep useful state.

Earlier overlapping Home source/tests appeared with older timestamps; preserved
/tmp/openjob-329-overlap-preserved and reconciled. Unknownoldstate/lock
/tmp/openjob-329-home.json and IABtab10 left untouched; unrelated untracked
`native/node_modules 2` symlink preserved. Stalled ownedPIDs50682/51017 force-closed
after graceful timeout; own locks retained .closed-PID. Outsidepreview51282 closed
normally; finalexactcandidatepreview52071 also absent/lockreleased and successful
IABtab12closed. No native/heavy phase. Fifteenfocusedchecks/TS/lint/brand32 pass
on05e9bb3; exactheadreview no remainingfindings aftercatalogRetryfix. Finalbrowser
blockreload/focus, per-contexteditorretention afterfresh-readgate, Samdenial and
failedrefreshclearing passed. Sourcehashreceipt275matchingfiles and savedreadback
output/wlk-329/. RootsecretcheckEISDIR on preserveduntrackeddependencylink; unchanged
canonicalscanner passes641files in clean exactgitarchive export. This is not a pass
of the originalroot invocation. Final integration identity/state in PR99/Linear329.
PR95 downloads, WLK318 approvals, WLK302 and approvednpm/publication untouched.

# WLK-328 — normal Workspace pilot composition, actual admission unset

PR98 https://github.com/scwlkr/openjob/pull/98; implementation b27cccec.
Branch codex/wlk-328-workspace-pilot from main99dd774 (PR97). Parent architecture
review explicitly permits this bounded engineering recommendation under C12/C13;
D06 classifier remains Proposed, not a required limited-pilot prerequisite. WLK327
reconciled in Linear as future employer-isolation/general onboarding policy gate.
Known company-controlled binding/current independent-recovery need still requires
consequential owner choice. This supersedes the prior WLK326 composition blocker.

Normal `/workspaces` reuses existing Firebase auth/session/private cleanup and
stable User resolution. Both Cloudflare and portable Node runtimes compose real
owned Workspace + retained Personal mapping stores; portable service page included.
Trusted server admission is exactly one existing User/provider/FirebaseUID binding;
all actual callers leave it UNSET. No real selection, new env/config, identity
creation/link/grant/control classifier, provider setup or credential changes.
Unconfigured verified session503 before Workspace storage; other User/linked other
binding403, agents401, changed/revoked/inactive User denied. Recheck after body read
before write and before disclosure. Current Task/Calendar resource checks retained.
Existing Personal/offline/Groups and source data authority remain unchanged.

Only loopback synthetic launcher selects Alex's existing synthetic binding. Run
`npm run dev:owned-workspaces -- --port 5202 --state-file /tmp/openjob-328-normal-pilot.json`
and open `/pilot` for normal app/session/runtime proof. Original root fixture remains.
Owned state328 separate from325/326, private0600 but not encrypted. Browser observed
Personal mapping, independentWork, Task+notes+schedule, Calendar→sameTask completion,
per-Workspace editor retention and Sam denial with previous UI cleared. Screenshot
output/wlk-328/normal-pilot.png and not-admitted.png. Twelve focused admission/Workspace/mapping/availability checks, rootTypeScript,
focused lint, brand32 and secret scan pass on clean b27cccec. Independent
exact-head read-only review found no consequential findings. Actual process restart
readback retained identical User/context/Task/event IDs and saved contents; evidence
output/wlk-328/restart-readback.json and normal-pilot-final.png. Owned preview
PIDs33093/33847 exited, own IAB tab closed and state lock released. Final source
integration identity/state is recorded in PR98/Linear328. No real admission activated.

PR95 draft829a3cd remains parked/browserdeliveryUNVERIFIED. No downloads or retries.
WLK318 TWO unanswered approvals stay pending. WLK302 cloud scope/source unrecovered;
approved npm artifact/publication untouched. No native build/heavy phase; PR94
native evidence reused. PatriBible sessions preserved; its webCI lane released.

# WLK-326 — retained Personal context mapping; eligibility policy unresolved

PR97 https://github.com/scwlkr/openjob/pull/97; reviewed source96b05d4.
Branch codex/wlk-326-personal-context from PR96/main02cd0f6. Current mission,
AGENTS/WStackc3e3ac6, D04/D06/DOMAIN/ADR0007, Linear/livePR state reread. PR95
remains parked draft829a3cd, browser delivery unverified; no download actions.

Consequential unresolved choice: D06 explicitly leaves the independent-anchor
protocol Proposed. Owner must settle which trusted server-verified provider/account
evidence establishes independent personal control of an existing Google/Apple
binding, including unknown and known company-managed cases. Provider name, email/
domain matching or user/browser attestation does not resolve this. No classifier,
control evidence, second identity system or real access has been invented. The
fixture eligibility endpoint/UI reports policy_pending/realOnboardingEnabledfalse.
Normal real-account Workspace onboarding remains disabled; do not configure or
retry pending WLK318 permissions to resolve this source-policy gate.

Unambiguous portion implemented: explicit idempotent Personal-context reference
with opaque stable Workspace/Task-space/Calendar resource IDs under the SAME
existing User. No data copy/rekey/reset, sign-in relinking, grants or offline-cache
rewrite. A context adapter reads source-free Task/Calendar projections from the
existing Personal authority, translates its Calendar ID only at the boundary and
routes writes through the original commands. Original Task/event IDs, Mail/drafts,
grants and sync receipts remain in the existing store. Single canonical Personal
Calendar supported; unknown retained shape fails without dropping data. Independent
Work/Family store remains separate. UI explicitly opens retained Personal next to
independent Workspaces. Mapping body accepts only{}; owner/context/eligibility
claims and agent access cannot select or expand authority. Production composition
is unchanged; only the labeled loopback fixture wires the new source.

Evidence:4 focused mapping/Workspace checks pass (signed fake identity + real repo/
API), including concurrent/repeated mapping, stableUser/Task/event IDs, unchanged
Personal record/sign-in methods at mapping, two-way existing/mapped API continuity,
wrong-context/resource/owner/agent/no-Mail denial and active-user fences. RootTS,
focused lint, brand32/secrets/diff checks pass. Actual browser reopened preexisting
Personal Task/notes/schedule, completed SAME Task through mapped context, created
empty independent Work and reopened Personal without duplicate mapping. Actual
server restart/readback retained sameUser/mapping/Task/event IDs/completion/original
Calendar ID and saved draft; source refs omitted from mapped projection; eligibility
stillpending. Evidence output/wlk-326/personal-context.png and restart-readback.json.
Fixture state /tmp/openjob-326-personal-context.json retained separately from325.
No real data/access/settings/providers/credentials, native build or heavy phase.
PR94 native proof reused; approved npm artifact/WLK302/publication untouched.

Independent exact-source review96b05d4 found no consequential findings. Owned
fixture server/tab closed; saved state retained and lock released. Final source
merge identity is recorded in PR97/Linear.

Next gate WLK327: decide the D06 trusted-evidence policy before implementing real
identity classification and reviewed normal composition. Real onboarding cannot
be claimed complete while this policy is unresolved. Company remains a Workspace; no new hierarchy,
membership grants, transfer or agent delegation is enabled by this mapping.

# WLK-325 — first independent owner-only Workspace product slice

PR96 https://github.com/scwlkr/openjob/pull/96; reviewed implementation
fc4446d68712e91478b608698213aec8a988e4f1, from verified main3355805.
Branch codex/wlk-325-owned-workspaces. PR95 remains
separate draft829a3cd, browser file delivery unverified, no download attempts.
WLK325 implements a bounded R10/R11/R20 fixture milestone: one signed human owns
Work and Family with opaque Workspace IDs distinct from User IDs, separate Task
space/Calendar resource IDs, and per-Workspace stored Task/Calendar projections.
Existing Personal Mail aggregate/offline/Groups data and approved artifact remain
unchanged. No Mail/invitations/grants/transfer or real-account onboarding enabled.

Real repository/API/UI source is composed only by the loopback fixture launcher:
`npm run dev:owned-workspaces -- --port 5202 --state-file /tmp/openjob-owned-pilot.json`.
Use an explicit fresh owned file; existing fixture325 evidence is retained at
/tmp/openjob-325-owned-state.json. State is private0600 but not encrypted. Fake
signed Alex/Sam + fake Firestore only. No deployed/public API route was enabled;
normal identity eligibility/Personal mapping/access/lifecycle composition remains
next foundation gate before real Workspace onboarding. See
 docs/OWNED_WORKSPACE_PILOT.md. Full R10/R11/R12/R20 remain partial.

Evidence:2 focused broad repository/API checks cover concurrent creation, independent
resources, A/B item/calendar and Alex/Sam isolation, signed-human/agent denial,
no-Mail/source/grant commands, active-owner fences, Task/block consistency and
persisted repository reload. TypeScript and focused lint pass. Brand32/secret/diff
checks pass. Actual browser created Work/Family, created distinct Tasks, retained
unfinished Work notes through switch, saved notes/schedule, opened exact Task from
Calendar and completed it; Sam's catalog stayed empty. Actual server stop/restart
reopened the same file and retained Work completion/notes/block and Family Task.
Readback confirmed separate IDs and contents. Review identified stale work refresh;
fixed with selected-context Refresh work, observed another client's new Family Task
while keeping unfinished New task text. Browser evidence output/wlk-325/*.png.
No browser downloads, credentials, provider actions, native build or heavy phase.

Observed first shutdown left only this launcher's lock because Vite exits directly
on SIGTERM. Preserved owned stale lock as /tmp/openjob-325-closed-27925.lock, fixed
exit cleanup to remove only matching lock inode/dev, reopened unchanged state.
No old/shared files or simulators touched. PR94 simulator proof reused; WLK318
TWO approvals, unrecovered WLK302 and npm publication remain untouched.

Independent exact-source reviewfc4446d found no consequential findings. Six
focused Workspace/availability checks and final typecheck passed. Source merge is
nondeploying (manual-only workflow, no required remote checks/protections/rulesets).
Owned fixture server/tab closed; actual exit cleanup released its lock and preserved
saved state. Final landed identity is recorded in PR96/Linear.

Next foundation: normal independent-identity eligibility and explicit retained
Personal-context mapping/composition before real Workspace onboarding, followed by
explicit invitations/resource grants/transfer as separate slices. No automatic
production activation. Keep useful fixture state and preserve PR95's no-retry
boundary; PR94 remains native proof.

# WLK-323 — recovered compile and actual native fixture flow passed

PR94 builds exact source61e9789852557a9fae72b97a9a50a3f8432e4eea in a fresh
/tmp/openjob-323-buildroot snapshot with locked npm dependencies and unchanged201
Pod versions. Shared duplicate-bearing cache and all previous generated data were
preserved. The first clean Documents build failed from FinderInfo on a generated
framework; moving the entire owned build outside synchronized roots resolved it.
No dependency/stack rewrite or shared metadata repair.

OpenJobDev Release simulator artifact (dev.openjob.app.dev; standalone fixture JS,
signing/upload disabled; two jobs) compiled successfully. XcodeBuildMCP transport
timed out at300s; original xcodebuild PID11098 continued, was not restarted, and
exited with log ending BUILD SUCCEEDED at2026-10-17T01:31:25Z. Readback:
/tmp/openjob-323-outside-build-readback.json. DerivedData:
/tmp/openjob-sim-outside-derived. App installed/launched on owned iPhone18Pro/iOS27
simulator2A74BBE7-2879-4183-BB30-2C1939027BAF.

Actual Device Hub accessibility interaction passed Today → invented Mail → message
→ private Task → entered/saved notes `note` → scheduled14:00–14:30UTC → Calendar
→ exact Task → source Mail → entered/saved reply draft `draft`. Native onscreen
keyboard input worked; normal text automation and mirror HID did not, so those
attempts are not counted as proof. App stop/relaunch retained Task notes/schedule
and the reply in Drafts. Loopback snapshot independently confirmed matching Task/
event IDs, reply account/source, draft status and empty Sent. Saved UI evidence:
output/wlk-323/native-{calendar,task-after-relaunch,draft-after-relaunch}.jpg.

This is an explicitly labeled simulator-only fixture entry using fake identity/
Firestore on127.0.0.1:5213, real native components and HTTP validation. It does not
prove normal sign-in, real providers, SQLCipher saved/offline mode, Android,
physical devices or release acceptance. No real correspondence or cloud writes.
Fixture entry guard, focused lint, native typecheck, brand/secret checks and an
independent exact-source review passed. See docs/NATIVE_SIMULATOR_SMOKE.md.

Heavy leasea51d59dd074dd5216a51a423 released succeeded after compile; coordinator
explicitly cleared to run PatriBible web CI while light smoke finished. Own app/
simulator, mirror and fixture API stopped afterward; state file retained. Both
PatriBible simulators remained booted, shared browser/live sessions untouched.
No additional heavy phase pending. WLK318 still needs its existing TWO approvals;
no retry or security/credential change. Final landed identity is recorded in PR/
Linear. Historical failure checkpoint below is retained for provenance.

# WLK-323 — first failed attempt (historical; superseded below)

Source ee419305a698135596a97bc9141e3530ec531d20 (merged PR92), unchanged
through the single build. Linear https://linear.app/wlkr-labs/issue/WLK-323.
PatriBible coordinator explicitly cleared the lane; shared lease
9cf8df816b9d26940264c676 admitted10GiB with20GiB floor/free89.5GiB and was
released with failed outcome. No further build phase started; coordinator notified.

Isolated development prebuild succeeded. Copied CocoaPods deployment lock rejected
worktree-relative paths; no-repo-update install succeeded and all201 PODS entries
matched the existing lock. No package/version/source/configuration changes.
XcodeBuildMCP build_sim failed after67.255s with invalid generated C++ identifier
NativeSafeAreaContext 3. The reused shared cached dependency has byte-identical
src/specs/NativeSafeAreaContext.ts and NativeSafeAreaContext 3.ts; generated
safeareacontext.h contains both names. Origin of these duplicate files is unknown.
Do not delete or repair the shared cache. This is a concrete dependency-input
blocker, not a verified defect in Today/Task notes or a successful native build.

Compile used Debug OpenJobDev, two jobs, signing disabled, forced JS bundling,
/tmp/openjob-sim-derived and this worktree's generated native/ios only. No usable
app artifact or runtime/UI/device/bridge/sign-in/TestFlight proof. No simulator
boot/install/launch, live connector action, credentials/settings, publication or
deployment. Existing PatriBible booted devices/browser/web/TestFlight preserved.
Own dependency symlink removed; source remained clean. No xcodebuild left running.

Evidence: /tmp/openjob-323-build-result.json; /tmp/openjob-sim-prebuild.log;
/tmp/openjob-sim-pods.log; XcodeBuildMCP log
~/Library/Developer/XcodeBuildMCP/workspaces/0.1.2-6207ec731efe/logs/build_sim_2026-10-17T01-05-44-119Z_pid61220_f2d14b52.log.
Failed generated project/Pods (~1.2GiB) and DerivedData (~569MiB) retained for
diagnosis under the failed reservation's protection; no unrelated cleanup.

Next action: prepare a fresh isolated dependency tree from existing package-lock
without reusing the duplicate-bearing shared cache, then coordinate a fresh bounded
compile lane with PatriBible before another heavy phase. The single-build request
has been consumed; no automatic build retry. WLK318's existing TWO approvals remain
separate; do not retry pending permissions or change credentials/provider settings.

# WLK-322 — native Personal Today

Branch codex/wlk-322-native-today; baseline c166ef0 (merged PR91).
Linear https://linear.app/wlkr-labs/issue/WLK-322. Today is the initial online and
saved-on-device entry, joining current device-local Calendar blocks, planned open
Tasks and unscheduled work. It reuses shared personalToday and its DST behavior;
no new API, ownership or scheduling engine. Date/timezone and online snapshot vs
saved/pending state are explicit. Timer/foreground return updates the local day.
Exact Task/block navigation keeps mounted notes/title/Calendar/reply editors and
continues through Calendar → Task → source Mail only in the authorized online view.

Evidence:32 React Native component checks cover existing flows, daily work loop,
editor preservation, saved pending/offline routing without online reads and date
rollover/foreground/listener cleanup. Shared local-day/DST23/25-hour check, native/
root TypeScript, focused native lint, brand and secret checks apply. Existing cached
native dependencies reused temporarily; link removed afterward. No install, heavy
build, browser controller or native/device/layout/bridge/TestFlight evidence.
Final reviewed source and landed merge identity are in PR/Linear.

Next dependency: real-account runtime proof is WLK318 after its existing TWO
approvals, following docs/LOCAL_ACCOUNT_ONBOARDING.md. Before an authorized native
execution/build, coordinate the lane with PatriBible coordinator
01a132de-0bf7-7561-944c-4a1d3d3a40d5; preserve current live web/TestFlight.
Do not retry pending permissions, configure credentials/settings, connect providers,
publish or deploy. Independent roadmap work should address an evidenced connected
work gap; avoid expanding edge-case checks or claiming full native parity.
Preserve useful5200 preview, original approved artifact, unpublished0.3.9,
unrecovered WLK302 and unrelated work.

# WLK-321 — native connected Task context

Branch codex/wlk-321-native-work-loop; baseline f01a56a (merged PR90).
Linear https://linear.app/wlkr-labs/issue/WLK-321. Native invented Mail now
opens owner/account/message-qualified linked Tasks, including completed work.
Shared link resolution serves web and native without a second policy. Native Tasks
edit/clear authored notes with existing task.notes online and offline; unfinished
input survives module switches/failures and replacement needs explicit confirmation.
Calendar → Task → source Mail and retained reply input remain usable.

Evidence:29 React Native component checks cover the connected work loop, failed
note saves, explicit clear, replacement cancellation/acceptance, identity clearing
and offline restart. Native/root TypeScript and2 source/link checks pass, including
real loopback HTTP/JWT/API/store composition with fake identity/Firestore transport.
Existing cached native dependencies were reused by a temporary local symlink;
no install or native build. Brand32, source secrets, focused lint and final review
are recorded in PR/Linear. No simulator/device/layout/bridge/TestFlight claim.

Next action: after source merge, continue bounded owner-useful R21/R53 readiness;
actual account proof remains WLK318 pending its existing TWO approvals. Do not
retry pending browser permission, configure credentials/domains, connect providers,
publish, deploy or distribute. Coordinate an eventual authorized heavy iOS phase
with PatriBible. Preserve useful local5200 preview, original approved npm artifact,
unpublished0.3.9, unrecovered WLK302 and unrelated work. No heavy phase this slice.

# WLK-319 — authored Task notes

Active branch: codex/wlk-319-task-notes; baseline5a9faeb (merged PR89/Today).
Task notes are optional plain text up to20,000 Unicode characters. Dedicated
`task.notes` changes notes only; empty text clears. App/API/CLI schemas and types,
native response/display, and shared offline projection/sync change together. Notes
are never copied automatically from Mail or into Calendar/activity records.
The web editor retains unfinished input across module navigation and failed saves;
opening another Task's notes asks before discarding an unfinished edit.

Verification:34 focused checks pass across signed API/CLI Unicode persistence,
scoped agents/revocation/minimal results, durable offline browser/store sync and
native-source HTTP composition. Root TypeScript/OpenAPI/generated types, brand and
secret checks apply. Native unit bundling uses root TypeScript without an Expo
install; it does not prove native bridge/device behavior. Independent review caught
aggregate capacity: before-commit projection guard now enforces300k serialized
UTF-16 units and500k UTF-8 bytes, leaving room inside512KiB sync requests. The
boundary regression rejects overflow without mutation and recovers by clearing
notes. Command body bound256KiB supports20k-character JSON escaping.

Actual isolated headless UI: failed save kept multiline notes; Today navigation
kept input; successful save/reload retained plain text, including literal HTML-like
text. The replacement warning preserved another unfinished note after cancellation.
Phone inspection found overlapping Task filters; wrapping field widths fixes it.
Final exact source/review evidence belongs in Linear/PR. Useful saved demo remains
http://127.0.0.1:5200/workspace, /tmp/openjob-317-workspace.json.

WLK318: the TWO owner setup approvals remain pending. Use only an approved secure
mechanism for existing nonproduction operator reuse; add only127.0.0.1 Auth domain
after approval. No raw private key retrieved, configured or copied. Existing IAB
Firebase dashboard proved Google and Apple Enabled onopenjob-nonprod Default tenant;
lookup tab closed without provider edits. No metadata question remains for Shane.
The pending user-browser DevTools route was left alone/closed; its permission was
not assumed. Explicit parent authorization permitted the separate isolated fixture
browser. Preserve earlier EOTP artifact, unpublished0.3.9, stopped WLK302 and
PatriBible/ordinary Chrome. No provider connection, send, purchase, deploy or release.

# WLK-317 — Personal Today follow-on

Active branch codex/wlk-317-personal-today on merged94ab7a4 (PR88).
Linear WLK317 adds browser-local Today → exact Task/Calendar navigation, retaining
unfinished editor buffers and current authorized Personal view. No new API/domain,
provider connection, send or native release. Current Tasks entry remains available. Actual browser proof passed: Today→exact
filtered Task focus with new/title text retained; Today→exact Calendar block across
local/UTC day with another unfinished edit retained. Desktop/tablet/phone inspected;
identity change cleared prior work/inputs. TypeScript and local-day/DST test pass.
Independent diff review found no consequential defects. Final source evidence in PR/Linear.

Precise onboarding handoff: docs/LOCAL_ACCOUNT_ONBOARDING.md. Existing nonsecret
nonprod client fields are committed; preview server binding names exist. Existing
operator vault reference is documented but key not retrieved/verified. Public SDK
metadata confirms127.0.0.1/localhost absent from authorized domains. Earlier provider API metadata403 arose from a different CLI quota consumer.
Actual IAB dashboard now confirmsGoogle+Apple Enabled; no unrelated API change.
Only existing nonprod operator reuse and127.0.0.1 authorized-domain approvals remain. No changes made.
No generic new-project/key request; actual sign-in/write proof remains pending.

# WLK-313 — portable installed app and Node service

Worktree: /Users/shanewalker/Documents/Codex/2026-10-16/task/openjob-product-entry
Branch: codex/wlk-313-portable-runtime; baseline e40b7b1 (merged PR87).
Linear: https://linear.app/wlkr-labs/issue/WLK-313

PR87 reconciled the owner-confirmed Workspace core and practical owner-pilot scope.
C01–C13 authority/provenance is retained in docs/ARCHITECTURE_ALIGNMENT.md.
Company IS Workspace, transferable human owner, explicit permissions, external agents
and independent revocation; no persistent hosted Workspace agent. That future domain
is not claimed implemented by this portable Personal runtime.

WLK313 packages real web/API assets and a portable Node service sharing existing
Firebase identity, Firestore stores, Personal workspace and agent APIs with the
Cloudflare composition. `openjob app` remains the visibly synthetic, persistent
local demo. `openjob server` is separate: no fixture sessions, missing configuration
shows setup and API/health503. `/account` uses existing sign-in and explicit account/
username creation; Group administration is unavailable. Presence-only health is not
credential verification. No live Firebase/provider sign-in or real sends are proven.

Local Compose runs loopback-bound demo5191 and separate setup-only service5192;
its demo state volume survives restart. `npm run server:bundle` creates the portable
allowlisted archive with source/file hashes for later authorized Linux setup. No
server purchased/provisioned/deployed; no new access/credentials, npm publication,
iOS build/distribution or provider configuration. See docs/PORTABLE_SERVICE.md.

Practical source checks: root TypeScript compile,32 brand assets,10 distribution
checks,4 portable-service checks,9 Personal/agent-grant checks; secret scan and diff
check passed. Linux Docker image built; actual Mail→Task→Calendar→complete→draft
flow plus account isolation/send denial and restart persistence passed. Final exact
source installation/container proof and independent review are recorded in Linear/PR.
Actual Firebase onboarding awaits separately approved development configuration and
provider/domain setup; no anonymous or demo fallback is used by the real service.

WLK302 cloud history shows unfinished ImapFlow TLS/login implementation progress,
but no recovered source/branch/commit. Preserve that work; do not duplicate it or
claim integration. WLK313 does not change its scope. PatriBible resource coordination
acknowledged bounded Node/web packaging; no ordinary Chrome or native heavy phase.

## Separate publication blocker

Owner approved exact dev0.3.8-dev.1792161876.9ba3929fbf0c from source
9ba3929fbf0ccc3e24e2577410a355fa3798736e. One local publication attempt was
rejected by npm EOTP. Public readback: version404, devstillinitial37c322b,
latest0.3.7 unchanged. No automaticretry; owner Terminal authentication handoff
in Linear307. Preserve original checkout clean atapprovedsource, archive/plan
/tmp/openjob-309-pending-9ba3929. This designworktree doesnotdirty thatcheckout.
No newpublicationorlatestchangeconfirmed. No authconfiguration/securitychanges.

## Existing product and saved work

PR84localCI/manualActions, PR85Mail editor, PR86Mail↔Task navigation merged.
Their checks and actualnpm app/API smoke are recorded inLinear307–309. Current
prototypeproviders remaininvented; real sendsdisabled; liveconnectionsunconfigured.
Saved installed demos5196/5197 retained. Mac disconnect may stopprocesses: restore
fromfresh-pathcopy ifcrashlocked, retainoriginalstate+lock. 5196 uses
/tmp/openjob-308-demo/workspace-recovered-309.json, 5197 /tmp/openjob-309-demo/workspace.json.
Initialapprovedarchivesandoriginal0.3.8candidatein/tmp retained. Do notreplace
an approved artifact with latercode under thesameversion.

WLK302 remainsunrecovered in stoppedcloudthread01a14099-4e09-73d1-bed5-0e41e70560de;
no remote branch/PR/checkpoint. Do notduplicateitsTLS/login work. Unrelated
PatriBible/Desktopwork untouched. Detailedhistory/evidence remainsLinear/Git.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [GLOSSARY.md](GLOSSARY.md)
CLI: `npm run`
<!-- wstack:end setup -->

---

# Native draft integration — landed R32 pages and folders

20October23:29UTC: integrating main8156b492d219544b6bf3141726af666746fd877e
(PR121/122) into native draft PR120. Only FEATURES.md and this handoff conflicted;
both native and Mail records are retained. This supersedes the earlier continuation
note below that says the native branch still has its old main base. Current R32
gaps are search, lazy bodies, sync/stale metadata and integrated live acceptance.
Native paging/folder controls remain separate. All21 R53 source files plus its
recorded package/lock/identity inputs hash-match a8a4b3e. The existing proof snapshot,
installed Android APK, Metro and fake5213 service are untouched. Integration root
and native types pass; six native suites pass160 tests; actual API/native HTTP group
passes13 checks across both home types and current R32 contracts. Counts overlap
earlier runs. Android UI-method authorization is still required before its UI journey. Do not repeat the standalone real read or infer approval from its old answer.

# Continuation — R32 paging landed separately from native R53

20October23:12UTC: PR121 merged on main as
bf4bcd4c69ddb0dac885d6e8b20de97f339bcfda (source d36cd95, reviewed head d3fdeaf).
Configured API/CLI/web Mail now reaches later pages, retains authored titles,
blocks paging during uncertain Task confirmation, and recovers from invalid cursors.
Thirty focused checks and actual fixture browser proof passed; canonical evidence
is in main's w.md and Linear thread845d4c0c-61a1-4a62-b9c3-96d0b5e3473a.
This native branch still has its earlier main base; no native or proof inputs changed.
R32 search/folders, lazy bodies, sync metadata and integrated live work remain open.
R53 still awaits the separate Android SDK UI-method answer; the older Google
unverified-app approval does not answer it. Preserve its installed APK, own emulator,
loopback5213/8088 fixture services and original26 files. Do not repeat the real read.

# P-WLK-6 / R53 — native connected Workspace journey

20October: sole local implementation owner. Linear issue creation hit the free
issue limit; execution continues in the existing OpenJob project discussion
ba6592c3-b3e1-4908-b830-3532ab70aaf4, without changing the plan or creating another
queue. Source a8a4b3ed98f704d821b49d790452ef5f7213164e is pushed in draft
[PR120](https://github.com/scwlkr/openjob/pull/120), branch
codex/p-wlk-6-native-connected-workspaces. Source-only draft; practical native gates
are pending and R53 is not complete.

Native Connected Workspaces uses the existing identity/session fence and shared
HTTP routes for catalog/create/retained Personal mapping, configured Mail ->
reviewed source Task -> normal Today/Tasks/Calendar -> complete -> fresh source ->
reviewed authored OpenJob reply. Source bodies remain transient; per-context reply
buffers survive module switches; unsaved replies block Task deletion. Guarded
notes retain their original base. Verified session restoration is required before
reopening ended connected access. Existing Personal/offline and Groups remain.
Consent is still in the existing Connections app; no provider Calendar, sending,
offline Mail or persistent provider access was enabled.

Isolated root/native types, affected lint (existing warnings only), OpenAPI38paths /
54operations, brand32 and root secret1051 pass. Six native suites pass100 tests;
12 targeted API/native loopback HTTP checks pass (earlier groups overlap). These
exercise both Owned and retained Personal homes, notes/draft stale writes, late
identity responses, foreign-owner denial, redaction and disconnect denial. Final
read-only source review has no findings; two earlier P2s were fixed and covered.
All21 changed source files match the isolated build snapshot. Original26 untracked
files remain byte-identical; shared dependencies and existing sessions preserved.

iOS practical fixture proof passed from source a8a4b3e on the owned iPhone18 Pro /
iOS27 simulator. Fresh locked native dependencies and all201 locked Pod entries
match. First Xcode call exceeded the tool's300s response limit; the original build
continued to completion. The unchanged incremental invocation then recorded a
successful54.8s result and an embedded development-identity Release app. Actual UI:
reviewed source Task title, authored notes, saved20October23:00–23:30UTC plan,
Calendar exact Task, complete, fresh source and reviewed Reply all. Authored text
survived Calendar and independent owner-Workspace creation/context switches. That
new Workspace correctly had no Mail connection. Saved revision1 reopened after
stop/relaunch with exact body/mode/account/recipients. Fixture disconnect denied
native save and fresh-source access; completed Task/block remained. Synthetic
screenshots/receipt are in output/r53. Owned simulator shut down; temporary keyboard
routing restored. iOS build lease42be431e909e74377380242a released succeeded.

Android work in progress: /tmp/openjob-r53-ji537fxd is the outside-sync proof copy.
Only its native package main selects the committed simulator-connected-smoke entry;
the actual checkout's normal index.ts entry is unchanged. Development debug build
session2017 passed in25m33s (571tasks); the verified development APK is installed
on owned AVD OpenJob_R53_Connected / emulator-5580. Existing debug networking was
used; no existing Bubba AVD was reused. Android build lease
aa96892ca56c7c57fe60b7e2 released succeeded. APK SHA256
cda191317268d87ba205fab616004cb7c5db4e672f2a400d2e96e0fc7bee2be9;
sanitized build receipt: output/r53/android-build-receipt.json. Its build automatically installed the required NDK using
the SDK's existing accepted license; source lockfiles were unchanged. Local fake
service PID5910/session60283 uses /tmp/openjob-r53-native-state.json on5213; it is
disconnected after the iOS denial test. Use a fresh dedicated Android state next.
No real Mail read was repeated; key-free Timothy launcher remains disconnected.
The Android fixture service session97374 now uses fresh dedicated
/tmp/openjob-r53-android-state.json on5213; the disconnected iOS service was stopped.
The emulator is online. CUA cannot bind its raw SDK window (not exposed as a supported
app); alternative Android SDK UI automation needs explicit method authorization
before input actions. The build is complete; no Android UI input has run. Method authorization was
requested through the current chat; do not infer approval from the earlier bounded
Google notice authorization. Metro is
loopback-only/offline on8088 with the committed fixture main selected only in the
proof copy; Metro PID45723/session90405. Initial --offline/--host combination was
rejected by locked Expo; EXPO_OFFLINE=1 plus --host localhost works and lsof confirms
127.0.0.1:8088. Manifest200 selects the committed fixture entry and dev identity.
Bounded SDK UI helper prepared at /tmp/openjob-r53-android-ui.py (syntax checked,
not executed). It refuses other AVDs, apps and non-fixture services.

Next: finish the Android written journey under ADR0017, record
exact artifact inputs/results, update this receipt and Linear, then review the
exact final PR head for an authorized nondeploying merge. Real native login,
provider/device/storage/release gates and full R33/R53 acceptance remain separate.

---
