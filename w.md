# WLK-306 checkpoint / npm handoff readback13:13 UTC

After parent reports Shane's13:12 'done', unauthenticated public registry GET and
explicit npm view @scwlkr/openjob dist-tags versions against registry.npmjs.org
BOTH return404. Neither package/version/tag currently readable. No publication
retry and no changes to /tmp/openjob-303-publish-approved. Registry installs/update
checks cannot be verified until actual publication completes. Parent thread is
cloud-backed; local send_message_to_thread returned thread-not-found. Receipt in
Linear WLK-303; report via delegated final outcome. Need non-secret command result,
never OTP/token/password. Source WLK-304 demo5194 and original5193 preserved.

Independent next workflow WLK-306: Find time for an open Task across all saved
owner Calendar blocks. New isolated branch codex/wlk-306-find-time from merged
main30760ac. Implementation checkpoint only: shared bounded finder (existing CLI
runtime/facade packaging pattern), Calendar UI, existing CLI availability command,
human-only task.schedule-available with final current-state overlap check inside
existing CAS mutation, API/OpenAPI contracts. Type generation + root compile PASS.
Not yet behavior-tested/reviewed/merged/published. Review design chose final server
overlap check over advisory-only scheduling. Next: helper interval tests, CAS
concurrency/owner-agent denial, CLI and actual packaged UI proof, narrow review,
focused checks, draftPR/exact-head nondeploying merge. Check parse/options/help,
activity validators across web/native, persistence, and useful error behavior.
No live provider calendars/TLS/sends/new grants; no claims of complete feature.

---

# WLK-304 local persistence review checkpoint

Branch `codex/wlk-304-local-workspace-persistence`, base37c322b (merged PR81).
Implemented opt-in `openjob app --state-file PATH` using the actual packaged UI/API
and existing domain/fake Firestore. Stable synthetic owner records and workspace,
grant hashes/revocations and sync receipts persist; RSA keys/session/provider
secrets do not. Default remains temporary. Private bounded unencrypted JSON,
atomic save-before-success, serialized operations, rollback on precommit failure,
pause on uncertain durability, one-writer lock and non-destructive invalid/stale
lock recovery. UI labels saved/temporary. See docs/NPM_INSTALL.md.

Source restart/failure suite7/7 PASS. Reviewed functional head1b46b455e29b23609c8e66db2fde2388c73aa620
passed final focused core/distribution22/22 and clean-prefix installed restart,
failure and startup-cancellation7/7; actual asset/API create/schedule/complete,
isolation, Host-Origin and shutdown smoke PASS. Prefix /tmp/openjob-304-exact-prefix.
Tarball SHA256 7aa3cdca717cb75cd4c77bd1127f2e07bb80f4c05a266e553230d9cf816ee40a.
Independent review found startup lock cancellation and parent continuation races;
fixed by early signal registration, initialization drain and stopping guards.
Cheap compile/brand PASS; secret scan PASS613 files. No native/device/full-suite
acceptance claimed. Original useful demo5193 remains unchanged. Verified installed saved-mode demo
is available at http://127.0.0.1:5194/workspace with
/tmp/openjob-304-demo/workspace.json (session38617); actual Chrome UI shows saved,
local, unencrypted and synthetic labels. PR82 was created draft and attached;
final exact head/base/protection/merge receipts are in Linear. Only PR82 open,
main37c322b, no protection/rulesets/status checks; sole main workflow only builds
artifacts, never publishes/deploys. Reviewed nonproduction merge authorized.

WLK-303 publication: Shane approved @scwlkr/openjob, signed into existing account;
read-only npm whoami=scwlkr and org owner verified. Exact approved archives in
/tmp/openjob-303-publish-approved remain unchanged. Initial latest publish exited
EOTP, registry still404; dev not attempted. Parent handed Shane commands for human
security completion. Do not retry while waiting or publish WLK-304 artifacts.
Registry readback/fresh installs and separately approved continuous publishing
remain gates. WLK-302 TLS/login cloud checkpoint unrecovered and excluded;
PatriBible and unrelated original checkout untouched.

---

# Local WLK-303 integration checkpoint

Isolated Mac checkout/branch `codex/wlk-303-npm-distribution` from main `5358f6cc0c030d478aafea7d4762fdab68d799e3`. Existing Desktop/dev/openjob and PatriBible remain untouched. WLK-302 cloud stop was accepted per parent; final TLS/login checkpoint is not recovered and is excluded here. Linear WLK-303 remains the execution record. Parent authorized non-overlapping integration after fresh main/PR/branch verification; inaccessible WLK-302 is no longer a generic merge blocker. No WLK-302 branch or PR is published; preserve any cloud-only work for later recovery.

Implemented actual built personal workspace + bundled synthetic API + existing CLI artifact; immutable latest/dev channel metadata, public-registry notice-only checks and artifact-only CI. Corrected detached main source resolution and app SIGINT cleanup. No publishing/deploy/credential configuration. Registry ownership and separately approved publication automation remain blockers; public tags do not yet track this source. [Install/run/limits](docs/NPM_INSTALL.md).

Evidence: real UI/API Vite package build, npm pack (53 files, about 672kB), clean-prefix install `/tmp/openjob-303-prefix`, installed version/help and actual Chrome UI at http://127.0.0.1:5191/workspace. Explicit synthetic Alex/Sam/no-live-provider labels observed. Brand check and 9 distribution checks passed. `npm run typecheck` generated runtime types; direct `tsc --noEmit` passed after generation. Focused core run had 46/48 passing: both failures were the same old help assertion rejecting the newly documented app prototype; assertion now scopes that exclusion to existing production commands. Corrected focused rerun PASS48/48, including clean installed CLI suite. Installed mutation smoke PASS: actual static assets, create/schedule/complete Task, owner isolation, Host/Origin denial and signal shutdown. First smoke inputs omitted completed:true and assumed fetch preserved Host; corrected against existing API and node:http, with no gate weakening. Actual Chrome UI was inspected earlier; mutation proof is HTTP, not an observed browser click.

Mac Node26.5.0; no native installs/builds or duplicate full suites. Logs `/tmp/openjob-303-*`. Draft [PR81](https://github.com/scwlkr/openjob/pull/81) is open. Narrow independent review found unverified-registry update suggestions; registryVerified:false now suppresses all requests/recommendations pending ownership approval, with regression. Follow-up review clean. Packaged child API additionally requires an ephemeral parent proxy token. Functional head `97ec73e7b1394ca9afdd290949b95bfed7670249` passed fresh-prefix install, API mutation/isolation/Host-Origin/shutdown smoke, compile and 9 distribution tests. Manifest source matches; tarball SHA256 `17648e972587bb1f8df251ac3734db8dafaba236b710736ff6a40f7388c7374f`. Final prefix `/tmp/openjob-303-final-prefix`; reviewed local app runs at http://127.0.0.1:5192/workspace (session21276). Update JSON reports unavailable/registry_not_verified as intended. PR81 exact head confirmed live, only open PR. Parent authorized ordinary nonproduction integration after concrete overlap review; no WLK-302 branch/PR is published and no server/providers implementation files change. The two-line synthetic server proxy guard is the sole existing API-server edit. No deployment/publishing workflow exists; new CI builds artifacts only. Full receipts and final review are in Linear. Read-only npm metadata: unscoped openjob belongs to homy/HomyeeKing (latest1.0.11); proposed @scwlkr/openjob returned404, Mac npm whoami ENEEDAUTH. Full app artifact now uses @scwlkr/openjob with the existing openjob binary; no scope rights claimed. Remaining: reviewed merge after fresh-base exact-head checks, separately approved npm account/scope/publication setup, and independent WLK-302 recovery. No Done claim for live registry channels. Scoped functional head `3ede2447545387eafcf573b7e4944637a2c49a6d` additionally passed clean-prefix scoped install and mutation/isolation/shutdown smoke, compile, 10 distribution tests and 32 existing agent-scope/revocation/provider/IMAP checks. Scoped tarball SHA256 `0bb2060686e390607fd848ec75b2a6f86bc6db3cda687f1976f5af1a5faa818d`; prefix `/tmp/openjob-303-scoped-prefix`. Registry checks remain disabled. Final main/PR/status and merge receipts are in Linear. Preserve WLK-302 cloud-only checkpoint as unrecovered, independent of this non-overlapping integration. Preserve useful local app for Shane; keep temporary demo API state separate from saved fixtures. No real mail, external account connection, release or deployment.

---

# OpenJob cloud handoff

[Mission](docs/MASTER_MISSION.md), [run guide](docs/WORKSPACE_DEMO.md), sole queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Cloud only; one integration owner and disjoint workers. Parent assignment unchanged; no schedule created. Private environment and owner Page references stay in Linear.

[WLK301 / PR80](https://github.com/scwlkr/openjob/pull/80), branch `codex/wlk-301-imap-inbox-read`, adds a bounded generic IMAP Inbox reader through existing connection → broker/vault → authenticated API/CLI/app. Injected byte sessions emit EXAMINE/UID SEARCH/UID FETCH BODY.PEEK only. Server/username/mailbox/config/revision binding, UIDVALIDITY-qualified references, cursor UID ceiling and repeated authorization preserve isolation. Preview-to-Task saves only the title. Gmail/Outlook defaults and Google-only mock OAuth remain. Provider details collapse; long reader values wrap on phones.

Exact completed-gate source `9ba69faf9b1765aa71c73293897edbca551adedb`, tree `2f28664812b13c2ae4abd26f8fa1682c2d2062de`. Required npm test PASS: brand/build/types/contracts, 325 native unit tests, 690 Node, 161 browser and 629-file secret scan; /tmp/openjob-301-test.log. Protocol14/14 and actual API/CLI/browser proof covers text/paging, owner/config/provider isolation, zero-read approval denial, revocation, UIDVALIDITY reset/recovery and title-only Task privacy. Root review fixed mixed-case protocol tokens and approval after async close; regressions cover close-time revoke/expiry and late-open cleanup. Independent review clean. Initial focused/browser attempts corrected guessed INBOX casing and a test-reset return value; no weakened gates. Final usage/handoff documentation only is separately diff/secret checked; exact final head/merge in Linear.

Fresh physical locked-install checkout /workspace/openjob-fresh-298 replayed all nine built scenarios PASS24.6s, including Outlook, Calendar files and offline work, same source/tree. Logs /tmp/openjob-301-fresh-browser.log and /tmp/openjob-301-fresh-receipt.json. Useful built personal demo restarted at environment-local5193/workspace with ready IMAP fixtures; temporary signed identities/fake Firestore and invented protocol bytes only. API state lasts for its process; use a fresh browser context/origin after restart. Reproduce: inspect root/native install scripts/patches, npm ci, npm run dev:personal-workspace -- --port 5191. Mail→Add invented examples starts the linked workflow; Mail preview→Mock IMAP exercises this adapter. No hosted/share URL available.

Original persistent fixture /tmp/openjob-workspace-demo-zRDhjZ/state.json is restored separately on5173/4180 and remains unchanged: SHA256 f9e30422757bfa679787a0b31f3035946873e25191c24971775bfc3c2bff2f36. Preview receipts/sessions in Linear. Node24.19/npm11.9/Chromium154 and locked stack unchanged; current remote WStack matches local0.2. No dependency installation/change this cycle.

Limits: INBOX only, ≤10 messages/page, ≤1000 search UIDs, 256KiB responses/64KiB literals, limited ASCII/UTF8 text/plain with 7bit/8bit body encoding. Unsupported MIME/HTML/multipart/attachments/encoded-word headers fail explicitly. No conversation reconstruction, sockets/TLS/login, writes/sends, Calendar or synchronization. Internal imap.read approval and session attestation do not prove OAuth consent or remote authentication. Purelymail is an intended provider, not verified live compatibility. [Exact boundary](docs/providers/IMAP_READ.md).

Next: owner review of the runnable workflow, then a scoped Linear implementation for secure provider transport/auth/runtime/vault cleanup or another practical Mail outcome. Live acceptance needs an owner-selected test account and separately approved setup. Full MIME/provider Calendar/writes/full offline Mail and actual native devices remain unimplemented or unverified. Cloud unit/browser checks do not prove native encryption, durability, rendering or release acceptance. No real credentials/accounts/grants/correspondence, real sends, shared reset, settings changes, spending, deployment or release. Human review precedes production release; main has no deploying workflows/rulesets/required external contexts.

Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
