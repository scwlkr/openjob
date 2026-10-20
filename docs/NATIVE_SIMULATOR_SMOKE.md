# Isolated native simulator smoke

`native/simulator-smoke.tsx` is a separate fixture entry. Normal `native/index.ts`
and authentication do not import it. It requires a simulator and the
`dev.openjob.app.dev` identity; physical devices, preview and production identities
are rejected before requesting a fixture session. Its banner identifies invented data and the local
service. The synthetic session stays in memory and all requests use loopback5213.

Use the existing `scripts/personal-workspace-test-server.mjs --test-only` API on
port5213 with a fresh dedicated state file. It uses a fake identity authority and
fake Firestore; it never contacts Firebase or mail providers. Native components and
API validation remain real. This proves fixture UI/HTTP behavior, not live sign-in,
SQLCipher storage, provider operation or physical-device acceptance.

`native/simulator-connected-smoke.tsx` is the separate R53 connected-Workspace
entry. It has the same development simulator/device guard and memory-only fixture
session. Use `npm run dev:owned-workspaces -- --port 5213 --state-file
<fresh-dedicated-file> --google-fixture` for its invented Google protocol
composition. iOS uses `127.0.0.1:5213`; the Android emulator uses its host-loopback
alias `10.0.2.2:5213`. Normal native authentication and the original Personal
fixture do not import this entry. Source messages are fetched on demand; only
authored OpenJob work is persisted in the dedicated local fixture file.

Connected journey: open the retained Personal context, open configured Mail,
explicitly read the invented message, review its Task title and create/find the
source Task. Save notes, schedule it, open its Calendar block and return to the
exact Task. Complete the Task, open its fresh source, prepare Reply/Reply all,
review From/To/Cc/subject and save an authored OpenJob draft. Switch modules with
unfinished text and reopen saved work after restarting the app. Disconnect then
verify source/draft access denial while the Task and block remain. Independent
owner Workspace creation/opening and foreign-owner denial are separate checks.
This composition has no provider Calendar or sending. Native consent remains in
the existing Connections app; the fixture does not prove real native login,
provider consent, device encryption or release acceptance.

Before a heavy phase, coordinate the shared Mac lane and reserve headroom with
Build Space. Use a fresh exact Git source snapshot under `/tmp`, outside synchronized
Desktop/Documents paths. Install `native` dependencies with `npm ci` from the
unchanged lockfile and the configured registry, retaining the existing patch.
Generate the development iOS project and run CocoaPods without updating repositories.
Verify locked Pod entries are unchanged. Preserve previous/shared data.

For an owned simulator, build `OpenJobDev.xcworkspace`, scheme `OpenJobDev`, with
Release configuration to embed JavaScript without Metro. For a focused local smoke,
set ONLY_ACTIVE_ARCH=YES and the host simulator architecture to avoid compiling an
unneeded second simulator architecture. Select the development
identity, disable simulator signing and Sentry upload, limit jobs, use isolated
DerivedData and set `ENTRY_FILE` to the snapshot's `native/simulator-smoke.tsx`.
Release configuration here does not select a production identity or distribution.
Only install/launch on the owned simulator after a successful compile.

For the connected Android fixture, use a separate owned AVD and the development
debug variant with its existing debug-networking configuration. In the isolated
proof copy only, select `simulator-connected-smoke.tsx` as `native/package.json`
`main`; record that fixture input and preserve the real checkout's `index.ts`.
Generate the Android project with the existing development prebuild command.
Build `:app:assembleDebug` with at most two workers, no Gradle parallelism and the
emulator's `arm64-v8a` architecture. Keep Sentry upload disabled. The debug runner
uses Metro; it is separate from the embedded iOS fixture artifact and any release
candidate.

Start Metro from that proof copy with `EXPO_OFFLINE=1`,
`NODE_OPTIONS=--dns-result-order=ipv4first`, `OPENJOB_NATIVE_ENV=development` and
`npm run start -- --port 8088 --host localhost --max-workers 2`. Confirm its listener
is loopback-only. The `--offline` CLI flag cannot be combined with `--host` in this
locked Expo version; use the offline environment variable. The owned emulator
reaches the local manifest through `http://10.0.2.2:8088`; its manifest selects the
committed connected fixture entry and the `dev.openjob.app.dev` identity. Use a
fresh dedicated service state for Android, preserve the iOS receipt, and record
actual UI results separately from build/manifest preparation.

Short smoke: Today → Mail → invented message → private Task → edit/save notes →
schedule → Calendar → exact Task → source Mail → save reply draft. Reopen the app
and verify saved work through the local fixture API. Keep actual UI screenshots,
exact build source/hash/result and remaining gaps in Linear and w.md. Shut down
only the owned simulator and release the reservation with the real outcome.

WLK323 identified two local setup failures: duplicate-suffixed spec files in a
reused shared dependency tree, then FinderInfo metadata on a generated framework
inside Documents. Fresh locked dependencies resolve the first; an outside-sync
build location addresses the second. Do not delete or repair shared dependencies
or weaken signing/security settings to hide either failure.
