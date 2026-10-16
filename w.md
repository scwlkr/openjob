# OpenJob cloud handoff

[Mission](docs/MASTER_MISSION.md), [prototype policy](docs/PROTOTYPE_DELIVERY.md), sole queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Cloud-only integration owner; bounded workers on disjoint native files. Parent assignment unchanged; no schedule created. Private environment and owner walkthrough references are in Linear.

Delivered [WLK295 / PR74](https://github.com/scwlkr/openjob/pull/74), branch `codex/wlk-295-personal-task-finding`. Exact tested source `9774c556be8ff348a44fe5513dbb01667d234fd6`, tree `9283d60cd53a2eba859b31842c9e63bf609555ea` (equivalent local `68cd3a7b07e8fe00893d166a4f613026001e0319`). App and `openjob workspace tasks` share status, bounded literal title search and strict planned-UTC-day overlap filters. Default All preserves current work; Calendar navigation clears hiding filters while keeping editors. CLI filters only its authorized snapshot, preserving IDs/redaction/revocation. The canonical helper ships inside the packed CLI; shared app facade reuses it. [Guide](docs/PERSONAL_WORKSPACE.md).

Required npm test PASS: brand/build/types/contracts, 272 native units, 612 Node, 152 browser and 568-file secret scan. Actual desktop/phone find→complete→Calendar target→source Mail→reply/reload passes, as do fixture Tasks and packaged CLI execution. Boundary/scope/revocation checks and independent review pass. Evidence /tmp/openjob-295-test.log. Final w.md-only receipt follows tested source; final head/merge in Linear. Current captures inspected and uploaded; Page viewer rendering unobserved.

Active substantial next item [WLK296](https://linear.app/wlkr-labs/issue/WLK-296): native personal Mail/Calendar/Tasks/agent review. Isolated worktree `/workspace/openjob-native-296`, branch `codex/wlk-296-native-personal-workspace`, began from this implementation while the primary checkout stayed frozen for its gate. Core writer owns token-free API/coordinator, UI writer native screens, integration owner AuthGate/App/Shell and real isolated HTTP proof. No native source is part of PR74. Expected-owner/session epoch fences, no personal disk cache/retries; Groups preserved. Rebase native-only work onto merged main before final integration. Locked dependencies reused by symlink, never commit node_modules links.

Working web/fixture flow: Mail→private linked Task→Calendar→complete→saved/editable reply→local Simulated Sent; Calendar opens exact Task and Task opens exact source Mail. Unsaved editors survive tabs, identity changes clear state. Seven scopes/five resources, hashed grants, expiry/revocation/deletion fences, minimal acknowledgements and Mail read redaction remain. Provider preview stays separate/read-only/title-only when creating Tasks. Group Tasks receive no mailbox links; actual sending always denies. Provider foundation PR68–70 remains unbound/mock-tested, with no secure vault, real exchange/verifier, refresh/runtime/deletion/reconnect wiring. Firebase sign-in is not Mail consent.

Saved fixture: `npm run dev:workspace -- --fresh` creates new isolated state; omit --fresh to resume. [Walkthrough](docs/WORKSPACE_DEMO.md). Existing /tmp/openjob-workspace-demo-zRDhjZ/state.json preserved; restored preview receipt /tmp/openjob-295-preview-receipt.json and Linear record session/digest. Localhost is environment-only; external sharing unavailable. Node24.19/npm11.9/Chromium154/locked deps preserved; no reinstall.

Remaining mission gaps: native personal surface/device proof (active296); live multi-provider connection/sync and provider Calendar writes; offline editing/conflicts/idempotent outbox. Offline writes need protocol work and must not blindly replay ambiguous commands. No live grants, credentials, settings, correspondence, spending, shared reset or deployment. Native unit/type checks do not prove devices; ADR0017 release gates remain. Live database/provider runtime unverified; earlier metadata probe failed authentication. Personal state bounded to 900 KB/100 grants. Main has no workflows/rulesets/required contexts; ordinary merges do not deploy. Human review precedes production release.

Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
