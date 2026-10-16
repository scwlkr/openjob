# OpenJob overnight prototype

Owner target: full working prototype by **7 AM Central**, rough edges accepted. [Mission](docs/MASTER_MISSION.md), [prototype policy](docs/PROTOTYPE_DELIVERY.md), sole queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Up to three bounded workers, one integration owner; reuse existing parent assignment. Cloud only; internal locator remains in private Linear notes.

Delivered [WLK-278 / PR55](https://github.com/scwlkr/openjob/pull/55), merged `4332a441c8da51976962ae8087b61eec8ae47b4f`, tree `27ed6aff22bc9a1937a28e6fc872d4744d40d712`. Persistent Mail/Calendar/Tasks/Agents prototype and shared API/CLI, including reviewed PR53/54 work. Those PRs are resolved; WLK276/277/278 Done. Required gate passed brand/build/types/contracts,272 native units,474 Node,133 browser tests, secret480files. Historical pixel failure was retired under explicit owner policy, not relabeled a pass. Functional theme/responsive/editor checks remain.

Delivered [PR57](https://github.com/scwlkr/openjob/pull/57) / [WLK-279](https://linear.app/wlkr-labs/issue/WLK-279), merged `4a87e2a844321ca7dbcec5f524e406c8f82ef7c2`, tree `97ff33c2c71412def7b445d71c612031f54451a4`. PR56 was superseded after stale head metadata; expected-head guard preserved. Reopen/edit drafts by ID with fixed sending mailbox; repeated reply saves update one draft. Explicit Simulate send consumes it into local Simulated Sent with correct From/To/body. Separate mailbox-scoped simulation+draft capabilities required; Sent reads need mail:read. Replay, wrong owner/resources and revoked grants fail atomically. Actual mail.send remains denied. Web/API/CLI share persisted JSON; no provider network implementation exists.

Focused checks: old+new engine10/10, actual CLI/HTTP restart workflow1/1, existing+new workspace browser3/3 pass. Actual app/router/proxy browser3/3 also passes; this lane is now in npm test, replacing duplicate component-only workspace checks. Phone uses prototype root entry; ordinary production root unchanged. Independent engine/scope review found no material issues. Required npm test PASSES on implementation `43c7fd4a9563790f7741ecc0841bbc18e6a1f090`, tree `b85f79ea2385364d3679f5226e7eb6a00fe59473` (local gate began at equivalent `ddcb0cd`): brand/build/root/native types+lint,272 native,480 Node,131 existing browser +3 actual-app browser tests, secret484files. Final handoff-only change does not alter source. Evidence `/tmp/openjob-279-{actual-browser,types,lint,test}.log`, output/verification/wlk-279-workspace/. Prior WLK278 evidence remains alongside.

Gate command: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`.

Run `npm run dev:workspace -- --port 5173`, open `/` or `/workspace` in this cloud environment. [Walkthrough](docs/WORKSPACE_DEMO.md). Local Node fixture mode uses empty Worker bindings; ordinary Cloudflare configuration unchanged. Persistence under ignored `.openjob/`; browser gates force isolated temp state. No real auth/providers/sync/sending, offline conflicts or native workspace implemented. Native quick checks do not prove devices/stores; keep ADR0017 release gates.

Cloud preview is running at `http://127.0.0.1:5173/` with persisted fixture state; log `/tmp/openjob-overnight-preview.log`. Latest receipt `/tmp/openjob-overnight-preview-receipt.json`, screenshot `output/verification/wlk-279-workspace/running-preview.png`. Next sole-queue item: [WLK-280](https://linear.app/wlkr-labs/issue/WLK-280), Mail folder/search navigation; no implementation started. Main integration status remains on GitHub. This handoff changes documentation only; tested source unchanged. Main has no rulesets/required check contexts or workflow directory; production deployment is documented as explicit release:publish. No deploy/release, live credentials, correspondence, settings/security changes, spending or destructive live data operations. Human review precedes production release. No personal-computer fallback or duplicate schedule.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
