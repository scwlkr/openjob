# Approved local setup — 17 October 2026, 12:57 UTC

Shane answered the exact checklist, relayed by parent01a0f838:
- First read-only mailbox: `shane.caleb.walker@gmail.com` (selection, not a completed grant).
- Approved the pending DevTools access for `127.0.0.1:5202`, through its supported
  approval path only. No blanket browser access or retroactive PR99 qualification.
- Approved adding only `127.0.0.1` to existing `openjob-nonprod` Auth authorized
  domains and reusing its existing service-account credential for this local pilot.

These decisions supersede the historical “approval pending” wording below; actual
execution/readback is still pending. No new project/key/client, role, other origin,
production deployment, npm or TestFlight authority follows. Send and Calendar
writes remain disabled. Mail sign-in and Gmail consent stay separate.

Resume blocker in this session: callable browser/DevTools tools and their approval
operation are absent from the tool catalog; installed plugin files do not expose
that capability. No alternate browser/port/controller was used. `op` CLI and the
existing document title are available, but no document/key was retrieved or entered
while browser proof cannot proceed. Reuse the documented short-lived in-memory
operator launcher; hand off securely before any sensitive entry/transmission,
never put credentials into chat, logs or committed files.

Smallest handoff: restore the supported DevTools tool for the approved5202 request
in this task, then perform the two already-approved setup actions and read them
back; real sign-in and useful PR95/100/101 UI proof take priority. Do not ask Shane
to approve the same checklist again. If sensitive user entry is required, pause
for the secure entry surface. Domain change, operator suitability, real sign-in
and all changed UI remain UNVERIFIED; no launcher/settings action occurred here.

Gmail consent preparation, once existing client/callback and approved credential
runtime are verified: select the exact mailbox above, request Mail read-only
`gmail.readonly` with the existing identity-validation scopes, verify upstream
subject/address and bind its chosen resource home. No consent URL is ready yet:
actual suitable existing client/callback/runtime is unverified, and selection does
not authorize creating one or broadening scopes. No send or Calendar-write scope.

PatriBible coordinator acknowledged no resource conflict: Search is a bounded
read-only SSH diagnosis; neither task has browser control/heavy builds in flight.
Existing sessions/state and all three draft PRs remain preserved.

---

# Local account onboarding: exact remaining gates

Metadata inspected16October2026 after PR88. No Firebase private key or provider
secret was retrieved or transferred. Existing CLI authentication was used only for
metadata GETs; no token values were logged. No project/provider/access settings changed.

## Already available

- `config/native-identities.json` contains the nonsecret nonproduction browser
  project, API key, web App ID and auth domain. Development/preview both select
  `openjob-nonprod`; production selects `openjob-dev`. Do not mix them or use the
  stale `.firebaserc` default as the pilot target.
- `config/web-firebase-config.mjs` already maps these four browser fields. The
  portable service currently accepts them through environment bindings; missing
  bindings do not mean missing Firebase apps or a need to create one.
- A read-only preview Worker secret-name listing confirms existing
  `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` bindings. The API lists names,
  not values; it does not make them readable or authorize their transfer.
- `docs/qa-fixture.md` names the existing **OpenJob Preview QA Fixture Operator**
  1Password document: a dedicated nonproduction service account documented with
  `roles/datastore.user`. Its key was not retrieved; current key validity and
  suitability for this pilot are unverified. No new key is justified yet.

## Verified local origin gap

The Firebase browser SDK's public project-config GET returned only project ID
and authorized domains. For `openjob-nonprod` these are:

- `openjob-nonprod.firebaseapp.com`
- `openjob-nonprod.web.app`
- `openjob-preview.walkerworlddiscord.workers.dev`

Neither `127.0.0.1` nor `localhost` is authorized. The portable service defaults to
`http://127.0.0.1:5192`; approving that local browser sign-in requires adding the
exact hostname **127.0.0.1**, without protocol/port, in this nonproduction project.
Do not add production/public origins or change provider consent/scopes implicitly.

A later read-only lookup in the existing authorized in-app browser resolved provider
status: the exact `openjob-nonprod` Authentication → Sign-in method page, Default
tenant, visibly lists **Google Enabled** and **Apple Enabled**. No provider editor
was opened or setting changed; the lookup tab was closed. The earlier API403
(`SERVICE_DISABLED` on an unrelated CLI quota consumer) did not reflect provider
state and does not justify enabling unrelated APIs/IAM. Enabled alone does not
prove local OAuth redirect or actual sign-in. Existing public client/Apple service
IDs are already in the repository; no secret/client generation is implied.

## One bundled owner-assisted setup step

Before local real sign-in: approve reuse of the existing nonproduction operator
reference for this pilot process, and approve adding only `127.0.0.1` to
`openjob-nonprod` authorized domains. Google is already enabled on the existing default tenant; no provider-enable
change is requested. No Gmail/Mail scopes or mailbox connection are needed to sign in.

Then map existing public settings and the approved operator's client email/key
inside a short-lived launcher process, start the local service, and discard secret
values on exit. No secret arguments, committed env file, logs or exported long-lived
shell session. Verify sign-in → explicit existing/new User choice → username if
needed → create a personal Task/block. This actual sign-in/write proof is pending.
Do not reset QA data, create another Firebase project/key, rotate credentials or
increase roles as a workaround. Shane can perform the domain/provider readback
himself if current operator metadata access is insufficient.

Existing npm EOTP/authentication handoff is independent. Candidate0.3.9 is still
unpublished and has no publication approval. A rented server is not a prerequisite
for the local workflow or further credential-independent app work.
