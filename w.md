# WLK-324 — Personal JSON export implemented; draft PR95, browser proof blocked

Branch codex/wlk-324-personal-export; reviewed source
5cf83f7ffeab268d82f278b60436c23e353821c9; base/main33558059. Draft PR95:
https://github.com/scwlkr/openjob/pull/95. This is a bounded R21/OJ-X4 product
slice, not completion of independent Workspace onboarding or the full roadmap.
Current WStack c3e3ac6 /0.2.0, AGENTS/mission/alignment/Linear/livePR state read.
Full Workspace storage/identity cutover was deliberately not replaced with unused
parallel records. No overlap with unrecovered WLK302 or pending WLK318.

Implemented one-snapshot human-only version1 JSON export with explicit sections:
Tasks, Calendar, optional saved authored drafts. Allowlisted projection preserves
notes and links only when both endpoints are selected; omits incoming Mail/source
references, account addresses/connections, Sent/activity/grants/tokens/receipts.
Selected drafts retain authored recipient/subject/body and opaque sending account
ID, explicitly fixture mode. API rechecks identity before return. Web defaults
Tasks/Calendar on, drafts off. CLI saves a new private0600 file, cannot overwrite
or print file content. Bound1MiB formatted UTF-8 /1000records per array.
No import/restore, pending offline/unsaved/recovery text, shared Workspace or native
export UI. Existing stack, providers, approved npm artifact and shared sessions kept.

Evidence: focused projection/API selection/isolation/denial/redaction/size and CLI
signed-fakeauth file checks passed (4 new tests); existing personalAPI regression
also checked. TypeScript, focused lint, OpenAPI/schema generation/check, brand32,
secret scan848files and diff checks passed. Independent exact-head review5cf83f7
found no consequential findings. Actual built browser preview showed Export panel,
Tasks/Calendar checked and invented drafts unchecked. This is UI-render/selection
proof only: browser file delivery is UNVERIFIED, not passed.

The browser download request on5201 remained unanswered and the tool transport
closed. Parent reports a separate unanswered5214 request too. Parent explicitly
ordered no further download permission requests or endpoint changes/retries. None
was approved. Do not resume/retry either prompt, use another browser/endpoint to
bypass it, or claim API/CLI proof as browser download proof. No browser-dependent
acceptance completion or merge was performed. PR stays draft; WLK324 stays In
Progress. Next: preserve this checkpoint; await explicit direction before any
browser download verification. No additional engineering/test filler is needed.
The owned temporary5201 preview was gracefully stopped after this checkpoint;
existing5200/other useful previews, PatriBible devices/browser/live services kept.
No heavy phase used; reuse PR94 simulator evidence, never repeat it for this slice.
WLK318's TWO approvals and npm publication remain untouched.

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
