# OpenJob cloud handoff

Mission: [docs/MASTER_MISSION.md](docs/MASTER_MISSION.md). Sole queue: [Linear openjob / P-WLK-6](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). First cycle: [WLK-260](https://linear.app/wlkr-labs/issue/WLK-260), [PR #47](https://github.com/scwlkr/openjob/pull/47), branch `codex/wlk-260-task-scheduling`; GitHub records integration status/SHA. One implementation writer; no schedule created.

Outcome: independent `scheduledSlot` start/end instants through API, Firestore, shared web client contract and CLI. Existing records need no migration. Null clears; omission preserves. Due dates, ordering, membership and done-Task rules remain independent. No mailbox links or external calendar writes. Owner mission moved unchanged to its single source; tracker pointers now use Linear.

Verified implementation commit: `c4956654ef715d4c7fe953d4bdc3683671834ac4`. `npm test` passes: build, generated types, native lint/type checks, 271 native unit tests, 452 Node tests, 128 browser tests, secret scan. Root TypeScript/ESLint and OpenAPI validation also pass. API/CLI fixtures prove UTC normalization, create/edit, restart/read/list persistence, independent due date, clear, validation, access denial and completed-Task protection. Final handoff commit changes only this file; focused API and secret checks verify that head. PR review found and fixed CLI typing, schema nullability and browser fixture time assumptions; no unresolved review threads.

Cloud setup: Linux, Node v24.19.0, npm 11.9.0. Root/native locked install succeeds, including inspected Sentry patch. WStack 0.2.0 at `/workspace/wstack` (`c3e3ac6`); Python setup ran. No WStack executable was present. `gh` API returns Forbidden. Git transport later lost authentication (`could not read Username`); use the working GitHub connector for remote updates/integration. Local and remote handoff commits may differ in identity/SHA; compare Git tree SHAs. Earlier pushes used the existing repository-local GitHub noreply identity after inherited private email was rejected.

Environment: `ccarenv_b64_Y2NhcmVudl8yMTEwNGQ5NmMyMzA4MTkxOTMwODQzZTZmZTQwOTRmYw`, `/workspace/openjob`. Install: `npm_config_cache=/tmp/openjob-npm-cache npm ci`. Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`. Browser CDN returns 403; this explicit lane uses installed Chromium 154 with all assertions. Default lane still downloads pinned Playwright Chromium. Linux screenshots were inspected; fixture time is explicit. Reusable logs: `/tmp/openjob-final-test.log`, `/tmp/openjob-focused.log`.

Limits: native simulator/emulator/device behavior, real provider auth, production health/costs and pinned-browser download are unverified. No deployment, release, shared reset, credential creation or real correspondence. README documents separate production `release:publish`; no repository CI workflow, main protection, ruleset or PR check/status was present. Preserve human review for production and native Release Proof.

Next: integrate PR #47 if still open, then resume [WLK-262](https://linear.app/wlkr-labs/issue/WLK-262) for web scheduling controls. Check live Git/Linear state first. Parent may arrange the requested recurring assignment after this proven cycle; this session creates no schedule.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
