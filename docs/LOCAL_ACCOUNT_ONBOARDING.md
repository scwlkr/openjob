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

Google/Apple provider enabled/name metadata reads returned403 (`SERVICE_DISABLED`
for Identity Toolkit on the existing CLI quota consumer, which matches none of
the source app projects). This does not establish the nonproduction provider
state. Google/Apple are **unverified**, not known disabled. Do not enable an API
on an unrelated project to work around this metadata read. The public client IDs/Apple service ID already
exist in the repository; no client-secret generation is implied. Existing signed-in
CLI availability is not proof of permission to inspect every Auth setting.

## One bundled owner-assisted setup step

Before local real sign-in: approve reuse of the existing nonproduction operator
reference for this pilot process, and approve adding only `127.0.0.1` to
`openjob-nonprod` authorized domains. Confirm Google is already enabled in that
project's Authentication providers page; if not, treat enabling it as a separate
explicit change. No Gmail/Mail scopes or mailbox connection are needed to sign in.

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
