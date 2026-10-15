# OpenJob cloud handoff

Mission: [docs/MASTER_MISSION.md](docs/MASTER_MISSION.md). Sole queue: [Linear openjob / P-WLK-6](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Current: [WLK-274](https://linear.app/wlkr-labs/issue/WLK-274), [PR #51](https://github.com/scwlkr/openjob/pull/51), branch `codex/wlk-274-owner-agent-cli`; GitHub records final integration status/SHA. Base `38a99c2faf375783cae5ac4857884aecb495cc08` / PR #49. One implementation writer; independent review read-only.

Outcome: the selected human CLI profile can inspect its agent grants with `agent list` and revoke one with confirmed `agent revoke <agent-id>`. Reuses existing API, identity binding, table/JSON/JSONL/private output-file conventions. Invalid IDs, unsupported agent-token/Group options, missing confirmation and output conflicts fail before network. Foreign/failed/repeated revocations stay errors; transient failures do not replay DELETE. Successful revocation stops subsequent delegated reads. Issuance stays API-only; grant scope/security and human sessions are unchanged. CLI help/README document the flow.

Implementation: remote `acfb47ed0a77307d59a6d20ef3c194d9841c4ba2`, tree `7885ccd2391d8d147da778323b0d77e6aaa82360`, identical to local `fda0632`. Focused 41 tests pass, including actual CLI processes through grant API/fake Firestore, owner isolation, all output forms, no secret leakage and subsequent delegated 403. Root TypeScript and targeted ESLint pass. Independent review found no actionable findings. Required `npm test` passes: build/generated types, native lint/types, 271 native unit tests, 458 Node tests, 131 browser tests, secret scan (393 files). Final handoff changes only this file; source tree is unchanged from the full gate.

Capacity pause resolved: parent restored Linear capacity; WLK-274 was created normally, with acceptance before code. WLK-260/262/263 remain Done. Separate creative [WLK-272 / PR #50](https://github.com/scwlkr/openjob/pull/50) is not a product requirement: no brand assets or concepts adopted. FEATURES.md restored to base to avoid its shared file. Preserve brand handoff content if reconciling concurrent w.md changes; product code ownership does not overlap.

Environment: `ccarenv_b64_Y2NhcmVudl8yMTEwNGQ5NmMyMzA4MTkxOTMwODQzZTZmZTQwOTRmYw`, `/workspace/openjob`; access resumed successfully. Node 24.19.0/npm 11.9.0, inspected locked dependencies reused. Current upstream WStack skill matches local 0.2.0 (`c3e3ac6`); setup current. Git HTTP/gh unavailable; authorized GitHub connector publishes exact matching trees, no credentials created. Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`. Evidence `/tmp/openjob-274-focused.log`, `/tmp/openjob-274-test.log`, `/tmp/openjob-274-tsc.log`, `/tmp/openjob-274-lint.log`. System Chromium 154 substitutes for blocked pinned-browser CDN; default lane preserved.

Runner: reuse existing parent assignment `6ad111d940ec8191ac7303f2d37b5036` and this saved task/source `01a0f838-a174-70eb-a090-8bdce60620f1`; no new task/schedule or second writer. Parent reported a backend UNKNOWN resume did not start a turn. Actual implementation model/reasoning remains unexposed; reviewer requested Luna, actual selection metadata unverified.

Limits: native simulator/emulator/device, real provider auth and production behavior remain unverified. Fixtures only; no real grant/credential, deployment/release, settings change, spending, correspondence or shared reset. Next: PR #51 records final ordinary integration status/head. Next invocation reads live Linear/PR state before selecting the next scoped issue. Keep WLK-272 separate and preserve both handoffs when reconciling its PR #50; production release remains a separate human-reviewed action.

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
- PR [#50](https://github.com/scwlkr/openjob/pull/50). Layouts at 320/390/768/1440 px, both appearances, linked tasks, permission states, and offline concept controls inspected. Local font/images and standalone SVG/reference/license audit passed.
- Root lint/typecheck and full `npm test` pass: build, generated CLI types, native lint/typecheck, 271 native tests, 457 Node tests, 131 pinned-Chromium browser tests, and secret scan (574 files). macOS on-demand dependency reads caused slow startup. Log: `output/brand-npm-test.log`.
- The focused wrapper escalates root Wstack notes to release-candidate mode and rejects a feature branch. Its classifier/gates are unchanged; the required full suite runs directly. No native/device/release qualification is claimed.
- Local preview `http://127.0.0.1:4027` remains available for owner review. PR #50 records final integration status; the app’s brand adoption belongs to the overhaul. No production release or deployment performed.
