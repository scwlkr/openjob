---
id: openjob-v1-07
title: Prototype the Complete CLI Contract
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:prototype
claimed: true
blocked_by:
  - openjob-v1-05
---

## Question

What command, authentication, input, output, file-format, exit-code, and configuration contract lets the CLI replace the browser while preserving stdin and file input, stdout and file output, and stderr diagnostics?

## Answer

### Prototype and selected direction

- The [executable no-network simulator](../../../prototypes/cli/openjob.mjs) and its [complete contract](../../../prototypes/cli/README.md) run with `npm run prototype:cli -- help` or `npm run prototype:cli -- demo`. They are explicitly throwaway and must not become the production client.
- v1 uses the resource-first grammar `openjob [global options] <resource> <command> [arguments]`. It mirrors the shared API, keeps help discoverable, and covers authentication, User, Username, Group, Member, ban, Invite Link, and Task operations without aliases or a second task-only command language.
- Group-scoped commands resolve an opaque Group ID from `--group`, then `OPENJOB_GROUP_ID`, then `group use`'s client-local selection. Group Names are never selectors because they are non-unique, and the hosted service stores no active Group.

### Authentication and configuration

- `auth login` performs the settled Google Desktop OAuth flow with PKCE and a loopback callback, exchanges the result for Firebase credentials, and stores only the refresh credential in the operating-system credential store. `--no-open` supports manually opening the URL; v1 has no API-key or service-account login.
- Non-secret config lives at `${XDG_CONFIG_HOME:-~/.config}/openjob/config.json` and stores only `currentGroupId`. The production API defaults to `https://openjob.dev/api/v1`; `OPENJOB_API_URL` is a development and local-verification override, not a self-hosting promise.

### Input, output, and automation

- Mutations accept named flags or `--input <path|->` containing one OpenAPI-shaped UTF-8 JSON object, never both. Task text also accepts `--text-file <path|->`. `-` explicitly means stdin; stdin is never read implicitly, and v1 has no batch mutation format.
- Successful data goes only to stdout or an atomic `--out <path|->` file. Diagnostics, prompts, browser URLs, and errors go only to stderr. `table` is the stable default even when redirected; explicit `json` preserves API envelopes and `jsonl` emits one unwrapped resource per line.
- Existing output files require `--force`. Destructive operations prompt on an interactive terminal and require `--yes` otherwise; ending a Group always requires the exact current Group Name. Group creation, Task creation, rotation, deletion, and other non-idempotent destructive actions are never automatically retried.
- Exit statuses are stable by class: `0` success, `1` internal CLI failure, `2` usage/local I/O/confirmation or API validation, `3` authentication, `4` forbidden, `5` not found or concealed, `6` conflict, `7` rate limit, `8` network or service failure, and `130` interruption. Machine-readable errors stay on stderr and preserve stable API error codes.

### Implementation boundary

- The production CLI generates request and response types from the checked-in OpenAPI 3.1 contract and owns only presentation, local Group selection, credential storage, browser handoff, and transport. Domain validation, authorization, ordering, membership transitions, and Task state remain in the hosted service, with no local Task database or offline mode.
