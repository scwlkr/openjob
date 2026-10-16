# OpenJob CLI

The new [packaged workspace instructions](https://github.com/scwlkr/openjob/blob/main/docs/NPM_INSTALL.md) cover `openjob app`, local tarball installation and notice-only latest/dev updates. Initial scoped registry packages are published; the historical GitHub CLI-only artifact below does not contain workspace app assets.

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

## Personal Tasks, Calendar and invented Mail

`openjob workspace providers --format json` reads the same provider adapter
preview as the web app. It contains invented accounts/messages/calendars with
explicit synthetic status and capability reasons. Use `--account <id>` to select
an account and `--cursor <opaque-cursor>` for the next message page. Account
references and cursors are scoped to the authenticated owner and selected
mailbox. This command uses the normal human profile; it rejects agent tokens.
No live provider connection, credentials, synchronization or sending occurs.
An isolated protocol demo may also expose explicitly `mock` accounts through
the same command. Their message/label reads exercise the Gmail wire adapter
against synthetic HTTP responses using a server-owned connection reader. The
client selects an owned account ID; it cannot select a source, provide a
credential, or enable live execution. Revoked or changed connection records
stop later reads. Upstream consent/authentication failures return a generic
provider-unavailable response and do not log out the OpenJob session.
The separate `connectors` catalog reports adapter implementation status. The
Gmail read adapter is listed as `not_connected`, with required consent and
`liveExecutionEnabled: false`; it is not a selectable mailbox. Its implemented
operations are message/label reads. Calendar, drafts, sending, history sync
and reconnection remain unavailable. The CLI exposes no enable switch or
provider credential input.

The existing human profile also owns a personal workspace through the shared
authenticated API. Web and CLI read and mutate the same server-owned records:

```sh
openjob workspace snapshot --format json
openjob workspace tasks --status open --search "launch" --scheduled-on 2026-10-17 --format json
printf '%s' '{"type":"task.create","title":"Prepare the demo"}' | openjob workspace command --input - --format json
openjob workspace command --input command.json --format json
printf '%s' '{"type":"mail.examples.add"}' | openjob workspace command --input - --format json
```

`workspace tasks` filters an already authorized snapshot and preserves task
order. Defaults include all tasks; choose `--status open|completed|all`, a
literal case-insensitive title `--search` of at most 200 trimmed characters,
and `--scheduled-on YYYY-MM-DD`. Scheduled dates use UTC overlap: a task ending
at midnight is excluded from the next day, while a task crossing midnight
appears on both days. Unscheduled tasks are excluded when a day is selected.
The same command accepts a personal `--agent-token-file`; filtering never
expands the grant’s access. JSON output is `{ "data": [tasks] }`.

The strict command objects support `task.create` (`title`), `task.update`
(`taskId`, `title`), `task.complete` (`taskId`, `completed`), `task.schedule`
(`taskId`, `calendarId`, `start`, `end`), `task.unschedule`/`task.delete`
(`taskId`), `calendar.create` (`calendarId`, `title`, `start`, `end`),
`calendar.update` (`eventId`, `title`, `start`, `end`) and `calendar.delete`
(`eventId`). Every command includes its `type`. Use calendar ID `personal`
for the default calendar and ISO timestamps with timezone offsets or `Z`.

Normal `--profile`, `--format`, `--out` and `--quiet` conventions apply.
No Group selection, fixture owner headers or real provider Mail access are accepted here.
A linked task mutation also updates its calendar block.
Commands are not retried for network/service errors: inspect a fresh snapshot
before retrying an uncertain mutation. Hosted availability requires a reviewed
release; fixture demonstrations do not establish deployed availability.

`mail.examples.add` is human-only and idempotently adds three invented mailboxes
and six messages while preserving Tasks, Calendar, drafts, read flags and grants.
`task.create` may include one known example `messageId`; provenance stays private
and is hidden from agents without that mailbox’s read scope. Invented Mail
commands are `mail.read` (`messageId`, `read`), `mail.draft` (`messageId`, `body`),
`mail.compose` (`accountId`, `to`, `subject`, `body`), `mail.draft.update`
(`draftId`, `to`, `subject`, `body`) and `mail.simulate-send` (`draftId`). Editing
keeps the original mailbox and draft ID. Bodies allow up to 20,000 characters
inside the 32 KiB JSON request limit. Valid recipient addresses stay local;
Simulated Sent uses the invented account’s `.invalid` sender. `mail.send` always
returns `sending_disabled`; nothing reaches a provider or recipient.

### Scoped personal agents

The same CLI can issue distinct, revocable 24-hour personal workspace grants:

```sh
openjob workspace agent grant --name "Personal planner" --scopes tasks:read,tasks:write,calendar:read,calendar:write --resources tasks:personal,calendar:personal --token-out /private/path/personal-token
openjob workspace agent list --format json
openjob workspace snapshot --agent-token-file /private/path/personal-token --format json
openjob workspace command --agent-token-file /private/path/personal-token --input command.json --format json
openjob workspace agent revoke agt_0123456789abcdef0123456789abcdef --yes
```

Grant requires explicit comma-separated scopes/resources and a new private token
file. Tokens are written atomically with mode 0600; never to stdout, public
`--out`, or an existing file. `--force` is rejected. Only public grant metadata
is printed. If delivery fails after issuance, inspect the grant list and revoke
the identified grant before creating another. Issuance is not retried after
network or service failures.

Personal token files must be regular private files (mode 0600); `-` may read a
token from stdin, but command JSON and token cannot both use stdin. Agent calls
never refresh a human credential or fall back to one. Write-only grants receive
an ID/acknowledgment rather than Task/Event content; reads require the matching
read scope. Revocation, expiry and owner account deletion deny later calls.
Personal credentials cannot administer grants or authorize existing Group APIs;
Group agent credentials cannot authorize personal workspace calls.
Invented mailbox resources are `mail:example-gmail-personal`,
`mail:example-gmail-work` and `mail:example-outlook`. Grant `mail:read`,
`mail:draft` and `mail:simulate-send` only as needed on specific example
mailboxes. These grants never authorize real provider preview records or seed
examples; simulation requires both draft and simulate-send capabilities.

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

### Find saved open time

`openjob workspace availability --task ID --schedule-start ISO --schedule-end ISO
--minutes 30 --format json` returns up to12 slots across saved owner calendars.
Choose a slot explicitly and submit `task.schedule-available` through
`workspace command --input FILE`. Current blocks are rechecked atomically; an
occupied slot returns `schedule_conflict`, exit6, without moving the Task.
Human sessions only; seven-day maximum window, whole minutes5–480, explicit
ISO time zones. Live provider calendars are not checked. Manual scheduling is
unchanged. See [the workflow](../docs/PERSONAL_WORKSPACE.md#find-time-for-a-task).
