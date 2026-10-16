# OpenJob cloud handoff

Mission: [docs/MASTER_MISSION.md](docs/MASTER_MISSION.md). Sole queue: [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Cloud-only, one implementation writer; reuse existing parent assignment. Internal environment locator stays in private Linear notes.

Current [WLK-277](https://linear.app/wlkr-labs/issue/WLK-277): branch `codex/wlk-277-cli-table-fields`, based directly on main `3ed6a69dded2e762776d4109e3e5fbb1a4660c15`. GitHub PR records exact delivery head/tree. Default CLI tables previously selected only the first row's keys and silently omitted later Tasks' scheduled slots/due dates. The renderer now uses all returned object keys in first-seen order with blank missing values. JSON/JSONL unchanged; no API, auth, provider, brand or native changes.

Behavior proof: actual isolated CLI list regression fails before the fix and passes after it, covering later-only schedule/due values, alignment/escaping, private atomic file output, unchanged JSON/JSONL, single/empty results and only expected read requests. Root TypeScript and targeted lint pass. Independent read-only review found no material issues. Existing CLI suite initially passed52/53; package test hit an unavailable default npm cache. That failed package test then passed using the established writable cache, including its installed-artifact CLI suite. All53 affected CLI tests are accounted for; brand freshness passes. Logs `/tmp/openjob-277-{before,focused,cli,package,tsc,lint,brand,secret}.log`. No exact-head full npm test pass claimed.

Preserve [WLK-276](https://linear.app/wlkr-labs/issue/WLK-276), [draft PR #53](https://github.com/scwlkr/openjob/pull/53), branch `codex/wlk-276-agent-grant-cli`, head `a19d40c85c7d7149f611c7f8792fd096306082c1`. Reviewed CLI grant/private-delivery work plus privacy-safe actual-browser/baseline receipts remains blocked by the required visual gate. The same8685-pixel mismatch reproduces on untouched main with system Chromium154. Linux/Darwin baselines differ; PR52's Linux baseline exactly matches its implementation blob but contains no renderer metadata. Earlier gate passed272 native/461 Node/130 browser tests, one visual failed. Those results are historical, not this head's full-gate evidence.

Exact dependency remains official Linux x64 CFT149.0.7827.55 (Playwright1.61.1/revision1228) with provenance/SHA256, or trusted official Playwright1.61.1-noble linux/amd64 Docker-save bundle. Official CDN/storage/registry redirect are Forbidden; no supplied artifact found. Alternate npm Chromium149.0.7827.0 and no-hinting already failed; do not repeat unchanged attempts or replace snapshots. Evidence remains `output/verification/wlk-276-*` and prior Linear notes. After verified artifact delivery, run only the affected visual first, then required npm test if it passes; refresh exact-head/check/protection/non-deploy proof before any merge. WLK276/277 stay In Progress and their PRs draft until gates pass.

Node24.19.0/npm11.9.0 and existing locked dependencies retained; no reinstall. WStack0.2.0 matches live upstream; setup current. Use `npm_config_cache=/tmp/openjob-npm-cache` for npm child processes. Brand authority: [docs/brand/README.md](docs/brand/README.md). PR52's Android autolinking and iOS rnsvg-codegen/ExpoModulesJSI launch blockers remain; no native/device or real-provider behavior proved. Preserve ADR0017 native release gates.

Fixtures only; no real credentials/grants, correspondence, deployment/release, settings/security changes, spending or shared resets. No personal-computer fallback or duplicate schedule. Human review precedes production release.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
