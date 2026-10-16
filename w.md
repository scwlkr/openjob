# OpenJob overnight prototype

Owner directive, 16 October: full working prototype by morning Central; working target **7 AM Central**. Rough edges/rewrites accepted. [Master mission](docs/MASTER_MISSION.md), [delivery/check policy](docs/PROTOTYPE_DELIVERY.md). Linear [WLK-278](https://linear.app/wlkr-labs/issue/WLK-278) owns execution; no duplicated Markdown backlog.

Integration branch `codex/wlk-278-workspace-prototype`, based on reviewed PR53 `a19d40c` plus PR54's renderer repair. Up to three bounded workers own engine/fixtures, web UI and loopback API/CLI. One integration owner owns contracts, policy, tests and publishing. PR53/54 remain open until integrated verification/delivery; do not lose their reviewed implementation.

Target: one labeled simulated-provider app at `/workspace`, multiple mail accounts, mail read/compose/reply drafts, message→personal Task→scheduled Calendar block→completion, event CRUD, scoped agent controls/inspection/revocation. Shared engine behind HTTP API/CLI; demo server saves fixture state locally and reloads it across restarts. Provider fixtures are not live integrations, selector identities are not production authentication, and actual sending always fails. No external mailbox/calendar writes.

Policy changed with explicit owner authorization: historical pixel snapshots are obsolete and retained only as diagnostic history. Their previous failure is not relabeled passing. Functional responsive/theme/contrast/editing checks replace pixel matching. Required `npm test` still compiles/builds/types, checks contracts/native quick, domain/CLI/API and functional browsers, then secrets. External protections remain mandatory. System Chromium is valid for these functional checks; stop chasing the unavailable old binary. Native quick checks do not prove device/store readiness.

Checkpoint: engine/API/CLI focused checks10/10 pass; connected browser flow and phone layout2/2 pass. Actual Node app route also performs message→Task→Calendar and reload, with matching CLI state and no page errors. Root types/lint pass. Review found test-state override/startup race; fixed. Actual app verification found immutable proxy response headers; fixed by returning a mutable response. Integrated npm test is next; no full-gate pass claimed yet. Evidence output/verification/wlk-278-workspace/ and /tmp/openjob-278-preview-{smoke.log,cli.json}. Cloud environment locator remains in private Linear notes. Reuse existing parent assignment; no duplicate schedule.

No real credentials, live correspondence, spending, security/hosting settings changes, destructive live data operations or production release. No personal-computer fallback. Human review precedes production release. Morning expectation is a complete reproducible prototype, not all live provider/native/production capabilities in the master plan.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
