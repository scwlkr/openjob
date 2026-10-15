# OpenJob cloud handoff

Mission: [docs/MASTER_MISSION.md](docs/MASTER_MISSION.md). Sole queue: [Linear openjob / P-WLK-6](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Current cycle: [WLK-262](https://linear.app/wlkr-labs/issue/WLK-262), [PR #48](https://github.com/scwlkr/openjob/pull/48), branch `codex/wlk-262-web-scheduling`; GitHub records integration status/SHA. Sole implementation writer is this existing cloud task; independent review was read-only.

Outcome: web controls create/edit/clear planned start/end in explicit UTC; Task cards display the interval and expose it as an accessible description. Due dates stay independent. Shared API validation, legacy-draft second/millisecond precision, and input through validation/network/auth recovery are preserved. Completed Tasks remain read-only until reopened. No provider calendar writes or mailbox links.

Verified remote implementation: `41f4f6ebff8ec5f2d62cc0b434e6b209b268acdd`, tree `f8e7128699e6827dddbe21a014e9e1d1d3122eb4` (identical to locally tested `ce7a20a`). `npm test` passes: build, generated types, native lint/type checks, 271 native unit tests, 452 Node tests, 131 browser tests, secret scan. Root TypeScript/ESLint pass. UI inspected at 390/800/1440px. Independent review found one accessible-description gap; fixed, asserted, reviewer confirmed resolved. A geometry check now waits for the entrance animation before retaining its 44px assertion. Final handoff changes only this file; focused API and secret checks verify that identical source tree.

Runner: parent-verified enabled hourly assignment `6ad111d940ec8191ac7303f2d37b5036`, DTSTART 2026-10-15 13:00 America/Chicago, FREQ=HOURLY. No scheduled invocation has been observed in this task. Reuse this saved environment, delegated from source thread `01a0f838-a174-70eb-a090-8bdce60620f1`; hourly triggers observe/resume the existing task, never create a second implementation writer or duplicate schedule. Actual selected model/reasoning was not exposed by checked runtime variables or reviewer metadata; requested values are not proof.

Runtime: Linux Node v24.19.0/npm 11.9.0; locked root/native dependencies and inspected Sentry patch reused. WStack 0.2.0 at `/workspace/wstack` (`c3e3ac6`); current upstream skill checked, Python setup current. Git HTTP auth and `gh` are unavailable; authorized GitHub connector handles remote updates without creating/extracting credentials. Compare Git tree hashes when connector commit metadata differs.

Environment: `ccarenv_b64_Y2NhcmVudl8yMTEwNGQ5NmMyMzA4MTkxOTMwODQzZTZmZTQwOTRmYw`, `/workspace/openjob`. Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`. System Chromium 154 is used because the browser CDN returns 403; default pinned-browser lane remains. Evidence: `/tmp/openjob-262-final-test.log`; screenshots under `output/playwright/test-results/` named `planned-work-390.png`, `planned-work-800.png`, `planned-work-1440.png`.

Limits: native simulator/emulator/device, real provider auth, production health/costs and pinned-browser download remain unverified. No deployment, release, shared reset, credential creation or correspondence. README documents separate production `release:publish`; refresh protection/check records before ordinary merge and retain human review before production.

Next: integrate PR #48 if still open, then resume [WLK-263](https://linear.app/wlkr-labs/issue/WLK-263) for revocable read-only agent access to one Task Group. Inspect live Git/Linear and existing task status first; one writer only.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
