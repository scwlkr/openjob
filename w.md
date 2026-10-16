# OpenJob cloud handoff

[Mission](docs/MASTER_MISSION.md), [prototype policy](docs/PROTOTYPE_DELIVERY.md), sole execution queue [Linear openjob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118). Cloud only; three bounded workers and one integration owner. Existing parent assignment unchanged, no schedule created. Private environment/owner artifact references are in Linear.

Delivered [WLK284 / PR63](https://github.com/scwlkr/openjob/pull/63): merge `5c3b71eb1283f9b3ca700023992d5e4539061a10`, source `c5843bfb3ceccc133db29668ee53e4f173b1f6e6`, tree `70f03e4298148ca8424342cfe6c96c55baa19347`. Normal app/CLI now use the existing Firebase verifier and user directory for private Tasks/Calendar backed by Firestore REST CAS and account-deletion fences. Linked Task/Calendar mutations stay atomic. Required npm test PASS:272 native units,504 Node,143 browser,secret517files; initial three contract failures fixed through real backend coverage and strict schemas. Independent review found no material issues.

Active [WLK285](https://linear.app/wlkr-labs/issue/WLK-285), branch `codex/wlk-285-scoped-personal-agents`: separate hashed personal credentials with explicit Task/Calendar scopes/resources,24-hour expiry, stable audit IDs, same-document revocation/write CAS and private0600 CLI delivery. Human API/list/revoke and application effective-access controls; no human fallback or agent administration. Focused store/API/CLI/browser checks pass; independent read-only review found no material issues. Integration owner runs required npm test before draft PR/publication; exact head/result will be persisted in Linear and this handoff. No actual grants issued. See [personal workspace guide](docs/PERSONAL_WORKSPACE.md).

Fixture milestone PR55/57/59/61 remains runnable with `npm run dev:workspace -- --fresh`: shared persistent API/CLI, synthetic Mail read→private Task→Calendar→complete→reply draft, editable drafts/Simulated Sent, module/folder/search/date navigation, Task/Calendar CRUD and scoped simulated agents. Fresh startup seeds separate Alex/Sam data without credentials and preserves prior demos. [Walkthrough](docs/WORKSPACE_DEMO.md). Previous preview was stopped for integration checks; do not assume its old PID is live. Node24.19.0/npm11.9.0 and locked dependencies are installed; no reinstall this cycle.

Private owner review Page holds the fixture six-page PDF plus authenticated progress/captures. Canonical HTTPS URL and destination-authorized attachment are in Linear. No supported owner-accessible port-forward/share tool is exposed; localhost remains environment-only. Page viewer rendering unobserved. No tunnel or hosting change.

Mission continues: Mail remains explicitly synthetic/read-only in the authenticated app; provider OAuth/sync, offline conflicts and native workspace screens remain unimplemented. OpenJob Personal Calendar is not a provider calendar. Signed synthetic identities/fake Firestore verify HTTP, CLI, persistence, owner isolation, denial, revocation and deletion; live OAuth/database behavior remains untested. Read-only database metadata check failed authentication; edition unverified. Grant expiry is checked before REST commit dispatch, not guaranteed against server commit-clock time. Bounded owner record900KB/100grants. Native units/types/lint do not prove devices; ADR0017 gates remain.

Next: finish WLK285 exact-head publication/ordinary nondeploying merge, then use Linear to select the next material master-mission slice. Provider-neutral capability/adapter contracts are useful only when tied to a concrete flow. No cosmetic filler or duplicate backlog. Main has no workflows/rulesets/required contexts; release is explicit release:publish. No deployment, real credentials/correspondence, auth/security/hosting changes, spending, shared-data reset or personal-computer fallback. Human review precedes production release.

Gate: `__UNSAFE_EXPO_HOME_DIRECTORY=/tmp/openjob-expo EXPO_NO_TELEMETRY=1 npm_config_cache=/tmp/openjob-npm-cache OPENJOB_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm test`. Current evidence: /tmp/openjob-284-test.log, /tmp/openjob-285-focused.log, /tmp/openjob-285-test.log, output/verification/wlk-284-personal-workspace/ and wlk-285-personal-agents/.

<!-- wstack:begin setup -->
Wstack: 0.2.0
Features: [FEATURES.md](FEATURES.md)
Terms: [CONTEXT.md](CONTEXT.md)
CLI: `npm run`; `node cli/openjob.mjs --help`
<!-- wstack:end setup -->
