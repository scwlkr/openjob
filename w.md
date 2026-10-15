# OpenJob cloud handoff

Mission: [docs/MASTER_MISSION.md](docs/MASTER_MISSION.md). Sole queue: [Linear openjob / P-WLK-6](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Current cycle: [WLK-263](https://linear.app/wlkr-labs/issue/WLK-263), [PR #49](https://github.com/scwlkr/openjob/pull/49), branch `codex/wlk-263-agent-task-read`. GitHub records final integration status/SHA. PR #48 / WLK-262 is complete; base `da5ec3dd4f5d8e1cb3305cb3d4de6a0f15c2d902`. One implementation writer; independent reviewer was read-only.

Outcome: human-only API issuance/list/revoke of a named 24-hour `tasks:read` agent grant for one Group. Separate opaque agent principal, hash-only persistence, current owner/membership-generation fences, recheck before data/304, no writes/admin/other Groups. Leaving/rejoining, expiry, revocation and owner deletion stop reads. Account deletion removes owned grants before identity finalization. Existing CLI list/show accepts explicit `--agent-token-file` plus `--group`, without human refresh/fallback. Owner management is API-only; Mail/Calendar scopes remain outside this slice. No mailbox links added.

Remote implementation: `b42fff4d52f5e5bab1c6db88a6afeea4ac7c465c`, tree `a13a0896de01b9ee08007f2c703dd8db4ca24bb4`, identical to locally tested `08bcc8b`. Focused fixtures pass, including actual API/CLI execution and signed Firebase identities in the complete backend journey. Independent review found help/discoverability and deletion-cleanup regression gaps; fixed and confirmed with no remaining findings. Initial full gate caught missing new-operation backend coverage; corrected fixture now covers success/error for every new operation. Full corrected `npm test` passes: build, generated types, native lint/types, 271 native unit tests, 457 Node tests, 131 browser tests and secret scan (393 files). Root TypeScript/targeted ESLint and diff checks pass. Final handoff changes only this file; the implementation tree remains identical to the full-gate source.

Runner: reuse parent-verified existing hourly assignment `6ad111d940ec8191ac7303f2d37b5036` (13:00 America/Chicago DTSTART 2026-10-15, hourly). Parent reported the 19:00 cloud-backend attempt failed before creating a task; this is its next retry. No schedule or second writer created, and no scheduled invocation observed by this task. Source thread `01a0f838-a174-70eb-a090-8bdce60620f1`. Actual selected model/reasoning is not exposed by runtime variables or reviewer metadata; remains unverified.

Environment: `ccarenv_b64_Y2NhcmVudl8yMTEwNGQ5NmMyMzA4MTkxOTMwODQzZTZmZTQwOTRmYw`, `/workspace/openjob`; Linux Node 24.19.0/npm 11.9.0. Reused inspected locked root/native dependencies and Sentry patch. WStack 0.2.0 `/workspace/wstack` (`c3e3ac6`), upstream skill SHA `d97eda56473ef107c4b6baf9801344a53117bfb4` current; Python setup current. Git HTTP/gh unavailable; authorized GitHub connector publishes matching Git trees without credentials. Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`. Evidence `/tmp/openjob-263-test.log`, `/tmp/openjob-263-focused.log`, `/tmp/openjob-263-backend.log`. System Chromium 154 used because browser CDN returns 403; default pinned-browser lane preserved.

Limits: native simulator/emulator/device, real provider auth, production health/costs and pinned-browser download unverified. All grants/keys/records used here are isolated fixtures. No production credential/grant, release/deploy, correspondence, shared reset or hosting/security change. README documents separate production `release:publish`; refresh protections/checks before ordinary merge and require human review before production release.

Next: GitHub PR #49 records final ordinary integration status/head; production release remains a separate human-reviewed action. On the next invocation inspect live Git/Linear and resume the sole execution queue, preserving this access boundary and native release gates; never create a duplicate schedule or writer.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->

## Local brand foundation · WLK-272

- Branch `codex/wlk-272-brand-foundation`. Identity source: `docs/brand/README.md`; local visual guide: `docs/brand/index.html`.
- Ten editable SVGs, local Inter 4.1 + OFL, original owner-supplied board, scoped light/dark CSS tokens. Geometry reconstructed; font is a documented match.
- Runtime branding remains legacy for later adoption. No deployment in this task.
- Desktop/tablet/phone layouts and local concept controls inspected. Final verification and repository delivery in progress.
