# WLK-307 publishing proposal — disabled, approval pending

The initial stable/dev packages are verified. Existing `npm-artifacts.yml` is
unchanged and only builds artifacts. New `npm-publish.yml` has both jobs disabled
unless repository variable `OPENJOB_NPM_PUBLISHING_ENABLED` is explicitly `true`.
Read-only checks found no repository environments or variables. No access,
credentials, trust records, activation, production release or publication was
created by this preparation.

## Exact proposed persistent access

npm package **@scwlkr/openjob**, owner **scwlkr**. Public GitHub repository
**scwlkr/openjob**, default branch **main**. Two npm GitHub Actions OIDC records:

| Field | Development | Stable |
| --- | --- | --- |
| GitHub organization/user | `scwlkr` | `scwlkr` |
| Repository | `openjob` | `openjob` |
| Workflow filename (no path) | `npm-publish.yml` | `npm-publish.yml` |
| Environment | `openjob-npm-dev` | `openjob-npm-release` |
| Allowed npm action to enable | direct `npm publish` | direct `npm publish` |
| Dist-tag management permission | leave disabled | leave disabled |
| GitHub allowed ref | only branch `main` | only tag pattern `v*` |
| Required reviewer | none (continuous dev) | user `scwlkr`, verified ID206951249 |
| Administrator bypass | no bypass needed | disabled |
| Self-review | not applicable | allowed for the solo owner |

npm supports multiple OIDC records per package, optional environment binding,
GitHub-hosted runners and Node22.14+/npm11.5.1+. New records also implicitly allow
staged publishing; direct publishing must be selected. No long-lived npm token
is proposed. First successful publication must occur within two days of trust
setup; configure it only when an approved artifact is ready.
[Official npm requirements](https://docs.npmjs.com/trusted-publishers/)

**Trust is package-level across tags.** npm does not make this a dev-only grant.
Main/workflow writers gain package-publication authority when activated and
could alter trusted code to publish another tag. Environment/channel separation
is enforced by reviewed code and GitHub controls, not a tag-scoped npm credential.
No existing account 2FA/token settings or OpenJob agent grants are changed.

GitHub permissions: build gets `contents:read` and `actions:read` for protection
metadata; publish additionally gets `id-token:write`. The default GitHub job
token is read-only; no repository secret or npm token is added. Use hosted Node24.

## Triggers and exact artifact approval

- Main push/merge: automatically publish exact-main next-patch prerelease
  `<next-patch>-dev.<commit-time>.<12-sha>` using explicit `--tag dev`.
  One-time activation authorizes future public dev publications without a
  separate approval per push.
- Stable: published, non-draft, non-prerelease GitHub release only; exact
  `v<package-version>` tag in main history. Owner reviews source/version/SHA512
  and uploaded tarball, then approves the stable environment job. Creating
  that release is a separate human decision. Live release/tag is rechecked.

The build seals immutable bytes before environment approval. Publish downloads
that artifact without rebuilding/installing dependencies. Attempt-specific names
preserve prior artifacts and support reruns. Global concurrency serializes this
workflow; final current-ref/monotonic-version/registry checks reject stale runs,
downgrades and conflicting existing versions. Exact version+integrity+tag match
is a no-op. No automatic tag repair or write retry. Manual publishers are outside
that lock. Read-only checks require both environments/ref rules and stable
owner review/admin-bypass-off before any environment job can run; unknown fields
fail closed. Real protection/OIDC behavior needs approved live setup to verify.
[GitHub environment behavior](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

## Minimal owner setup after proposal review

1. Explicitly approve these package-level npm bindings, GitHub environments,
   continuous main/dev publication and stable artifact-approval policy.
2. Merge the reviewed **disabled** workflow; npm requires the filename to exist
   in the repository. Keep the activation variable unset.
3. Create both protected GitHub environments and read back exact table values.
   Configure both npm trust records exactly as above. Complete npm's security
   prompt personally if required; never send OTP/token/password.
4. After readback, approve setting repository variable
   `OPENJOB_NPM_PUBLISHING_ENABLED=true` and the first reviewed dev publication.
   Verify real OIDC/integrity/tag/install behavior before calling setup complete.
5. Separately review the stable version/tag/release and approve its sealed
   artifact. Do not use old `release:publish` for package-only approval: it also
   deploys the hosted application. No site deployment is included here.

The user reserved new persistent access for explicit approval. This preparation
does not authorize those mutations and leaves the workflow disabled.

## Local next-package candidate

`node scripts/build-npm-app.mjs candidate 0.3.8` builds a clean-source local
installation candidate with persistence and the Calendar planner. Metadata is
`candidate-unpublished/v0.3.8`, `registryVerified:false`: this is an installation
review, not a valid stable publication plan. No root/native versions, GitHub
release or production tag change. Exact source/digest and clean-prefix proof are
recorded in Linear/w.md. Existing approved archives and saved demos are retained.

A real stable publish must be rebuilt from the separately reviewed exact stable
version/tag, sealed and approved. This candidate is not silently substituted.
