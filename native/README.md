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
```

`bundle:verify` produces independent minified iOS and Android embedded bundles
with all Geist/icon assets, verifies their hashes, and deletes its temporary
output. For an installed release smoke:

```sh
npm --prefix native run ios:release
npm --prefix native run android:release
```

After each release build launches, stop Metro, make networking unavailable,
terminate the app, and relaunch it. The branded shell must render from the
embedded bundle and make no remote update-manifest request. Restore networking,
rotate, background/foreground, and relaunch once more.

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
