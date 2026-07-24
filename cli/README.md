# OpenJob CLI

Requires macOS and Node.js 22.13 or newer. Install OpenJob v0.3.3 from GitHub:

```bash
npm install --global https://github.com/scwlkr/openjob/releases/download/v0.3.3/openjob-0.3.3.tgz
```

Then run `openjob auth login` and `openjob --help`. OpenJob stores the Firebase
refresh credential in the macOS credential store and keeps only the current
Group ID in local config. It has no local Task database or offline mode.

Production is the default and cannot be redirected with runtime endpoint
variables. Maintainers can select the isolated `@qa-one` Preview profile after
loading its recorded stable User ID from 1Password:

```sh
OPENJOB_PREVIEW_QA_EXPECTED_USER_ID='op://Personal/OpenJob QA One Google/OpenJob User ID' \
  op run -- openjob --profile preview-qa-one auth login
```

Wrap every Preview invocation with the same unresolved 1Password reference;
never export the resolved User ID into a long-lived shell. For example:

```sh
OPENJOB_PREVIEW_QA_EXPECTED_USER_ID='op://Personal/OpenJob QA One Google/OpenJob User ID' \
  op run -- openjob --profile preview-qa-one group list
```

The Preview profile has its own API, Firebase project, Google Desktop OAuth
client, macOS Keychain account, and config directory. Login saves the candidate
refresh credential only after `/me` exactly matches both `@qa-one` and the
1Password-bound User ID. A mismatch fails closed and preserves any prior
profile credential. The Keychain account uses only a short SHA-256-derived
suffix, never the raw User ID.

Before deploying Preview, bind the matching Desktop OAuth client secret with
`wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env preview`, then confirm
only the binding name with `wrangler secret list --env preview`. Never put the
secret in Git, a command argument, or terminal output. Provider passwords, MFA,
and recovery material remain in their 1Password items.
