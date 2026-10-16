# OpenJob cloud handoff

[Mission](docs/MASTER_MISSION.md), [prototype policy](docs/PROTOTYPE_DELIVERY.md), sole queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Cloud only; sole implementation writer/integration owner with narrow independent review. Parent assignment unchanged; no schedule created. Private environment and owner walkthrough references are in Linear.

Delivered [WLK294 / PR73](https://github.com/scwlkr/openjob/pull/73), branch `codex/wlk-294-calendar-task-workflow`. Exact tested source `c903856d2965437eb85403d2976c544d69a9055e`, tree `4aa01ec42e9de7ec0956cc7ded4f590a7c75745b` (equivalent local `05b0ef32c73150f43c186fdf7d6e25c9d276e869`). Calendar opens its exact linked Task for editing/completion/rescheduling, then source Mail/reply. Both action and navigation validate the visible event/Task/calendar/owner/schedule relationship. Unfinished Task titles, new-task text, schedule fields and Calendar editors survive tabs and clear on identity changes. Cancel Calendar edit discards abandoned timestamps and restores a valid selected-day slot. Existing agent API/CLI resolves the same permitted pair; insufficient scopes redact records/links. No new API/domain/provider operation. [Guide](docs/PERSONAL_WORKSPACE.md).

Required npm test PASS: brand/build/types/contracts, 272 native units, 607 Node, 151 browser and 564-file secret scan. Focused actual authenticated desktop/phone chain, fixture Calendar/Task 4, CLI agent 4, types/lint/diff pass. Independent review found no material issue, including the Cancel-edit repair. First focused browser attempt used an immediate checkbox assertion; corrected it to await the existing persisted async state and reran. Evidence /tmp/openjob-294-test.log. Final w.md-only receipt follows tested implementation; exact final head/merge in Linear. Captures inspected and uploaded to owner Page; viewer rendering unobserved.

[WLK293 / PR72](https://github.com/scwlkr/openjob/pull/72) merged at 588c0eb: private Tasks reopen the exact source mailbox/message, clear hiding filters and focus the reader, preserving per-message unsaved replies and composition. [PR71](https://github.com/scwlkr/openjob/pull/71) completed authenticated invented Mail→Task→Calendar→complete→saved/editable reply→local Simulated Sent. Seven personal agent scopes cover five resources with hashed credentials, expiry/revocation/deletion fences, redaction and minimal write acknowledgements. Provider preview remains separate/read-only and creates title-only Tasks. Group Tasks get no mailbox links. Real sending always denies.

Provider foundation PR68–70 remains optional/unbound, verified only over invented transport: metadata/vault broker, mock OAuth lifecycle and bounded transaction CAS/cleanup. No secure vault, real exchange/signature verification, refresh/runtime/deletion integration or reconnect is configured. Firebase sign-in is not Mail consent.

Saved fixture demo: `npm run dev:workspace -- --fresh` creates new isolated state; omit --fresh to resume. [Walkthrough](docs/WORKSPACE_DEMO.md). Existing /tmp/openjob-workspace-demo-zRDhjZ/state.json preserved; preview restored after gates. /tmp/openjob-294-preview-receipt.json and Linear record session/digest. Localhost is environment-only; external sharing unavailable. Node24.19/npm11.9/Chromium154/locked dependencies preserved; no reinstall.

Next [WLK295](https://linear.app/wlkr-labs/issue/WLK-295): find personal work by status, text and planned day in app and existing CLI. Remaining mission gaps: live multi-provider connection/sync and provider Calendar writes; full native personal workspace/device proof; offline editing/sync/conflicts. These are capability limits, not another Markdown execution queue. No live grants, credentials, settings, correspondence, spending, shared reset or deployment. Native unit/type/lint checks do not prove devices; ADR0017 gates remain. Live database/provider runtime unverified; earlier metadata probe failed authentication. Personal state bounded to 900 KB/100 grants; expiry checked before REST dispatch, not server commit clock. Main has no workflows/rulesets/required contexts; ordinary merges do not deploy. Human review precedes production release.

Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
