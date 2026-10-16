# Owner private Tasks and Calendar

The normal `/workspace` entrypoint uses the existing Firebase session and the
application API. The existing Group app links to it from its User menu; it stays
available separately. A recognized OpenJob account is required. This path does
not create accounts implicitly or accept demo owner headers as authentication.

- `GET /api/v1/workspace/snapshot` reads only the resolved owner's workspace.
- `POST /api/v1/workspace/commands` applies a strict Task or Calendar command.
- Firebase Bearer identity resolves through the existing user directory. Missing,
  unknown, deleting or removed identities cannot read or write private state.
- Create/edit/complete/schedule/unschedule/delete use the shared workspace engine.
  Linked Task and Calendar changes are committed together. Private Tasks never
  enter a Group Task list.

The Personal Calendar is OpenJob-owned; it is not a Google, Outlook or CalDAV
calendar. Mail is an explicitly synthetic read-only preview, not connected mail.
Creating a Task from that preview saves only the example title, with no mailbox
reference. No sending is implemented. Existing Group read-only agent credentials do not
grant this workspace access.

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

Choose only needed scopes and resources. The new token file must not exist; the
CLI writes it atomically with mode 0600. The secret is returned once at issuance,
never listed. Grants expire after 24 hours. Only a hash is persisted, alongside
workspace state, and writes revalidate the grant on each compare-and-set attempt.
Revocation fences concurrent writes through that same document. Expiry is checked
immediately before commit dispatch; the REST adapter cannot guarantee a server
commit-clock deadline. Account deletion removes state and grants together.

Agent credentials cannot administer grants, access Group Tasks or fall back to
human login. Write-only grants receive minimal acknowledgements rather than
Task/Calendar content. Linked Task scheduling requires both relevant write
scopes and resources. Mail access and sending remain unavailable. No actual
credentials were issued during development; isolated tests use synthetic tokens.

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
The normal app route is build-checked; live OAuth/database behavior is untested.

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
