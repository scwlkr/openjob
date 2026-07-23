# Native trust and distribution

Issue #34 owns OpenJob's native account identities and trust chain. The
machine-readable source of truth is
`config/native-identities.json`; `native/app.config.mjs` and `native/eas.json`
consume it without embedding credentials.

## Environment mapping

`openjob-dev` is the existing production Firebase project despite its legacy
name. Development and preview share the separate `openjob-nonprod` Firebase
project, but use distinct native identifiers so a build cannot install over or
authenticate as another environment.

| Environment | Firebase project | iOS bundle ID | Android application ID | EAS channel ID |
| --- | --- | --- | --- | --- |
| development | `openjob-nonprod` | `dev.openjob.app.dev` | `dev.openjob.app.dev` | `019f8d18-f7da-7d12-81e5-fe25f5b6a8fa` |
| preview | `openjob-nonprod` | `dev.openjob.app.preview` | `dev.openjob.app.preview` | `019f8d18-fe02-75a8-83a5-19019cc78eef` |
| production | `openjob-dev` | `dev.openjob.app` | `dev.openjob.app` | `019f8d19-03b3-78b3-8919-62225bfb6cb1` |

The EAS project is `@openjob/openjob`, project ID
`5b1f6f4c-7cf1-4044-b10f-00449688ac1e`. Its `development`, `preview`, and
`production` build profiles each select the same-named EAS environment.
Development builds use internal distribution. Preview and production use store
distribution. OpenJob remains on Expo Free. OTA delivery is disabled in every
native environment, and preview/production releases use new store builds. The existing
same-named channels are dormant reservations and are not attached to builds;
they do not authorize unsigned publishing.

Firebase contains separate web, iOS, and Android app registrations for these
identifiers. Google web, iOS, and Android OAuth client IDs are exported in
`config/native-identities.json`. Each Android client is bound to its own
EAS-managed signing certificate in Firebase:

| Environment | Android OAuth client ID | EAS credential ID | SHA-1 |
| --- | --- | --- | --- |
| development | `550998178053-5681l7oet4q3rq0okoa2caqkv4bh324t.apps.googleusercontent.com` | `AVLdWoyXls` | `A9:CF:1E:47:DD:97:32:80:5A:22:36:82:41:08:6F:66:DB:EA:B3:0C` |
| preview | `550998178053-n1s9vp0cbmqubh5onint23j8415ivkoa.apps.googleusercontent.com` | `QHMuu9fTQ4` | `0B:95:B5:5A:5D:6B:BD:66:3A:12:37:B8:4D:0A:94:72:0A:04:7B:6F` |
| production | `1015996869029-qr0bkpihst84f8coibaotbtpjngicmjq.apps.googleusercontent.com` | `SkaVgGHtTd` | `AA:AA:E2:14:C1:28:97:03:AC:29:7A:19:40:E0:53:6A:63:C8:0B:68` |

The matching SHA-256 fingerprints are recorded in the manifest. Review each
Android credential for rotation by `2027-07-22`; preserve app-signing
continuity and rotate an upload key through the store's supported process.
Each EAS keystore and its password metadata has an independent, restore-verified
1Password document: `OpenJob Android Development Signing Recovery`,
`OpenJob Android Preview Signing Recovery`, or
`OpenJob Android Production Signing Recovery`. The restored keystore
fingerprints matched the manifest on `2026-07-23`; local recovery archives were
then deleted.
Firebase configuration files are EAS file secrets named
`GOOGLE_SERVICE_INFO_PLIST` and `GOOGLE_SERVICES_JSON` in each environment;
they are never repository files.

Provider routing is also environment-specific:

| Environment | App callback | Firebase handler | Google iOS redirect |
| --- | --- | --- | --- |
| development | `openjob-dev://auth/callback` | `https://openjob-nonprod.firebaseapp.com/__/auth/handler` | `com.googleusercontent.apps.550998178053-nek4ph7nn98c7f1r4vjo1jnvd11nvm4q:/oauthredirect` |
| preview | `openjob-preview://auth/callback` | `https://openjob-nonprod.firebaseapp.com/__/auth/handler` | `com.googleusercontent.apps.550998178053-5ruvfa2pemb5imm1ke195qrvftrsrm6j:/oauthredirect` |
| production | `openjob://auth/callback` | `https://openjob-dev.firebaseapp.com/__/auth/handler` | `com.googleusercontent.apps.1015996869029-tlko5334fhqiodcgebd5hncf41jh2f8m:/oauthredirect` |

The Google redirect schemes are derived from the registered iOS OAuth clients
and are exported separately in the manifest.

Apple team `QP9SJRTA44` has Sign in with Apple enabled on all three native App
IDs. Web authentication uses distinct Services IDs and Firebase callbacks:

| Tier | Services ID | Primary App ID | Domain | Return URL |
| --- | --- | --- | --- | --- |
| non-production | `dev.openjob.auth.nonprod` | `QP9SJRTA44.dev.openjob.app.preview` | `openjob-nonprod.firebaseapp.com` | `https://openjob-nonprod.firebaseapp.com/__/auth/handler` |
| production | `dev.openjob.auth` | `QP9SJRTA44.dev.openjob.app` | `openjob-dev.firebaseapp.com` | `https://openjob-dev.firebaseapp.com/__/auth/handler` |

Firebase Authentication has both Apple providers enabled with explicit bundle
allowlists. Non-production uses Apple key `F7H56WDP63` for
`dev.openjob.app.dev` and `dev.openjob.app.preview`; production uses the
independent key `N926UH3GCY` for `dev.openjob.app`. Review both keys for
rotation by `2027-07-23`. Their routine copies are macOS Keychain items under
service `dev.openjob.apple-signin-key`; independent 1Password documents
`OpenJob Apple Sign In Nonproduction F7H56WDP63` and
`OpenJob Apple Sign In Production N926UH3GCY` were restore-verified on
`2026-07-23`. The restored private keys derive the SHA-256 SPKI fingerprints
`a59fec3a5f44e0f552c9c1f79562f67587363b99acfe85d2393ffb6bd974e3ac`
and
`389d081a02196e4f40996b1d5f7713387d0910a2a98c3bc4a31e3e8a9a3e0e11`,
respectively; those non-secret values are the recovery comparison authority.

App Store Connect has both store records and exposes TestFlight:

| Environment | Listing name | App Store Connect ID | SKU | Bundle ID |
| --- | --- | --- | --- | --- |
| preview | `OpenJob Preview` | `6793947679` | `openjob-preview` | `dev.openjob.app.preview` |
| production | `OpenJob: Shared Tasks` | `6793948276` | `openjob` | `dev.openjob.app` |

Google Play developer account `6994653839033844694` is a Personal account
owned by the OpenJob owner. Its public developer name is `WLKR LABS`, its
verified public support email is `dev@wlkrlabs.com`, and its website is
`https://wlkrlabs.com`. The support address is not the private Google account
used to sign in. The approved one-time US$25 Play registration fee is paid; no
other Play, Expo, Apple, or recurring expense is authorized. Google currently
blocks app creation until its required identity, Android-device, and phone
checks finish. After those checks, create preview and production records and
expose Internal Testing for `dev.openjob.app.preview`.

## Ownership and least privilege

OpenJob owns the Expo organization and EAS project. Human owner access remains
the recovery authority. Routine automation uses the `openjob-release` Expo
robot with Developer access; its token is stored in macOS Keychain under
service `dev.openjob.eas.robot-token`, account `openjob-release`. Rotate that
token by `2026-10-22`, or immediately after suspected disclosure.

The active Apple developer team is `QP9SJRTA44`; the work used the existing
membership at zero new cost. App identifiers, Sign in with Apple
identifiers and keys, App Store records, and signing credentials must remain
owned by that team. Google Firebase and Play resources must remain in
OpenJob-controlled projects/accounts. Do not name personal account addresses
in repository configuration or issue evidence.

Expo Free does not provide signed EAS Update delivery. OpenJob does not accept
unsigned production updates, so `native/app.config.mjs` sets
`updates.enabled` to `false` and no update-signing keys are provisioned. This
follows ADR 0012's store-build fallback and avoids a recurring Expo
subscription. Enabling OTA later requires a separate owner-approved issue,
signed-delivery entitlement, new trust material, and a new store build.

## Secret and recovery boundary

Approved stores are the provider account itself, the EAS environment secret
store, the OpenJob owner's macOS Keychain, and the owner-controlled 1Password
vault. Private keys, tokens, configuration files, keystores, provisioning
profiles, recovery codes, and passwords must never enter Git, GitHub, issue
comments, terminal diagnostics, screenshots, or build logs.

Owner recovery procedure:

1. Sign in to the provider as the OpenJob owner and confirm the public
   identifiers against `config/native-identities.json`.
2. For EAS automation, rotate or recreate `openjob-release`, then replace its
   Keychain item without printing the token. Verify access with `eas whoami`.
3. For Firebase native configuration, download a fresh provider file and
   replace the matching EAS file secret. Never copy it into the repository.
4. For Apple Sign in, restore the tier's named 1Password document to a
   mode-`0600` temporary file. Derive its public key and compare it with the
   matching `publicKeySpkiSha256` value in the manifest before use. Delete the
   temporary file.
5. For Android signing, recover through the `@openjob/openjob` EAS credential
   surface or the environment's named 1Password document. Restore
   `credentials.json` and the keystore only into a mode-`0700` temporary
   directory with mode-`0600` files, validate the SHA-256 fingerprint with
   `keytool`, then delete the directory. Rotate only through the
   store-supported upload-key process if neither recovery source proves
   continuity.
6. Run `npm run secret:check` before staging or sharing diagnostics.

## Handoff to #36 and #37

#36 consumes `native/app.config.mjs`, `native/eas.json`, and the EAS
environment file secrets when it creates the Expo client. It must not invent
new bundle IDs, application IDs, channels, projects, or provider credentials.
It must preserve `updates.enabled: false`; JavaScript, asset, and native changes
ship through store builds, not `eas update`.

#37 consumes the environment-specific Firebase app registrations and exported
OAuth client IDs. Non-production clients may use only `openjob-nonprod`;
production clients may use only `openjob-dev`. Apple provider setup must follow
the same boundary. Redirect handlers must use the environment-specific app
scheme exported by `native/app.config.mjs`.

## Human-only account gates

Google Play is the remaining account gate. The owner must use Play Console's
three visible checks: upload the requested official identity document, sign in
to the Play Console mobile app on a physical Android device, and verify the
contact phone number after Google approves the identity. App creation stays
locked until Google clears those checks.

Issue #34 remains open until Play permits creation of the preview/production
records and Internal Testing is confirmed. No further purchase is required or
authorized.
