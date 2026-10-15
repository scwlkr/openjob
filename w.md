# OpenJob cloud handoff

Mission: [docs/MASTER_MISSION.md](docs/MASTER_MISSION.md). Execution queue: [Linear openjob / P-WLK-6](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Current work: [WLK-260](https://linear.app/wlkr-labs/issue/WLK-260).

Branch: `codex/wlk-260-task-scheduling`. Commit: `git log -1`; draft PR pending. One implementation writer; no scheduled runner created.

Implemented independent `scheduledSlot` start/end instants through the shared API, Firestore adapter, shared client contract and CLI. Omitted slots preserve old records; null clears. No external calendar writes or mailbox links. Visual scheduling controls remain unimplemented.

Verified: Node v24.19.0 / npm 11.9.0; locked root/native install and Sentry patch succeed. Focused API/CLI checks: 38 pass, including UTC normalization, persisted restart/read/list, clear, preserved due date, invalid input, membership denial and completed-Task protection. Full gate reached 271 passing native unit tests and 452 passing Node tests, then the browser CDN returned 403. System Chromium 154 is available; explicit runner support and deterministic browser fixture time are under verification. TypeScript and OpenAPI checks pass. Native simulator/emulator/device behavior, provider auth and production health are untested.

Environment: `ccarenv_b64_Y2NhcmVudl8yMTEwNGQ5NmMyMzA4MTkxOTMwODQzZTZmZTQwOTRmYw`, `/workspace/openjob`, Linux. WStack 0.2.0 cloned at `/workspace/wstack`; setup ran. Installed npm cache: `/tmp/openjob-npm-cache`. No WStack executable was present; use its Python setup and current skill/guides. `gh` API returns Forbidden; Git transport and the GitHub connector work.

Commands: `npm_config_cache=/tmp/openjob-npm-cache npm ci`; `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`. Default browser lane still downloads Playwright's pinned Chromium. Cloud lane uses the installed version and all assertions.

Next: finish browser/full gate, review draft PR and exact head, then merge only if release safety and required checks permit. README says production deploy is a separate `release:publish`; no repository CI workflow, main protection or ruleset was found. Do not publish/deploy. Preserve native release gates. Record final evidence and delivery status in Linear before closing.

WStack pointers: [FEATURES.md](FEATURES.md), [CONTEXT.md](CONTEXT.md); `npm run`, `node cli/openjob.mjs --help`.
