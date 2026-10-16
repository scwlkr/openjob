# Run the full workspace prototype

The saved cloud checkout already has Node24.19.0, npm11.9.0 and the locked
dependencies installed. From the repository root, start a new seeded demo:

```sh
npm run dev:workspace -- --fresh
```

Open `http://127.0.0.1:5173/workspace` in the configured cloud browser. No login,
Firebase/Cloudflare account, provider credentials, environment secrets or separate
seed command is required. Alex starts with three simulated mailboxes, three
messages, a personal Task and two Calendars; Sam has separate private fixtures.
The launcher starts both the app and its loopback API and prints the state path.

`--fresh` creates a new temporary fixture file; it never resets an existing
demo or honors an existing state-file override. To keep the default saved demo
across restarts, omit `--fresh`: `npm run dev:workspace`. The default state is
`.openjob/workspace-demo.json`; its first start seeds automatically and later
starts reload it. To reopen a particular fresh run, pass its printed path through
`OPENJOB_WORKSPACE_STATE_FILE` and omit `--fresh`. Stop with Ctrl+C. Only one
launcher may use backend port4180; stop the earlier run before starting another.
Use `--port 5174` for a different frontend port. Browser gates always use isolated
temporary state, independently of persistence overrides.

This uses the existing locked stack. A newly provisioned checkout needs its
locked dependencies installed first; inspect root/native postinstall scripts
before `npm ci`, which also installs native dependencies and applies patches.
No install is needed in this already prepared saved environment.

All Gmail, Outlook and IMAP connections shown here are simulated. The two
owner selectors and agent identity headers are explicit fixture identities,
not authentication. This local prototype cannot deliver correspondence, connect
real accounts or write external calendars. Its explicit Simulate send action only
moves a draft into a local, visibly labeled simulated Sent record. The fixture proxy is disabled in
ordinary builds and only accepts loopback requests when explicitly enabled.
The prototype also opens at `/` in explicit fixture mode. Ordinary builds retain the existing authenticated Group Task app and production configuration; the local fixture supplies no Worker credentials.

## Walkthrough

1. Start as Alex. Use Inbox, Drafts and Simulated Sent folders; search subjects,
   people or message bodies within the selected mailbox. Filter among the three simulated mailboxes, open the launch
   checklist message, and save a reply draft. Create a personal Task from it.
2. In Tasks, schedule that Task on the Work calendar with explicit UTC start
   and end times, then mark it complete. Edit its title: the linked Calendar block
   follows. Reopen Schedule to adjust the existing interval or calendar. Unschedule
   removes the linked block while keeping the Task. Confirmed Delete task removes
   the Task and linked block; source mail stays. In Calendar, inspect linked blocks.
3. Use Calendar Agenda, Day or Week; select a UTC date, navigate Previous/Next
   or Today, and filter the owned calendars. Create a separate calendar block,
   edit its title/time and delete it. Editing keeps the original calendar.
4. Compose a new draft from the Studio mailbox. Reopen a saved draft, change its
   body and save it again. Its ID and original sending account remain the same.
   Choose **Simulate send** to move it into **Simulated Sent**, then inspect
   the saved From, To and body. No delivery occurs outside this fixture service.
5. In Agents, grant `tasks:read` on Personal tasks to a named simulated agent.
   Inspect access: Tasks appear, mailbox messages do not. Revoke it; inspection
   fails immediately. Grant a second agent tasks:read and tasks:write on Personal
   tasks. Inspect it, enter a Task title and choose Create task as agent. The Task
   appears in Tasks. A read-only or revoked agent cannot create it; no human
   identity fallback occurs.
6. Switch to Sam. Alex's mail, tasks, calendars, drafts and agent controls are
   absent. Switch back to Alex, refresh, or restart the launcher: saved work
   remains available.

## Use the same state through the CLI

While the launcher is running:

```sh
npm run workspace:cli -- snapshot --url http://127.0.0.1:4180 --owner demo_alex
```

For a mutation, save a JSON command to a local fixture input file and invoke:

```sh
npm run workspace:cli -- command --url http://127.0.0.1:4180 --owner demo_alex --input command.json
```

Example command: `{"type":"task.create","title":"Review the prototype","messageId":"alex_msg_launch"}`.
The returned ID can be used with `task.schedule`, `task.complete`,
`task.update`, `task.unschedule` and `task.delete`. Rename/unschedule/delete
require tasks:write on Personal tasks; when a linked Calendar block is changed
or removed, calendar:write on that calendar is also required. All changes are
atomic. Rename keeps the Task and linked block titles aligned; deleting source
Tasks never deletes Mail. Commands
and response types live in `shared/workspace-contracts.ts`. Add `--agent ID`
to simulate a granted principal. Editing uses `mail.draft.update`; local delivery
simulation uses `mail.simulate-send`. An agent needs both `mail:draft` and the
separate `mail:simulate-send` capability on the source mailbox. Sent reads
require `mail:read`. The CLI refuses non-loopback destinations and redirects.
`mail.send` always returns `sending_disabled`, including by API/CLI.

## Evidence and limits

The default browser gate runs workspace flows against the actual app router and
HTTP proxy, while the existing Task checks retain their isolated harness.
The browser workflow and isolated API/CLI tests exercise real mutations,
retrieval, durable restart, isolation, scope denial and revocation. Functional
theme/responsive checks replace historical pixel comparisons under
[the owner-approved prototype policy](PROTOTYPE_DELIVERY.md).

Provider OAuth/sync/remote search/attachments, real sending, production authentication
for the new workspace, multi-user hosting, offline conflict resolution and
native workspace screens remain unimplemented. Native quick checks cover the
existing app only; device/store evidence remains a release requirement.

## Owner review outside this environment

The available cloud tools do not expose an authenticated port-forward or share
URL for this saved environment. Loopback addresses above are environment-local,
not owner-accessible preview links. A portable capture walkthrough is delivered
through ChatGPT Library; it shows actual fixture-app behavior, not a deployed
service. The one-command launcher remains the reproducible interactive demo
inside this environment. No public tunnel or hosting configuration was created.

## Authenticated personal journey

The normal Firebase-authenticated `/workspace` now has a separate **Mail** tab.
Choose **Add invented examples** to save three fictional mailboxes and six
messages without resetting existing Tasks, Calendars or grants. The shared Mail
controls above also work here: create a private linked Task, schedule/complete
it, save/edit a reply and inspect local Simulated Sent. The **Mail preview** tab
remains an independent, read-only provider example with title-only Task creation.
Named personal agents can be scoped to each invented mailbox. See the
[authenticated workspace guide](PERSONAL_WORKSPACE.md) for API/CLI commands and
scope rules. This does not configure live Mail or change Firebase sign-in.
