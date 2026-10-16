# OpenJob cloud handoff

[Mission](docs/MASTER_MISSION.md), [prototype policy](docs/PROTOTYPE_DELIVERY.md), sole queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Cloud only; sole implementation writer/integration owner, narrow independent review. Parent assignment unchanged; no schedule created. Private environment and owner walkthrough references are in Linear.

Delivered [WLK293 / PR72](https://github.com/scwlkr/openjob/pull/72), branch `codex/wlk-293-open-private-source-mail`. Exact tested source `5436506935210f2a0f7e17461073052c4d89c054`, tree `d14d48528e75f2e7996eeaa0435a1a61b0443119` (equivalent local `2f1c7f67b6769a09a1016a1bbaba3832a343a356`). A private Task can reopen its exact owner-visible source message/account, select Inbox, clear hiding filters and focus the reader. Unsaved replies stay per message; composition/editor text survives navigation. Unavailable/redacted/mismatched sources offer no action. Existing agent API/CLI resolves permitted source IDs; Tasks-only access redacts them. No new API/provider operation. [Guide](docs/PERSONAL_WORKSPACE.md).

Required npm test PASS: brand/build/types/contracts, 272 native units, 607 Node, 150 browser and 562-file secret scan. Focused actual authenticated journey at 1280/720/390px, fixture Task browser 2, CLI agent 4, TypeScript/lint/diff pass. Independent review found no material issue. The first focused fixture startup correctly refused occupied port 4180; preview stopped and rerun passed with isolated state. Evidence /tmp/openjob-293-test.log. Final w.md-only receipt follows tested implementation; exact final head/merge in Linear. Current captures inspected and uploaded to owner Page; Page viewer rendering unobserved.

[PR71](https://github.com/scwlkr/openjob/pull/71) completed authenticated invented Mail→private Task→Calendar→complete→saved/editable reply→local Simulated Sent through shared API/CLI/UI. Seven personal agent scopes cover five named resources with hashed credentials, expiry/revocation/deletion fences, minimal write acknowledgements and mail:read-required draft reads. Provider preview stays separate/read-only and creates title-only Tasks. Group Tasks receive no mailbox links. Actual sending always denies.

Provider foundation PR68–70 includes optional owner-only metadata/vault broker, mock OAuth reservation/recovery and bounded durable transaction CAS/expiry cleanup, all over invented transport. Production factories remain unbound/live-disabled; secure vault, real exchange/signature verification, refresh/runtime/deletion integration/reconnect remain absent. Firebase sign-in is not Mail consent.

Saved fixture demo: `npm run dev:workspace -- --fresh` creates new isolated seeded state; omit --fresh to resume. [Walkthrough](docs/WORKSPACE_DEMO.md). Existing /tmp/openjob-workspace-demo-zRDhjZ/state.json preserved; preview restored after gates. /tmp/openjob-293-preview-receipt.json and Linear record its session and unchanged digest. Localhost is environment-only, external sharing unavailable. Node24.19/npm11.9/Chromium154/locked dependencies preserved; no reinstall.

Active [WLK294](https://linear.app/wlkr-labs/issue/WLK-294), branch `codex/wlk-294-calendar-task-workflow`, sole writer: manage a scheduled Task from its Calendar block and preserve unsaved Task/Calendar edits across tabs. Broader mission gaps: live multi-provider connection/sync and provider Calendar writes; full native personal workspace/device proof; offline editing/sync/conflict behavior. These are capabilities still absent, not another Markdown execution queue. No live grants, credentials, settings, correspondence, spending, shared reset or deployment occurred. Native unit/type/lint checks do not prove devices; ADR0017 gates remain. Live database/provider runtime unverified; earlier read-only database metadata probe failed authentication. Personal state remains bounded to 900 KB/100 grants; expiry is checked before REST dispatch, not guaranteed at server commit clock. Main has no workflows/rulesets/required contexts; ordinary merges do not deploy. Human review precedes production release.

Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
