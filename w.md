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
