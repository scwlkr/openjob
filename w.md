# OpenJob cloud handoff

Mission: [docs/MASTER_MISSION.md](docs/MASTER_MISSION.md). Sole queue: [Linear openjob / P-WLK-6](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Active: [WLK-262](https://linear.app/wlkr-labs/issue/WLK-262), branch `codex/wlk-262-web-scheduling`, sole implementation writer in this saved cloud task. No competing writer or open PR was found at start.

Current outcome: web editor controls for planned start/end in explicit UTC, separate from due dates, plus Task-list visibility. Uses the existing API and its shared validator; no provider calendar writes or mailbox links. Focused proof passes for phone/desktop create/edit/clear, validation/network preservation, done/reopen, accessible description, auth recovery and legacy-draft millisecond preservation. Independent review found an accessible-description gap; fixed and reviewer confirmed no remaining actionable findings. Root type/lint checks pass; `npm test` is the remaining delivery gate. Previous [WLK-260 / PR #47](https://github.com/scwlkr/openjob/pull/47) is merged at `b61932ca1ecdee2a9b2b24c41b1f290f486d69e2`; full gate passed (271 native, 452 Node, 128 browser tests).

Runner: parent-verified enabled hourly assignment `6ad111d940ec8191ac7303f2d37b5036`, DTSTART 2026-10-15 13:00 America/Chicago, FREQ=HOURLY. First scheduled execution is not yet observed. Reuse this existing saved cloud task/environment (below), delegated from source thread `01a0f838-a174-70eb-a090-8bdce60620f1`; hourly triggers observe/resume it and must not start a second implementation writer. Do not create another schedule. Actual selected model/reasoning was not exposed by checked runtime variables; requested settings are not proof.

Cloud setup: Linux, Node v24.19.0, npm 11.9.0. Root/native locked install succeeds, including inspected Sentry patch. WStack 0.2.0 at `/workspace/wstack` (`c3e3ac6`); Python setup ran. No WStack executable was present. `gh` API returns Forbidden. Git transport later lost authentication (`could not read Username`); use the working GitHub connector for remote updates/integration. Local and remote handoff commits may differ in identity/SHA; compare Git tree SHAs. Earlier pushes used the existing repository-local GitHub noreply identity after inherited private email was rejected.

Environment: `ccarenv_b64_Y2NhcmVudl8yMTEwNGQ5NmMyMzA4MTkxOTMwODQzZTZmZTQwOTRmYw`, `/workspace/openjob`. Install: `npm_config_cache=/tmp/openjob-npm-cache npm ci`. Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`. Browser CDN returns 403; this explicit lane uses installed Chromium 154 with all assertions. Default lane still downloads pinned Playwright Chromium. Linux screenshots were inspected; fixture time is explicit. Reusable logs: `/tmp/openjob-final-test.log`, `/tmp/openjob-focused.log`.

Limits: native simulator/emulator/device behavior, real provider auth, production health/costs and pinned-browser download are unverified. No deployment, release, shared reset, credential creation or real correspondence. README documents separate production `release:publish`; no repository CI workflow, main protection, ruleset or PR check/status was present. Preserve human review for production and native Release Proof.

Next: finish WLK-262 focused proof, independent review, required gate and exact-head integration; resume this branch before starting other work. Keep queue/status in Linear.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
