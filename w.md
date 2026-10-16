# OpenJob cloud handoff

[Mission](docs/MASTER_MISSION.md), [prototype policy](docs/PROTOTYPE_DELIVERY.md), sole queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Owner target: complete connected prototype by 7 AM Central; rough edges accepted. Cloud only, up to three bounded file owners and one integration owner. Existing parent assignment unchanged; no new schedule. Saved environment and private owner artifact references are in WLK-280.

Active: WLK-283 on `codex/wlk-283-personal-task-controls`, base main `6ade753974c23cfa8a03e9befe114a0f6cb444d8`. Task title edit/reschedule/unschedule/delete preserve linked Calendar consistency and source Mail. Linked mutations require both Personal task and calendar write permission. Added `npm run dev:workspace -- --fresh`: isolated seeded state, no credentials or reset; launcher waits for its own backend child. Focused9/9 (engine, actual CLI/HTTP restart, fresh launcher startup/collision), actual-app browser10/10, types/lint pass. Full gate and exact-head integration follow. Owner review canonical HTTPS URL and attachment verification are in private WLK280 notes; Page preview directives alone are not the delivery link.

Delivered [PR59](https://github.com/scwlkr/openjob/pull/59), merged `3e1663aea37b3fd6f33f7fec633014f1e65df33c`, from `codex/wlk-280-prototype-completeness` head `b7e71dedf3d6cf824858535cb99e4152cdbd0769`. WLK-280/281/282 Done: counted Mail folders and mailbox-aware subject/people/body search preserve unsaved input; Calendar Agenda/Day/Week, UTC date navigation/filtering and persisted edits; selected scoped agent Task creation shows allowed/denied/revoked results without human fallback. Module navigation waits for loaded data. Independent narrow review found no material issues.

Required npm test PASS on exact implementation tree `67ba9af61347aff34b70481cf36ffd860228e854` (equivalent local commit `0c4d9778dc1a305678942bc9154660be18022f77`): brand/build/types/contracts,272 native units,480 Node,131 existing+8 actual-app browser tests, secret490files. Merged tree matches. Log `/tmp/openjob-280-test.log`; focused browser8/8, captures `output/verification/wlk-280-workspace/`. Initial readiness failures were fixed before gate. This final handoff changes only w.md; source remains tested.

Prior integrated slices: PR55/WLK278 persistent shared Mail/Calendar/Tasks/Agents fixture app; PR57/WLK279 saved-draft editing and explicit Simulated Sent. PR53/54/56 resolved; WLK260/262/263/274/275/276/277/278/279 Done. Previous gate records remain in Linear. Historical pixel failures were retired under owner policy, not relabeled passes; functional responsive/theme/editor checks remain.

Run `npm run dev:workspace -- --port 5173`; [walkthrough](docs/WORKSPACE_DEMO.md). Preview restarted PID188149, session64196, log `/tmp/openjob-overnight-preview.log`; HTTP root and shared CLI snapshot succeeded. Loopback addresses are environment-local. No supported authenticated port-forward/share tool is exposed. Owner review Page and six-page PDF were delivered through ChatGPT Pages/Library; destination attachment authorization and readback passed. Local PDF layout inspected; Page viewer rendering unobserved. Private links stay in Linear, not this public repository. No hosting change/tunnel.

Next: [WLK-283](https://linear.app/wlkr-labs/issue/WLK-283), complete fixture Task title editing, unscheduling and deletion through shared contracts/API/CLI with linked Calendar consistency. No duplicate Markdown backlog.

All provider accounts/identities are simulated; real mail.send remains denied. No provider OAuth/sync, production workspace auth, offline conflicts or native workspace screens. Native quick checks do not prove devices/stores; ADR0017 release gates remain. Ordinary root/production Cloudflare configuration unchanged. Main has no rulesets/required check contexts/workflows; production release is documented as explicit release:publish. No deploy/release, real credentials/correspondence, hosting/security changes, spend or destructive live data operations. Human review precedes production release; no personal-computer fallback.

Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
