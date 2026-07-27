# OpenJob native shell

The Expo client is one strict-TypeScript React Native application for iOS and
Android. It uses native-stack navigation with no tabs, carries the OpenJob
blue/paper/ink identity and Geist typography, and keeps `/api/v1` as its only
domain boundary. Google and Apple credentials resolve through the canonical
OpenJob User API; the client never reads Firestore or duplicates service
validation.

## Authentication and restoration

Google and Apple use their system provider SDKs. An unknown credential presents
an explicit Create User or Link existing User choice. Linking requires a fresh
credential from the second provider plus explicit confirmation; email is never
used to infer identity.

Only the Firebase refresh token and its provider are persisted in Expo
SecureStore. ID and provider access tokens remain in memory. Sign out, Switch
User, provider revocation, and an invalid refresh token clear the secure
credential and the reserved local domain-cache boundary. Offline restoration
keeps the credential and presents Retry instead of signing the User out.
A non-secret cleanup-pending tombstone is mirrored in AsyncStorage and
SecureStore so an interrupted purge is retried after relaunch; it contains no
credential, User, Group, or Task data.

## Encrypted read-only Task List cache

The last opened Group, Task List, membership snapshot, selected filter,
service ETag, freshness time, and canonical owner User ID are the only domain
state stored locally. One environment-isolated SQLCipher database lives under
the platform cache directory. Its random 32-byte key is generated per install
and kept in device-only SecureStore; neither the database nor key is eligible
for device backup. Task data is never written to AsyncStorage, logs, or a
second file path.

The owner binding is checked before cached content can paint. Missing keys,
wrong owners, malformed rows, and unavailable SQLCipher fail closed by purging
the database and key. Sign out, Switch User, credential revocation, and loss of
Group access use that same serialized purge boundary.

An owner-bound snapshot may paint before network restoration finishes. The
visible Task List then checks its opaque service ETag immediately, on
foreground, on pull-to-refresh, and on a visible 5/10/20/40/60-second backoff.
Polling stops while the screen is hidden or the app is inactive/backgrounded.
Offline state remains strictly read-only and shows
`Offline · Read-only · Last updated …` with Retry; no mutation controls are
rendered. Remote reconciliation uses stable Task IDs, retains unchanged row
objects and scroll position, animates only inserted/changed/removed rows, and
defers paint while drag or momentum scrolling is active.

## Install and run

From the repository root, `npm install` installs both the web/CLI and pinned
native dependency trees. Xcode and an Android SDK with an available emulator
must be installed. Build and install the development client once per runtime:

```sh
npm --prefix native run ios
npm --prefix native run android
```

Then one command starts the same Metro-served shell on the booted iOS Simulator
and Android Emulator:

```sh
npm run native:simulators
```

The command uses the development identity and opens both installed development
clients. Use `npm --prefix native run ios -- --device` or
`npm --prefix native run android -- --device` to choose a connected device.
Each local build cleanly regenerates its target native project for the selected
environment before compiling, so a prior preview or production build cannot
leak its application identity into a development client.

## Development and store-shaped builds

EAS uses the identity and file-secret boundary documented in
`docs/native-trust-and-distribution.md`. Run cloud builds only from a clean,
synced commit; EAS rejects dirty or untracked checkout content.

```sh
npm --prefix native run build:development:ios
npm --prefix native run build:development:android
npm --prefix native run build:preview
npm --prefix native run build:production
```

Development builds are internal development clients. Preview and production
are store builds; preview visibly carries the `Preview build` badge while
production has no environment badge. All profiles select their same-named EAS
environment, and no profile selects an update channel.

Store-shaped local Release builds use the same isolated configuration:

```sh
npm --prefix native run ios:preview
npm --prefix native run android:preview
npm --prefix native run ios:release
npm --prefix native run android:release
```

The preview commands regenerate with the preview identity before invoking
`--configuration Release` on iOS or `--variant release` on Android. The release
commands do the same with the production identity.

For physical development-client proof, open each EAS build link on its intended
registered device, install, launch, and record the build ID, commit, device/OS,
and result. The iOS and Android build must come from the same synced commit.

For release-candidate offline/freshness proof, install that exact commit from
TestFlight on iOS and Play Internal on Android, then use the shared resettable
QA fixture on both:

1. Online, open a Group Task List, choose a non-default filter, and record the
   visible Tasks and freshness time.
2. Make networking unavailable, terminate and relaunch. Confirm the saved
   Group, filter, and Task List paint immediately with
   `Offline · Read-only · Last updated …`, Retry, and no mutation control.
3. Restore networking and Retry. Confirm an unchanged list advances only the
   freshness time. Make one remote Task edit with the fixture's second User,
   then foreground and pull once; only that row should animate and scroll
   position should stay anchored.
4. While the Task List is visible, observe the capped freshness backoff. Hide
   the screen and background the app; confirm polling stops, then foreground
   and confirm one immediate check.
5. Sign out and sign in as the second fixture User. Confirm no first-User Group
   or Task paints before or after networking is disabled again.

## Appearance and lifecycle smoke

Run this matrix on both platforms:

1. Select System, Light, and Dark; relaunch after each and confirm restoration.
2. Toggle the system appearance while System is selected.
3. Rotate portrait/landscape and resize a tablet or foldable window.
4. Background and foreground the app without losing the current native-stack
   screen.
5. Enable Reduced Motion and confirm the shell remains stable with navigation
   transitions removed.
6. Check safe areas, text scaling, VoiceOver/TalkBack labels, focus order, and
   every 48-point settings control.

## Generated configuration and embedded bundles

The repository gate exports every public environment, performs clean temporary
iOS and Android prebuilds, and proves the Google callback scheme, Apple sign-in
entitlement, and Android protected-storage backup exclusions are generated. It
also proves OTA is disabled, launch checks are `NEVER`, the embedded update is
retained, and update URL/signing metadata is absent:

```sh
npm --prefix native run config:verify
npm --prefix native run bundle:verify
npm --prefix native run bundle:verify -- ios
npm --prefix native run bundle:verify -- android
```

`bundle:verify` produces independent minified iOS and Android embedded bundles
with all Geist/icon assets, verifies their hashes, and deletes its temporary
output. With no platform argument it verifies both; the impact-aware workflow
uses the platform arguments so a reusable result stays independent. For an
installed release smoke:

```sh
npm --prefix native run ios:release
npm --prefix native run android:release
```

After each release build launches, stop Metro, make networking unavailable,
terminate the app, and relaunch it. The branded shell must render from the
embedded bundle and make no remote update-manifest request. Restore networking,
rotate, background/foreground, and relaunch once more.

## Privacy and diagnostics

`config/release-privacy-inventory.json` is the only authored privacy and store
declaration authority. Its schema, generated native configuration, Play Data
Safety preparation, required URLs, permissions, processors, and submission
checklist are reviewed in
[`docs/generated/release-privacy.md`](../docs/generated/release-privacy.md).
Run `npm run privacy:check` before submission preparation; edit the inventory
and run `npm run privacy:generate` when behavior changes.

ADR 0013 defines the diagnostics behavior. Runtime and transport tests retain
the allowlist, scrubbing, opt-out, queue purge, and disabled-surveillance proof.
Exact dependency inventories, bundled SDK declarations, Play SDK Index entries,
and captured candidate traffic remain additive reconciliation evidence for #40
and #41; they cannot silently change the inventory.

Sentry build configuration comes only from the matching EAS environment:

- `EXPO_PUBLIC_SENTRY_DSN` supplies the client endpoint at build time. It is not
  committed even though a client DSN is not an authentication secret.
- `SENTRY_ORG` and `SENTRY_PROJECT` select the non-secret upload destination.
- `SENTRY_AUTH_TOKEN` is an EAS `Sensitive` variable used only by native symbol
  and source-map upload steps. Never pass it through Expo public config, commit
  it, or include it in build evidence.
- `OPENJOB_DIAGNOSTICS_VERIFICATION=1` exposes the guarded verification actions
  only in Preview and only when a DSN is present. Production always excludes
  those actions.
- `OPENJOB_DIAGNOSTICS_STARTUP_CRASH_VERIFICATION=1` additionally makes that
  guarded Preview build fail once, before diagnostics initialization or the app
  module render. Relaunch the same install to upload the iOS crash report. Clear
  app storage to repeat, then rebuild without the flag.

`native/metro.config.cjs` adds Debug IDs while excluding React Native replay
entrypoints from the JavaScript bundle. The Expo config plugin wires iOS dSYM
and JavaScript source-map upload plus Android
mapping/native-symbol and JavaScript source-map upload into release builds.
Local builds automatically skip uploads when no `SENTRY_AUTH_TOKEN` exists;
they are launch smoke only and never count as symbolication evidence.
Create the Preview build with `npm --prefix native run build:preview`, trigger
the guarded safe event on each platform, then confirm its release, distribution,
Debug IDs, stack symbolication, embedded-update context, OS, and coarse device
class in Sentry without copying its payload into public evidence.

OpenJob ships native changes through store builds only. OTA remains disabled;
the Sentry wiring does not add an update URL, runtime version, channel, signing
metadata, discovery, download, or apply path. A future signed-OTA project must
separately add and prove source-map handling under ADR 0012.

## Versioning and upgrades

The root `package.json` is the user-facing version authority. Release
preparation updates the native package and lockfile with the web, API, CLI, and
OpenAPI versions. EAS owns platform build numbers remotely; preview and
production auto-increment independently.

```sh
cd native
npx --yes eas-cli@21.1.0 build:version:get --platform all --profile preview
npx --yes eas-cli@21.1.0 build:version:get --platform all --profile production
```

Use `build:version:set` only to initialize or deliberately reconcile a profile,
then record the prior and next values. Install an older development/release
artifact, install the newer artifact over it, and repeat the bootstrap,
appearance, navigation-restoration, and offline embedded-bundle checks.

## Repository gate and secrets

```sh
npm --prefix native run lint
npm --prefix native run typecheck
npm --prefix native test
npm --prefix native run secret:check
npm run native:check
```

Firebase configuration files come only from same-named EAS environment file
secrets. Credentials, tokens, keystores, provisioning profiles, and provider
configuration files never belong in this directory or in build evidence.
Firebase API keys and provider client IDs in `config/native-identities.json`
are public identifiers, not service credentials.
