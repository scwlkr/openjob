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
