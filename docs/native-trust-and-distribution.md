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
`production` build profiles each select the same-named EAS environment and
update channel. Development builds use internal distribution. Preview and
production use store distribution.
All profiles use the recommended `appVersion` runtime policy so an update can
target only a compatible store version.

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
and are exported separately in the manifest. Apple Services IDs, associated
App IDs, and return URLs will join this table only after they exist on Apple
team `QP9SJRTA44`.

Apple App Store Connect and Google Play store records are not configured yet.
The preview App Store record must expose TestFlight for
`dev.openjob.app.preview`; the preview Play record must expose Internal Testing
for `dev.openjob.app.preview`. Their identifiers belong in
`config/native-identities.json` after account access is complete.

## Ownership and least privilege

OpenJob owns the Expo organization and EAS project. Human owner access remains
the recovery authority. Routine automation uses the `openjob-release` Expo
robot with Developer access; its token is stored in macOS Keychain under
service `dev.openjob.eas.robot-token`, account `openjob-release`. Rotate that
token by `2026-10-22`, or immediately after suspected disclosure.

The Apple developer team is `QP9SJRTA44`. App identifiers, Sign in with Apple
identifiers and keys, App Store records, and signing credentials must remain
owned by that team. Google Firebase and Play resources must remain in
OpenJob-controlled projects/accounts. Do not name personal account addresses
in repository configuration or issue evidence.

Update verification uses two independent RSA trust roots:

| Tier | Public key ID | Public certificate | Rotate by |
| --- | --- | --- | --- |
| non-production | `openjob-nonproduction-2026-07` | `native/trust/nonproduction-update-certificate.crt` | `2027-06-22` |
| production | `openjob-production-2026-07` | `native/trust/production-update-certificate.crt` | `2027-06-22` |

Only the public certificates are committed. Their private keys are macOS
Keychain items under service `dev.openjob.eas-update-signing`, accounts
`nonproduction-2026-07` and `production-2026-07`. The required independent
encrypted backup is not yet in Bitwarden because the owner vault is locked;
update-key recovery is incomplete until both restored keys match the committed
certificates. Signed EAS Update publishing also requires an Expo Production or
Enterprise plan; the OpenJob organization is currently on Free.

## Secret and recovery boundary

Approved stores are the provider account itself, the EAS environment secret
store, the OpenJob owner's macOS Keychain, and the owner-controlled Bitwarden
vault. Private keys, tokens, configuration files, keystores, provisioning
profiles, recovery codes, and passwords must never enter Git, GitHub, issue
comments, terminal diagnostics, screenshots, or build logs.

Owner recovery procedure:

1. Sign in to the provider as the OpenJob owner and confirm the public
   identifiers against `config/native-identities.json`.
2. For EAS automation, rotate or recreate `openjob-release`, then replace its
   Keychain item without printing the token. Verify access with `eas whoami`.
3. For update signing, restore the named encrypted Bitwarden backup directly
   into a mode-`0600` temporary file. Derive its public key locally and compare
   it with the committed certificate and SHA-256 fingerprint before
   publishing. Delete the temporary file after the operation. The Keychain
   copy is the routine source; the vault copy is the device-loss recovery.
4. For Firebase native configuration, download a fresh provider file and
   replace the matching EAS file secret. Never copy it into the repository.
5. For Apple or Android signing, recover through the Apple Developer/App Store
   Connect or the `@openjob/openjob` EAS credential surface. Download only into
   the ignored `native/credentials/` recovery area, validate fingerprints with
   `keytool`, move the backup to an approved owner-accessible secret store, and
   delete the scratch copy. Rotate the credential if provider recovery cannot
   prove continuity, then update public fingerprints and dates here.
6. Run `npm run secret:check` before staging or sharing diagnostics.

## Handoff to #36 and #37

#36 consumes `native/app.config.mjs`, `native/eas.json`, and the EAS
environment file secrets when it creates the Expo client. It must not invent
new bundle IDs, application IDs, channels, projects, or provider credentials.
Signed Update publishing must select the certificate and Keychain account for
the target trust tier.

#37 consumes the environment-specific Firebase app registrations and exported
OAuth client IDs. Non-production clients may use only `openjob-nonprod`;
production clients may use only `openjob-dev`. Apple provider setup must follow
the same boundary. Redirect handlers must use the environment-specific app
scheme exported by `native/app.config.mjs`.

## Human-only account gates

The agent can resume all remaining console work immediately after these owner
actions:

1. Apple: sign in once to Apple Developer and App Store Connect in the prepared
   browser, complete 2FA, and accept an agreement only if Apple presents one.
2. Google Play: choose the correct permanent developer account type and
   complete its identity, contact, and registration-payment flow.
3. Expo: upgrade the OpenJob organization to Production or Enterprise so EAS
   signed Update is available.
4. Bitwarden: open the installed desktop app and unlock the owner vault once.
   The agent will create the two encrypted update-key backup items and verify a
   restore without displaying their contents.

Issue #34 remains open until those gates are complete and the agent has created
and verified the Apple, TestFlight, Play Internal, provider, and signing
surfaces.
