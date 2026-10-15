# OpenJob CLI

Requires macOS and Node.js 22.13 or newer. Install OpenJob v0.3.7 from GitHub:

```bash
npm install --global https://github.com/scwlkr/openjob/releases/download/v0.3.7/openjob-0.3.7.tgz
```

Then run `openjob auth login` and `openjob --help`. OpenJob stores the Firebase
refresh credential in the macOS credential store and keeps only the current
Group ID in local config. It has no local Task database or offline mode.

Production is the default and cannot be redirected with runtime endpoint
variables. Maintainers can select the `@scwlkr` owner Preview profile after
loading its recorded stable Preview User ID from 1Password:

```sh
OPENJOB_PREVIEW_OWNER_EXPECTED_USER_ID='op://My Passwords/OpenJob Preview Owner Binding/OpenJob User ID' \
  op run -- openjob --profile preview-owner auth login
```

Wrap every Preview invocation with the same unresolved 1Password reference;
never export the resolved User ID into a long-lived shell. For example:

```sh
OPENJOB_PREVIEW_OWNER_EXPECTED_USER_ID='op://My Passwords/OpenJob Preview Owner Binding/OpenJob User ID' \
  op run -- openjob --profile preview-owner group list
```

The Preview profile has its own API, Firebase project, Google Desktop OAuth
client, macOS Keychain account, and config directory. Login saves the candidate
refresh credential only after `/me` exactly matches both `@scwlkr` and the
1Password-bound User ID. A mismatch fails closed and preserves any prior
profile credential. The Keychain account uses only a short SHA-256-derived
suffix, never the raw User ID.

Before deploying Preview, bind the matching Desktop OAuth client secret with
`wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET --env preview`, then confirm
only the binding name with `wrangler secret list --env preview`. Never put the
secret in Git, a command argument, or terminal output. Provider passwords, MFA,
and recovery material remain in their 1Password items.

## Scoped agent reads

An authenticated human owner uses `POST /api/v1/agent-grants` with
`{"groupId":"grp_…","name":"Planning assistant"}` to issue a 24-hour
`tasks:read` credential. Save the returned `data.token` once to a private file
(mode 0600); do not put it in URLs, arguments, logs or shared Tasks. Only its
hash is retained by OpenJob. Owner-only `GET /api/v1/agent-grants` lists grants;
`DELETE /api/v1/agent-grants/{agentId}` revokes one immediately. The selected
human CLI profile can issue, inspect and revoke grants without direct API calls:

```sh
openjob agent grant --group grp_example --name "Planning assistant" --token-out /private/path/token
openjob agent list --format json
openjob agent revoke agt_0123456789abcdef0123456789abcdef --yes
```

Grant requires an explicit Group/name and a new `--token-out` file. It saves
the token atomically as plain text with mode 0600; stdout/stderr contain only
public metadata. Existing token files, stdout token delivery and `--force` are
rejected. Public `--out` and private `--token-out` must be different files.

Listing includes IDs, names, Groups, scopes and expiry times, never tokens.
Revocation requires confirmation (or `--yes` for scripts); a failed or absent
grant returns an error. Revocation stops later reads but cannot recall data
already read. These owner commands reject `--agent-token-file`; they use the
selected human profile and preserve its identity checks.

```sh
openjob task list --group grp_example --agent-token-file /private/path/token
openjob task show task_example --group grp_example --agent-token-file /private/path/token
```

`-` reads the token from stdin. Explicit Group selection is required. These
commands use the selected profile's API and never refresh or fall back to a
human credential. Only Task collection/item reads in that Group are allowed;
writes, administration and other APIs are denied. Expiry, owner account
deletion, leaving the Group and rejoining with a new membership invalidate the
grant. A new grant requires the human owner's authorization. These controls
require a separately reviewed release to reach hosted clients.

Issuance is not retried after transient or ambiguous failures. Inspect
`openjob agent list` before retrying an uncertain request. If a file race or
write failure prevents token delivery after issuance, the error identifies
the new grant and its revoke command without exposing the credential; revoke
it and issue a new grant to a fresh file. The token is not recoverable from
the service.
