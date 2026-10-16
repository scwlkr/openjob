# Install the packaged workspace

OpenJob's npm artifact contains the existing CLI, the actual built personal
workspace UI, brand/font assets, and its loopback synthetic API. Node 22.13+
is required. The existing authenticated CLI uses macOS Keychain; the local
workspace needs no login or provider credentials. This package is a usable
prototype: Alex/Sam identities, Mail and providers are clearly synthetic;
API state is temporary by default; an explicit state file keeps saved work.
Browser storage is origin-local.
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

## Keep saved work across restarts

```sh
openjob app --port 5191 --state-file "$HOME/.openjob-local/workspace.json"
```

The same synthetic owners, saved Tasks, linked Calendar, invented Mail, saved
reply drafts, agent grant hashes/revocations and sync receipts survive quitting.
Signing keys and human session tokens are regenerated. Unsaved browser editor
text and mock provider connection changes are not part of this file. The app
labels saved versus temporary mode. Saved JSON is private (0600), bounded and
**unencrypted**; use invented data only. Keep your own backups.

One process owns each state file. A second writer, invalid/unsupported file or
symlink fails without resetting it. A successful mutation is acknowledged after
an atomic disk save; a failed save preserves previous work. Uncertain durability
pauses access until restart. Clean Ctrl+C releases the lock, including during
startup. After a crash, stop the old process and copy the saved JSON to a fresh
path, then pass that path; leave the original file and lock for inspection.
Do not blindly remove locks or overwrite saved work.

## Registry channels

The initial approved `@scwlkr/openjob` versions are published and clean-prefix
registry installs have been verified. They contain WLK-303's runnable full
prototype, but **do not include** the later saved-state or find-time features.
Use a local build of current main for those features until a reviewed update is
separately published.

```sh
npm install --global @scwlkr/openjob@0.3.7
openjob app
openjob updates
# Development-channel initial artifact:
npm install --global @scwlkr/openjob@dev
```

At the16 October13:27 UTC verification, public `latest` correctly resolves to
stable `0.3.7`; `dev` resolves to `0.3.8-dev.1792154226.37c322be4d3d`. Both installed
channel checks report current. The initial tag assignment was corrected through
the owner's npm security prompt; no version was republished. Both published
artifact integrities match approved archives. You can use
`npm install --global @scwlkr/openjob@latest` for stable. Public unscoped `openjob`
belongs to a different project; use `@scwlkr/openjob`, retaining the `openjob`
binary. Future main/release publication is not automatic; current CI builds
downloadable artifacts only.

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

Initial publication, tag correction, exact artifact integrities, clean registry
installations and channel checks are verified. Ongoing automated registry
publication still needs separately approved authentication/trusted publishing,
serialization and stale-run protection. Current CI only builds downloadable
artifacts; public latest/dev do not automatically follow this repository.

Maintainer proof after building and clean-prefix installation:

```sh
node scripts/smoke-npm-app.mjs /tmp/openjob-install/bin/openjob
npm run test:distribution
```

The smoke creates/schedules/completes a synthetic Task through the packaged API,
checks separate owners and Host/Origin rejection, reads real static assets from
the tarball, and verifies signal shutdown. Device/native release acceptance and
live-provider behavior are separate gates.
