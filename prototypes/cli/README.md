# Complete CLI contract prototype

This is a throwaway, no-network prototype of the v1 command surface. It exists to make the CLI contract concrete before implementation; it must not become the production client.

Run it from the repository root:

```sh
npm run prototype:cli -- help
npm run prototype:cli -- help task
npm run prototype:cli -- demo
npm run prototype:cli -- task list --format json
printf '%s\n' '{"text":"Order filters","assigneeUsername":"scwlkr"}' \
  | npm run prototype:cli -- task create --input - --format json
```

## Selected shape

Use resource-first commands:

```text
openjob [global options] <resource> <command> [arguments]
```

This shape mirrors the shared API's resources, keeps help discoverable, and extends to all governance operations without inventing aliases. An action-first shape such as `openjob list tasks` reads naturally but scatters one resource across unrelated help branches. Task-only shortcuts such as `openjob add` are terse but make Group, membership, ban, and Invite Link operations feel secondary. v1 ships only the resource-first surface; shell aliases remain the User's choice.

The executable is `openjob`. Commands and option names are lowercase kebab-case. Resource names are singular. Commands accept a leading `@` on Username input for convenience and remove it before calling the service; output uses the canonical Username without `@`.

`auth status` reports whether a usable local credential exists and whether it can reach the service; `user show` returns the full current-User API resource. Keeping those separate lets shell checks avoid treating a presentation command as an authentication probe.

## Complete command surface

| Resource | Commands |
| --- | --- |
| Authentication | `auth login [--no-open]`, `auth status`, `auth logout` |
| Current User | `user show`, `username claim <username>` |
| Groups | `group list`, `group create --name <name>`, `group show`, `group use <group-id>`, `group current`, `group rename --name <name>`, `group leave`, `group end` |
| Members | `member list`, `member kick <username>`, `member promote <username>`, `member demote <username>` |
| Bans | `ban list`, `ban add (--username <username> \| --user-id <user-id>)`, `ban remove <user-id>` |
| Invite Links | `invite show`, `invite rotate`, `invite inspect <token-or-url>`, `invite join <token-or-url>` |
| Tasks | `task list`, `task create`, `task show <task-id>`, `task edit <task-id>`, `task done <task-id>`, `task reopen <task-id>`, `task delete <task-id>` |

Every Group-scoped command accepts `--group <group-id>`. The only commands outside a Group are authentication, current-User and Username operations, `group list`, `group create`, `group use`, `group current`, `invite inspect`, and `invite join`.

`group use <group-id>` records a client-local current Group after confirming it is accessible. It does not modify hosted User state. A Group-scoped command resolves context in this order: `--group`, `OPENJOB_GROUP_ID`, then the recorded Group ID. If none exists, it exits with `group_required`. Names are never accepted as Group selectors because Group Names are not unique.

### Task options

`task list` defaults to `--status open --assignee all`. It accepts `--status open|done|all` and `--assignee <username>|unassigned|all`; the service owns ordering. The CLI automatically follows all API pages so a list represents the complete filtered Task List. `--limit <count>` may cap the total records for scripts.

`task create` accepts `--text <text>` or `--text-file <path|->`, exactly one `--assignee <username>`, and optional `--due <YYYY-MM-DD>`. `task edit` accepts the same fields, with `--due none` clearing a due date. It never accepts an Unassigned assignee. `task done` and `task reopen` send desired states rather than toggling.

Destructive operations require confirmation: `group leave`, `member kick`, `member demote`, `ban add`, `invite rotate`, and `task delete`. They prompt only when stdin is an interactive terminal; otherwise `--yes` is required. `group end` is stronger: interactive use requires typing the current Group Name, while non-interactive use requires `--confirm-name <exact-current-name>`. `--yes` never bypasses that name confirmation.

## Authentication

`auth login` starts the settled Google Desktop OAuth flow with PKCE, a random loopback callback, and a state check, then exchanges the Google identity for Firebase credentials. It opens the browser by default. `--no-open` prints the URL to stderr for manual opening while the same local callback waits.

The CLI stores only the Firebase refresh credential in the operating-system credential store. Short-lived Firebase ID tokens remain in memory and are refreshed as needed. `auth logout` deletes the stored refresh credential. Config files, environment variables, stdout, stderr, debug logs, and output files never contain credentials. There are no CLI API keys or service-account login modes in v1.

Every application request sends `Authorization: Bearer <Firebase-ID-token>` to the same `/api/v1` used by the web client. Authentication does not imply Group access; the service authorizes every request.

## Input contract

Mutation commands accept either their named field flags or `--input <path|->`, never both. `--input` reads one UTF-8 JSON object whose fields match that operation's OpenAPI request schema. `-` means stdin. No command reads stdin implicitly, preventing an accidental hang in a pipeline.

Task text has an additional convenience input, `--text-file <path|->`, which reads the complete UTF-8 file or stdin as plain text and is mutually exclusive with `--text` and `--input`. A single final line ending from shell input is removed; internal line breaks and blank lines are preserved. Validation remains owned by the service.

The CLI sends one mutation per invocation. v1 has no bulk import, batch mutation, or client-side transaction format.

## Output contract

Successful result data goes only to stdout or the file selected by `--out <path|->`. Diagnostics, prompts, browser URLs, retry notices, and errors go only to stderr. `--quiet` suppresses nonessential diagnostics but never errors or prompts.

`--format table|json|jsonl` chooses the encoding and defaults to `table`. The format never changes merely because output is redirected, so pipelines are predictable.

- `table` is concise human output. Multiline Task text is escaped on one row; use JSON for lossless machine input.
- `json` preserves the API success envelope: `{ "data": ... }`. Auto-paginated collections contain one complete array.
- `jsonl` emits one unwrapped resource object per line. A single-resource result is one line. An empty collection emits zero lines.

`--out -` is identical to stdout. A filesystem path is written atomically after the complete response is available. Existing files are refused with `output_exists` unless `--force` is present. Partial API or network failure leaves no output file behind. The CLI-generated result for a successful API `204` identifies the affected resource and reports `deleted: true`, giving scripts an explicit success record.

Errors never write to stdout or a selected output file. Table mode writes `openjob: <code>: <message>` to stderr. JSON and JSONL modes write the API error object to stderr as one compact JSON object. Scripts branch on the stable error code or exit status, never the message.

## Exit status contract

| Status | Meaning |
| ---: | --- |
| `0` | Success |
| `1` | Unexpected internal CLI failure |
| `2` | Command usage, local input/output, or confirmation error |
| `3` | Missing, expired, or rejected authentication (`401`) |
| `4` | Authenticated but forbidden (`403`) |
| `5` | Missing or concealed resource (`404`) |
| `6` | Domain or uniqueness conflict (`409`) |
| `7` | Rate limited (`429`) |
| `8` | Network failure, timeout, or service failure (`5xx`) |
| `130` | Interrupted by the User |

Field validation returned as API `400` exits `2`. On `401`, the CLI attempts one refresh and one replay; if that fails it exits `3`. Reads and desired-state operations may follow the shared API's retry contract. Non-idempotent creation, rotation, deletion, and destructive actions are never retried automatically.

## Configuration

The default API base URL is `https://openjob.dev/api/v1`. `OPENJOB_API_URL` may override it for development and local verification; this does not establish v1 self-hosting support. The CLI rejects non-HTTPS URLs except `http://localhost` and loopback addresses.

Non-secret config lives at `${XDG_CONFIG_HOME:-~/.config}/openjob/config.json`; `OPENJOB_CONFIG` may select another file. v1 stores only:

```json
{
  "currentGroupId": "grp_ops"
}
```

The only other environment override is `OPENJOB_GROUP_ID`. Command flags win over environment variables, which win over config, which wins over built-in defaults. Output format is intentionally not configurable, keeping script behavior visible at the call site.

## Implementation boundary

The production CLI should generate request and response types from the checked-in OpenAPI 3.1 contract and contain presentation, local config, credential-store, browser handoff, and transport code only. It must not duplicate domain validation, authorization, Task ordering, membership transitions, or an offline Task database. The simulator in this directory is disposable and makes no network request.
