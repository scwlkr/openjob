# Features

## Integrated workspace prototype

`npm run dev:workspace` opens `/workspace`: simulated Gmail/Outlook/IMAP Mail, Calendar, personal Tasks and scoped agent controls backed by one persistent local HTTP service and shared domain/CLI. Read/compose/save drafts, turn mail into a private Task, schedule/complete work, edit/delete calendar blocks, inspect resource-limited agent access and revoke it. Owner views are isolated. Sending is always disabled. This is fixture-only application behavior; provider OAuth/sync, new production authentication and native workspace screens are not implemented. See [the demo walkthrough](docs/WORKSPACE_DEMO.md).

- **Brand foundation:** `docs/brand/index.html` is the offline guide for the OpenJob overhaul. It includes the supplied reference board, eleven editable SVG masters, scoped light/dark CSS tokens, local Inter font/license, type and voice guidance, and labeled interactive product concepts. The web, iOS, and Android apps adopt this identity through shared generated assets, semantic colors, local Inter, browser/install/adaptive icons, and splash artwork. `AGENTS.md` points future UI work to the brand standards; `npm run brand:check` guards generated asset freshness.

## Task scheduling slots

CLI tables preserve optional fields found in later rows, including scheduled slots and due dates, with blank cells for missing values. JSON/JSONL shapes remain unchanged.

The shared Task API and CLI accept an optional planned work interval independently of the date-only due date. Explicit time zones normalize to UTC; both endpoints are required, end follows start, and clearing the slot preserves the Task and due date. Existing membership and completed-Task rules apply. This stores an OpenJob plan; it does not create provider calendar events. The web editor creates, edits and clears slots with explicit UTC inputs; Task cards show the interval in UTC, including an accessible description. Validation, network failure and authentication recovery preserve the entered interval. Native visual scheduling controls remain unimplemented.

## Scoped agent Task reads

A signed-in human can issue, list and revoke a named agent grant through `/api/v1/agent-grants`. Each opaque credential permits only Task list/item GETs in one current Task Group for 24 hours. The service stores its hash, binds it to the owner's membership generation, and rechecks access before returning data or a conditional 304. Revocation, expiry, account deletion and membership loss/rejoin stop access. Grants cannot modify Tasks, administer Groups, read other APIs, Mail or Calendar. Account deletion removes owned grant records. Owner management UI and broader scopes remain future Linear work.

Human CLI `agent grant` issues the existing fixed-scope grant to a new private mode-0600 token file; only public metadata is printed. Explicit Group/name/path are required, overwrite and stdout token delivery are rejected, and failed delivery identifies the grant for revocation. Issuance does not retry transient/ambiguous failures. `agent list` and confirmed `agent revoke` use the same human profile and owner-only API.

The existing CLI accepts an explicit `--agent-token-file <path|->` on `task list` and `task show`, together with explicit `--group`. It never refreshes or falls back to human credentials for these reads. Isolated API/Firestore/CLI fixtures verify behavior; no production grant is created by development checks.
