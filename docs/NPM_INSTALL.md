# Install the packaged workspace

OpenJob's npm artifact contains the existing CLI, the actual built personal
workspace UI, brand/font assets, and its loopback synthetic API. Node 22.13+
is required. The existing authenticated CLI uses macOS Keychain; the local
workspace needs no login or provider credentials. This package is a usable
prototype: Alex/Sam identities, Mail and providers are clearly synthetic;
API state lasts only while the process runs. Browser storage is origin-local.
Real sending, live provider login and external calendar sync are unavailable.

## Run now from a source build

After installing the root locked build dependencies:

```sh
npm run app:pack
npm install --global --prefix /tmp/openjob-install ./dist/scwlkr-openjob-0.3.7.tgz
/tmp/openjob-install/bin/openjob app --port 5191
```

Open http://127.0.0.1:5191/workspace on the same computer. The installed command
works from any directory, without the checkout, Vite, TypeScript, Expo or
Firebase/Cloudflare access. Stop with Ctrl+C. Choose a fresh browser origin/port
after restarting if old synthetic identity bindings prevent cached work loading.

## Registry channels (pending authorized publication)

These commands are the intended public installation and manual upgrade paths
once npm ownership and publication are approved and configured:

```sh
npm install --global @scwlkr/openjob@latest
openjob app
openjob updates
# Stay on the development channel when manually upgrading it:
npm install --global @scwlkr/openjob@dev
```

Read-only registry inspection on 16 October 2026 found that public `openjob`
is maintained by `homy`, latest 1.0.11, with repository HomyeeKing/openjob. It
belongs to a different project. The full-app artifact therefore uses the proposed
`@scwlkr/openjob` name while retaining the `openjob` executable. That scoped name
returned 404; this does not establish ownership or reserve it. `npm whoami` on
this Mac returned ENEEDAUTH. No publication or credential setup occurred.
Do not use the scoped registry commands until scope rights and the initial
reviewed publication are confirmed. The local tarball is the verified path.

The artifact records its selected channel. Registry checks stay disabled while
package ownership is unverified (`registryVerified: false`); explicit checks
return `unavailable` with `registry_not_verified`, and no registry install is
recommended. Separately approved publication must enable this baked metadata
only after verifying the package identity. For verified distributions, automatic
checks use the recorded channel
at app startup and every six hours while running; interactive CLI invocations
also check. Notices go to stderr and print a manual upgrade command. JSON/stdout
results remain unchanged. `openjob updates` explicitly checks and prints JSON
with `current`, `update_available` or `unavailable`. Offline/errors stay quiet
during automatic checks. `OPENJOB_NO_UPDATE_CHECK=1` disables automatic checks.
Checks only fetch public npm dist-tags, with a 1.5-second timeout. They never
install, change channels, use account credentials or rewrite npm configuration.
Switch channels only by explicitly installing the other channel.

## Artifact mapping and publication blockers

`npm-artifacts.yml` builds downloadable tarballs after main pushes and published
stable releases; it does not publish to npm or deploy. `latest` requires an exact
stable `v<package-version>` tag and uses that release version. `dev` requires
exact main source and uses `<next-patch>-dev.<commit-Unix-time>.<12-char-SHA>`.
Both retain the full source SHA/ref/channel in `openjobDistribution`. The builder
requires a clean checkout, refuses ref/version mismatch and sets the matching
`publishConfig.tag`, preventing an accidental default `latest` dev upload.
Delayed main builds refuse a newer fetched origin/main instead of assigning an
old source to dev. Release artifacts remain bound to the published tag.

Remaining owner-approved setup: sign in to the intended existing npm account
and confirm its rights to the `@scwlkr` scope (or approve another owned scope);
approve the initial `@scwlkr/openjob` publication and choose npm authentication/trusted publishing; approve registry publishing CI,
serialization and stale-run protection; publish reviewed artifacts with explicit
matching tags; verify both live dist-tags and clean registry installations.
No credentials, trusted-publisher settings or production tags were configured.
Until that setup, public latest/dev do not automatically follow this repository.

Maintainer proof after building and clean-prefix installation:

```sh
node scripts/smoke-npm-app.mjs /tmp/openjob-install/bin/openjob
npm run test:distribution
```

The smoke creates/schedules/completes a synthetic Task through the packaged API,
checks separate owners and Host/Origin rejection, reads real static assets from
the tarball, and verifies signal shutdown. Device/native release acceptance and
live-provider behavior are separate gates.
