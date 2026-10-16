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

The initial 0.3.7 and dev publications remain unchanged. The retained reviewed
0.3.8 candidate in `/tmp/openjob-307-candidate` is installation evidence, not an
approved release. No new version is authorized for publication by this workflow.

## Installed updates

`openjob app` automatically checks only its selected channel; `openjob updates`
checks explicitly. These checks never install, switch channels or run npm.
User commands remain `npm install -g @scwlkr/openjob@latest` or `@dev`.
