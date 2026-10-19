# Local npm release

Shane chose local Mac checks and publishing on October 16. The GitHub OIDC
proposal is cancelled; no trust records, environments, tokens or activation
were created. The only Actions workflow is optional manual artifact generation;
main pushes and releases no longer consume Actions minutes automatically.

Use the existing npm/Node checkout and authenticated npm CLI. No scheduler,
credential creation or security changes are needed. Keep a clean reviewed
checkout. The commands below never deploy the hosted app.

## Check and package

```sh
npm run npm:prepare -- dev
```

Dev requires HEAD to equal current remote main. The command runs focused
publication/distribution checks, TypeScript compile and secret scan; builds real
UI/API assets; packs; installs into a fresh temporary prefix; runs the packaged
app smoke; and writes `dist/publication.json` with exact source/version/channel
and SHA512. It never publishes. Stale main fails before publication.

For stable, separately review the version change in `cli/package.json` and its
matching `vVERSION` tag. The remote tag must identify this reviewed source in
main history. Create/push tags only with applicable release approval. Then:

```sh
npm run npm:prepare -- latest
```

Review the sealed tarball and plan. A local installation-only candidate can be
prepared without tags or publication using `npm run npm:prepare -- candidate
0.3.8`. Candidate metadata is explicitly unverified/unpublished and publication
rejects it. No root/native version bump is performed automatically.

## Publish only with owner approval

After owner approval of that exact version/channel/source/integrity:

```sh
npm run npm:publish -- dist/publication.json --approve 'sha512-EXACT_VALUE_FROM_PLAN'
```

This checks unchanged artifact bytes, exact source/ref, current npm user scwlkr,
public package owner/repository, selected tag monotonicity and existing version
integrity. It uses the existing npm login and one explicit `npm publish --tag
latest` or `--tag dev` attempt. No tag repair or write retry. Already-current
exact integrity/version/tag is a no-op. Concurrent manual publishers remain
outside this command; keep one integration owner and inspect conflicting state.

npm may require the owner to finish its interactive browser/2FA security prompt.
Complete it personally in Terminal; do not send OTPs/tokens or put them in files.
An expired login is a visible blocker, not permission to create credentials.
A failed/ambiguous write or propagation read requires registry inspection before
any retry. [npm publication](https://docs.npmjs.com/cli/v11/commands/npm-publish/)

## Resume the existing immutable approval

WLK307's October16 approval covers only
`0.3.8-dev.1792161876.9ba3929fbf0c`, source
`9ba3929fbf0ccc3e24e2577410a355fa3798736e`, and its recorded SHA512. The one
original attempt failed with EOTP. Main advancing does not change those approved
bytes. A reviewed receipt in `distribution/approved-publication.mjs` binds that
single exception to the original owner-approval comment. It cannot authorize a
new version, stable release, different channel or rebuilt package.

Use a separate clean checkout at current remote main, preserving unrelated edits
in the original checkout. Keep the original plan and tarball together in a durable
directory outside `/tmp`; copying is allowed only after matching their recorded
integrity. Never regenerate the artifact to make it fit the approval.

```sh
npm run npm:resume:check -- /absolute/durable/path/publication.json --approve 'sha512-XHe/R52kjuZnrHwPuKaElHJqnYfAdGrLOZwGrowoRRsXUyYgCRE37zHdo3J6z7NsY0lLEkVH9J81bqOk73D5Kg=='
npm run npm:resume -- /absolute/durable/path/publication.json --approve 'sha512-XHe/R52kjuZnrHwPuKaElHJqnYfAdGrLOZwGrowoRRsXUyYgCRE37zHdo3J6z7NsY0lLEkVH9J81bqOk73D5Kg=='
```

Check performs no authentication or publication. Both commands verify the approved
bytes/manifest/identity, the original source's identity and ancestry in main,
the clean current-main publisher and the live registry's owner, version integrity
and monotonic dev tag. Publish then uses the existing scwlkr login and makes at
most one explicit dev-tag attempt, with lifecycle scripts disabled. EOTP or an
uncertain result stops; inspect registry before another human-triggered invocation.
Follow npm's security prompt personally; no token, login configuration or 2FA
change is part of this workflow. Normal prepare/publish freshness rules stay intact.

This old artifact contains its original prototype functionality, not later main's
real-pilot or Google lifecycle changes. Registry publication and fresh registry
install/run remain separate acceptance evidence until actually observed.

The initial 0.3.7 and dev publications remain unchanged. The retained reviewed
0.3.8 candidate in `/tmp/openjob-307-candidate` is installation evidence, not an
approved release. No new version is authorized for publication by this workflow.

## Installed updates

`openjob app` automatically checks only its selected channel; `openjob updates`
checks explicitly. These checks never install, switch channels or run npm.
User commands remain `npm install -g @scwlkr/openjob@latest` or `@dev`.
