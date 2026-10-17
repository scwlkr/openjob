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
