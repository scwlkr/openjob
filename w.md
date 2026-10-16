# OpenJob overnight prototype

Owner directive, 16 October: full working prototype by morning Central; working target **7 AM Central**. Rough edges/rewrites accepted. [Master mission](docs/MASTER_MISSION.md), [delivery/check policy](docs/PROTOTYPE_DELIVERY.md). Linear [WLK-278](https://linear.app/wlkr-labs/issue/WLK-278) owns execution; no duplicated Markdown backlog.

Integration branch `codex/wlk-278-workspace-prototype`, based on reviewed PR53 `a19d40c` plus PR54's renderer repair. Up to three bounded workers own engine/fixtures, web UI and loopback API/CLI. One integration owner owns contracts, policy, tests and publishing. [PR55](https://github.com/scwlkr/openjob/pull/55) integrates PR53/54; resolve them as superseded after merge.

Target: one labeled simulated-provider app at `/workspace`, multiple mail accounts, mail read/compose/reply drafts, message→personal Task→scheduled Calendar block→completion, event CRUD, scoped agent controls/inspection/revocation. Shared engine behind HTTP API/CLI; demo server saves fixture state locally and reloads it across restarts. Provider fixtures are not live integrations, selector identities are not production authentication, and actual sending always fails. No external mailbox/calendar writes.

Policy changed with explicit owner authorization: historical pixel snapshots are obsolete and retained only as diagnostic history. Their previous failure is not relabeled passing. Functional responsive/theme/contrast/editing checks replace pixel matching. Required `npm test` still compiles/builds/types, checks contracts/native quick, domain/CLI/API and functional browsers, then secrets. External protections remain mandatory. System Chromium is valid for these functional checks; stop chasing the unavailable old binary. Native quick checks do not prove device/store readiness.

Verified implementation `55881bd7be9c6ff058c728753ec386c047bbaf14`, tree `abae9629b3a6adf0f58380beabefc18580294a89` (local gate began at equivalent commit `ab0ccb3`). Required npm test PASSES: brand/build/root TypeScript/generated types/native lint+types,272 native units,474 Node tests,133 functional browser tests, secret scan480 files. Root targeted lint and independent engine/API/launcher reviews pass. Actual Node app route performs message→Task→Calendar and reload; CLI sees the same persisted state, no page errors. Test-state override/startup race and immutable proxy-header defects were fixed. Evidence: `/tmp/openjob-278-test.log`, `/tmp/openjob-278-preview-smoke.log`, `output/verification/wlk-278-workspace/`; screenshots inspected desktop/phone. Historical pixel mismatch remains recorded, replaced under explicit owner policy rather than reported passing. Final handoff change only updates this file.

Delivery: PR55 normal merge next; repository main unprotected, no rulesets/check runs/status contexts, no workflow directory; README states production deploys require release:publish. No release command run. Next [WLK-279](https://linear.app/wlkr-labs/issue/WLK-279): reopen/edit saved draft, explicit simulated Sent workflow with separately scoped capability and durable state, while mail.send stays denied. Cloud environment locator remains in private Linear notes. Reuse existing parent assignment; no duplicate schedule.

No real credentials, live correspondence, spending, security/hosting settings changes, destructive live data operations or production release. No personal-computer fallback. Human review precedes production release. Morning expectation is a complete reproducible prototype, not all live provider/native/production capabilities in the master plan.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
