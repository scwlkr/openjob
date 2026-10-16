# Run the full workspace prototype

From this cloud checkout, with the existing locked dependencies installed:

```sh
npm run dev:workspace -- --port 5173
```

Open `http://127.0.0.1:5173/workspace` in the configured cloud browser. The
launcher starts the app and a loopback fixture API. Mail, Calendar, Tasks and
Agents share server-owned state saved under the ignored `.openjob/` directory.
Restarting the launcher reloads that state. Browser-test runs use their own
temporary state file, even if a persistence override exists in the environment.

All Gmail, Outlook and IMAP connections shown here are simulated. The two
owner selectors and agent identity headers are explicit fixture identities,
not authentication. This local prototype cannot send correspondence, connect
real accounts or write external calendars. The fixture proxy is disabled in
ordinary builds and only accepts loopback requests when explicitly enabled.
The existing Group Task app remains at `/`; its production backend is unavailable in this local fixture mode, which supplies no Worker credentials. Ordinary production configuration remains unchanged.

## Walkthrough

1. Start as Alex. Filter among the three simulated mailboxes, open the launch
   checklist message, and save a reply draft. Create a personal Task from it.
2. In Tasks, schedule that Task on the Work calendar with explicit UTC start
   and end times, then mark it complete. In Calendar, inspect its linked block.
3. Create a separate calendar block, edit its title/time and delete it.
4. Compose a new draft from the Studio mailbox. Inspect saved drafts and their
   originating account. Nothing has been sent.
5. In Agents, grant `tasks:read` on Personal tasks to a named simulated agent.
   Inspect access: Tasks appear, mailbox messages do not. Revoke it; inspection
   fails immediately.
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
The returned ID can be used with `task.schedule` and `task.complete`. Commands
and response types live in `shared/workspace-contracts.ts`. Add `--agent ID`
to simulate a granted principal. The CLI refuses non-loopback destinations and
redirects. `mail.send` always returns `sending_disabled`, including by API/CLI.

## Evidence and limits

The browser workflow and isolated API/CLI tests exercise real mutations,
retrieval, durable restart, isolation, scope denial and revocation. Functional
theme/responsive checks replace historical pixel comparisons under
[the owner-approved prototype policy](PROTOTYPE_DELIVERY.md).

Provider OAuth/sync/search/attachments, real sending, production authentication
for the new workspace, multi-user hosting, offline conflict resolution and
native workspace screens remain unimplemented. Native quick checks cover the
existing app only; device/store evidence remains a release requirement.
