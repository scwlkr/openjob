# Owner private Mail, Tasks and Calendar

The normal `/workspace` entrypoint uses the existing Firebase session and the
application API. The existing Group app links to it from its User menu; it stays
available separately. A recognized OpenJob account is required. This path does
not create accounts implicitly or accept demo owner headers as authentication.

- `GET /api/v1/workspace/snapshot` reads only the resolved owner's workspace.
- `POST /api/v1/workspace/commands` applies a strict personal workspace command.
- Firebase Bearer identity resolves through the existing user directory. Missing,
  unknown, deleting or removed identities cannot read or write private state.
- Create/edit/complete/schedule/unschedule/delete use the shared workspace engine.
  Linked Task and Calendar changes are committed together. Private Tasks never
  enter a Group Task list.

Choose **Open linked task** on a saved Task-backed Calendar block to focus its exact Task. From there, edit, complete, reschedule or reopen source Mail. The action requires the complete block/Task/calendar relationship in the current scoped snapshot. Unsaved Task titles, new-task text, schedules and Calendar editor fields survive tab switches; owner/session changes clear them.

The Personal Calendar is OpenJob-owned; it is not a Google, Outlook or CalDAV
calendar. The **Mail** tab offers explicit **Add invented examples** activation:
three fictional mailboxes and six fixed messages, saved in the same private
workspace. Activation is idempotent and preserves existing Tasks, Calendars,
drafts, read flags, simulated Sent and grants. It cannot import provider mail.
Existing Group read-only agent credentials do not grant this workspace access.

## Saved invented Mail

Read/search messages across or within mailboxes, mark read/unread, create a
private linked Task, schedule it on the Personal Calendar and complete it. Save
or edit a reply draft; its original mailbox stays fixed. Drafts and simulated
Sent survive refresh and store reconstruction. Compose accepts ordinary email
addresses, but **Simulate send** only moves the draft to a local fixture record.
Actual `mail.send` always returns `sending_disabled`; no transport sends mail.
Source message/account references exist only on private Tasks, never Group Tasks. Choose **Open source mail** on a private Task to return to its exact message. This selects the original mailbox and Inbox and clears hiding filters. Each unsaved reply is kept separately in the current session; open composition and draft-editor fields are preserved. Reload restores saved work and clears unsaved edits. Unavailable or redacted source records have no open action.

The existing CLI uses exactly the same authenticated API:

```sh
printf '%s' '{"type":"mail.examples.add"}' | openjob workspace command --input - --format json
openjob workspace snapshot --format json
printf '%s' '{"type":"mail.draft","messageId":"example-message-1","body":"An invented reply"}' | openjob workspace command --input - --format json
```

Mail command variants include `mail.read`, `mail.draft`, `mail.compose`,
`mail.draft.update` and `mail.simulate-send`; exact fields are in OpenAPI. Example
activation is human-only. Existing Task and Calendar commands are unchanged.

## Provider preview

The Mail preview reads synthetic account, message, folder and calendar data
through the authenticated provider-preview API and existing CLI. Account-qualified
references keep upstream IDs distinct across owners and multiple accounts from
the same provider. The UI exposes capability limits and connection/sync states;
it cannot reconnect, send or write provider records. A preview Calendar is not
the saved OpenJob Personal Calendar. Example-to-Task still saves only its title.
See the [provider boundary and smallest real integration setup](providers/README.md).

## Find personal work

Task status, title search and Planned day (UTC) use the same filtering rules in the app and existing CLI. Default All preserves all work. Search is a trimmed, case-insensitive literal title match, up to 200 characters. A planned day includes intervals overlapping that UTC day; unscheduled Tasks do not match. Clear task filters restores all work. Calendar’s Open linked task clears filters needed to reveal that exact Task while keeping unfinished editors.

```sh
openjob workspace tasks --status open --search launch --scheduled-on 2027-06-02 --format json
```

The CLI reads the existing authorized snapshot and returns filtered Task records, preserving IDs and permission redaction. Invalid statuses or impossible dates reject before a request. It does not add provider access.

## Existing CLI

After authenticating an existing human profile through the normal OpenJob CLI:

```sh
openjob workspace snapshot --format json
printf '%s' '{"type":"task.create","title":"Plan the week"}' | openjob workspace command --input - --format json
```

A JSON file can replace stdin. Use the returned Task ID for `task.update`,
`task.complete`, `task.schedule`, `task.unschedule` or `task.delete`. Commands
and exact fields are documented in the shared OpenAPI contract; a scheduled
interval needs explicit ISO start/end timestamps with a time zone and an owned
Calendar ID. Mutation requests do not retry network/service failures; inspect
a snapshot before retrying an ambiguous outcome.

## Scoped personal agents

An authenticated human can issue, list and revoke grants through the same API.
The Agents screen shows effective access and recent stable agent IDs; it never
renders or stores an agent secret. Issue credentials through the existing CLI:

```sh
openjob workspace agent grant --name Planner --scopes tasks:read,tasks:write,calendar:read,calendar:write --resources tasks:personal,calendar:personal --token-out ./planner.token
openjob workspace snapshot --agent-token-file ./planner.token --format json
openjob workspace agent list --format json
openjob workspace agent revoke AGENT_ID --yes
```

Agents can similarly match a visible Calendar event’s `taskId` to a Task and its `calendarEventId` in `workspace snapshot`, with tasks:read and calendar:read on the relevant resources. Insufficient scopes redact the links or entire records.

Agents can resolve an allowed Task source from the same `workspace snapshot` response by matching both `sourceMessageId` and `sourceAccountId` to a visible message. This needs tasks:read and mail:read on the named resources; Tasks-only snapshots redact both source fields. No extra navigation endpoint or provider permission exists.

Choose only needed scopes and resources. The new token file must not exist; the
CLI writes it atomically with mode 0600. The secret is returned once at issuance,
never listed. Grants expire after 24 hours. Only a hash is persisted, alongside
workspace state, and writes revalidate the grant on each compare-and-set attempt.
Revocation fences concurrent writes through that same document. Expiry is checked
immediately before commit dispatch; the REST adapter cannot guarantee a server
commit-clock deadline. Account deletion removes state and grants together.

Agent credentials cannot administer grants, access Group Tasks or fall back to
human login. Write-only grants receive minimal acknowledgements rather than
Task, Calendar or Mail content. Linked Task scheduling requires both relevant write
scopes and resources. Mail scopes are `mail:read`, `mail:draft` and the separate
`mail:simulate-send`; select explicit resources `mail:example-gmail-personal`,
`mail:example-gmail-work` or `mail:example-outlook`. Reply drafting needs read and
draft scopes; compose/edit needs draft; simulation also needs simulate-send.
Reading drafts/Sent requires mail:read. Tasks-only readers receive no mailbox
provenance. Agents cannot activate examples or send actual mail. The Agents
screen lists effective named resources and stable activity IDs without secrets.
No actual credentials were issued during development; tests use synthetic tokens.

## Persistence and deletion

The existing server-side Firestore REST client stores validated state under
`v1PersonalWorkspaces/{resolvedUserId}`. It never uses a client-selected owner
path. Compare-and-set preconditions prevent lost updates, and the same commit
fences the user's active directory record. A workspace is currently bounded to
900 KB of encoded document data; capacity errors preserve existing state. This
is a bounded first durable model, not a claim of unlimited workspace scale.

Account deletion removes the owner's workspace before provider/identity
finalization. Cleanup failure keeps deletion pending. Reads and writes recheck
active identity; deleting users cannot recreate the document during cleanup.
Existing direct-client Firestore rules remain deny-all and were not changed.

## Verify without live credentials

All development checks use signed synthetic Firebase tokens and the isolated
fake Firestore transport. No test contacts a live provider/database or creates
an actual user/grant. Run the required `npm test` gate; its personal workspace
browser lane uses the real HTTP API factory, existing JWT verifier, user store
and Firestore adapter, with a test-only auth harness and fake REST backend.
Phone and desktop browser journeys exercise the authenticated app, shared Mail controls, real HTTP API factories and fake Firestore transport. Live OAuth/database behavior is untested.

The existing one-command synthetic Mail/Calendar/Tasks/agent demo remains:

```sh
npm run dev:workspace -- --fresh
```

That explicitly enabled loopback demo is distinct from the authenticated
application path. Live cloud preview sharing is unavailable in the exposed
tools; the private owner walkthrough has portable captures. No deployment,
Firestore publish, auth/security setting change or credential creation occurred.
A read-only database metadata check could not authenticate, so live edition and
runtime behavior remain unverified; the adapter preserves the existing REST API.

## Native personal workspace

The Expo app opens **Personal workspace** for confirmed signed-in users.
**Existing Groups** retains its read-only Task List. Personal Mail, Tasks, Calendar
and Agents use the same authenticated API and shared commands as web/CLI.
Mail starts empty; **Add invented examples** explicitly adds fixture mailboxes.
Create and schedule a private Task from a message, complete it, open its linked
Calendar block and return to the exact source to save/edit a reply. Compose and
**Simulate send** save fixture state only; actual delivery is disabled.

Tasks and manual Calendar blocks support create/edit/delete, with confirmation
for deletion. Schedule fields accept UTC ISO timestamps (for example
`2027-06-02T14:00:00Z`); impossible dates and nonincreasing slots are rejected.
Module and Group navigation preserve unfinished input. Owner/session changes
clear it; provisional/offline sessions must restore before personal access.
Agents shows effective scopes/resources, expiry, activity and confirmed revoke.
Use the existing CLI for agent issuance; no secret is displayed in the app.

This surface is online-only, with no personal disk cache, offline mutation queue
or automatic mutation retry. After an uncertain request, reconnect and Refresh
to inspect saved state before changing it again. Native controller, HTTP and
component checks do not prove device keyboards, backgrounding or native storage.
Cross-platform device/release gates in ADR0017 still apply.
