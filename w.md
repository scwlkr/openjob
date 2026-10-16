# OpenJob cloud handoff

[Mission](docs/MASTER_MISSION.md), [prototype policy](docs/PROTOTYPE_DELIVERY.md), sole queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Overnight target: connected working fixture prototype by 7 AM Central; rough edges accepted. Cloud only, up to three bounded file owners and one integration owner. Parent assignment unchanged; no schedule created. Private environment and owner artifact references are in WLK-283/280.

Delivered [WLK-283 / PR61](https://github.com/scwlkr/openjob/pull/61), merged `a8ffd4576a11873ef29e34c3fa0979ef693be8eb`, from `codex/wlk-283-personal-task-controls` head `8d2ee047e5aab95d16dedb0bd60dc2b76bc1ff2c`. Personal Tasks can be renamed, rescheduled, unscheduled and deleted with confirmation. Linked blocks stay consistent; source Mail remains. Linked mutations require both Personal tasks and Calendar write access; denial is atomic. Schedule prefills its existing slot/calendar, with current UTC-day defaults for new plans.

`npm run dev:workspace -- --fresh` starts app+API and seeds separate Alex/Sam fixtures without login, provider/Firebase/Cloudflare credentials, secrets or another seed step. It creates a new temp state file and preserves prior demos. Omit --fresh for the persistent default. Startup waits for its own backend child; an occupied backend fails instead of reusing another service. Exact instructions: [walkthrough](docs/WORKSPACE_DEMO.md). Node24.19.0/npm11.9.0 and locked dependencies are installed here; no reinstall performed.

Required npm test PASS on exact merged implementation tree `a86c25b0e907996b1f042635d8d7acb8ae98aa93` (equivalent local `07b0cde807cdf496937e8768b0d7b14b53a7b5f6`): brand/build/types/contracts,272 native units,489 Node,131 existing+10 actual-app browser,secret496files. Focused engine/CLI/startup9/9, browser10/10; independent review no material findings. React hooks/state/labelled controls reviewed. Evidence `/tmp/openjob-283-{test,focused,startup}.log`, output/verification/wlk-283-workspace/. This handoff changes only w.md; tested source remains unchanged.

Acceptance demonstrated: Mail read→private Task→Calendar schedule→completion→reply draft under correct account; draft editing and explicit Simulated Sent; module/folder/search/date navigation; Task/Calendar CRUD; scoped agent allowed/denied/revoked actions; separate owners; shared API/CLI persistence and restart. WLK-283 and prior queued slices are complete. Prior deliveries PR55/57/59: persistent workspace, saved drafts/Simulated Sent, Mail/Calendar/agent controls. Historical pixel failures were retired under owner policy, never relabeled passes; functional responsive/theme/editor checks remain.

Owner review Page with refreshed six-page PDF is delivered privately through ChatGPT Pages/Library. Canonical HTTPS URL, stable Library identity/version and destination-authorized attachment are in Linear. PDF readback confirms Task captures, seeded startup and limits; local layout inspected. Page viewer rendering unobserved. No supported authenticated cloud port-forward/share tool is exposed; localhost is environment-only. No hosting change or tunnel. Preview retained: PID207386, session12258; log /tmp/openjob-overnight-preview.log; receipt /tmp/openjob-283-preview-receipt.json. Fresh Alex3mailboxes/3messages/1Task/2Calendars and separate Sam fixtures verified via shared CLI; HTTP app succeeds.

Next action: owner reviews the private walkthrough and fixture acceptance. Live provider OAuth/sync, production workspace auth, offline conflicts and native workspace screens remain future scoped work. All current provider accounts/identities are simulated; real mail.send stays denied. Native units/types/lint do not prove devices/stores; ADR0017 gates remain. Ordinary root/Cloudflare production configuration unchanged. Main has no rulesets/required check contexts/workflows; release is documented as explicit release:publish. No deploy/release, real credentials/correspondence, security/hosting change, spend or destructive shared data operation. Human review precedes production release; no personal-computer fallback.

Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
