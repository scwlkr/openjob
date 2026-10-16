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
2. In Tasks, choose **Open source mail** to reopen the exact message and mailbox without losing unsaved replies or composition text. Then schedule that Task on the Work calendar with explicit UTC start
   and end times, then mark it complete. Edit its title: the linked Calendar block
   follows. Reopen Schedule to adjust the existing interval or calendar. Unschedule
   removes the linked block while keeping the Task. Confirmed Delete task removes
   the Task and linked block; source mail stays. In Calendar, inspect linked blocks and choose **Open linked task** to manage the exact Task or reopen its source Mail. Unfinished Task and Calendar editors survive tab switches.
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

Provider OAuth/sync/remote search/attachments, real sending, live provider integration and multi-user fixture hosting remain unimplemented. The authenticated workspace and native personal surfaces are separate from this loopback fixture. Native personal Tasks/Calendar have encrypted offline edits and explicit conflict review; the built personal web demo below exercises browser offline storage. CLI remains online-only. Native quick checks do not prove a device; device/store evidence remains a release requirement.

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
The built personal demo offers mock Gmail, **Mock Outlook protocol · Alex/Sam**
and **Mock IMAP protocol · Alex/Sam** accounts. Real read mappers process injected
invented HTTP or IMAP protocol bytes. IMAP is limited to a plain-text Inbox
subset with UIDVALIDITY-aware paging; it has no socket, TLS or login runtime.
Select Outlook, read/paginate its plain text and create a title-only Task. The
consent-required example makes no broker/provider reads. No Microsoft sign-in or
live mailbox access is configured; the Google-only mock OAuth path is unchanged.
Named personal agents can be scoped to each invented mailbox. See the
[authenticated workspace guide](PERSONAL_WORKSPACE.md) for API/CLI commands and
scope rules. This does not configure live Mail or change Firebase sign-in.

## Reproduce the native offline cycle in this cloud environment

The loopback web fixture above is unchanged and does not claim native offline
behavior. Do not reset its saved state to exercise the offline feature.
The cloud proof uses fresh synthetic identities, fake Firestore transport and
injected storage; it needs no production secrets, grants or correspondence:

```sh
node --test tests/tasks-calendar-sync*.test.mjs tests/native-personal-workspace-http.test.mjs
```

The actual native controller/API HTTP test edits a private Task offline,
restarts under a provisional personal-only session, restores online, loses a
committed response and retries once without another write. It then preserves a
newer server edit as a conflict, requires another review if the server changes
again, applies the explicit local choice, and checks that an edit queued during
sync remains pending afterward. Mail, grants and source provenance survive;
none enters the personal cache. Native component/storage tests exercise the
visible pending/review/confirmation flow and persistence failures.

For a separately configured development device build, follow the
[native offline walkthrough](PERSONAL_WORKSPACE.md#native-offline-tasks-and-calendar).
There is no running device/emulator preview in this environment. Cloud tests and
Metro exports do not establish native durability, encryption, keyboard or
release acceptance. No deployment or new credentials are required for the
isolated proof above.

## Fresh-checkout browser offline demo

Use an authorized cloud checkout with Node22.13 or newer (verified here with
Node24.19/npm11.9). Inspect `package.json`, `native/package.json` and
`native/patches` before installing: root postinstall runs native `npm ci`, whose
postinstall applies the existing patch-package patches. From the checkout root:

```sh
npm ci
npm run dev:personal-workspace -- --port 5191
```

Open `http://127.0.0.1:5191/workspace` in that environment's browser. This command
builds the actual personal workspace UI with injected synthetic Alex/Sam auth
and a loopback fake-Firestore API. No Firebase/Cloudflare account, environment
secret, provider consent or seed step is needed. It is an environment-local
demo, with no hosted sharing link. The existing saved workspace fixture file is
untouched. Stop with Ctrl+C; its temporary build is removed and API state ends.
Use a fresh browser context/origin after restarting, since synthetic server
owner IDs are process-local and old browser bindings intentionally fail closed.

1. Choose **Saved Tasks and Calendar**, then **Refresh from server** once. Choose
   **Prepare offline page** and wait for confirmation. This caches public app
   code only; it does not cache authenticated API responses or incoming Mail.
2. Disconnect using browser network controls. Create a Task, schedule it with UTC
   times, mark it complete and create a manual Calendar block. **Pending · saved
   in browser** acknowledges a completed IndexedDB transaction. Reload offline:
   the same restored local identity reopens saved work. A new/null identity
   cannot select another owner's cache. Inspect at desktop and phone widths.
3. Reconnect and explicitly **Sync saved changes**. Concurrent server changes
   show local/current-server versions and require a confirmed choice. A second
   tab's stale editor is rejected while preserving its input. No automatic merge
   or background replay occurs. Signout/switching users removes pending work and
   locks other tabs; remote revocation cannot be detected until reconnect.
4. In online **Mail**, choose **Add invented examples**, opt into **Keep unfinished
   drafts in this browser**, and type a new composition or reply. Only authored
   fields are retained in a separate recovery buffer. Offline reload preserves
   them; reconnect/reload and return to Mail to recover them. The inbox and saved
   server draft bodies are not available after an offline reload. Nothing is
   submitted or sent automatically; review mailbox/recipient before explicit save.
   A stale tab cannot replace or clear another tab's newer recovery text; its
   editor stays open with a warning to copy it before reloading and reviewing.

The required browser lane runs this built demo against actual Chromium,
IndexedDB, Web Locks and the service worker, including offline cold reload,
reconnect, conflict review, two-tab stale edits/purge and authored recovery.
It proves the isolated build, not production Vinext/Firebase offline bootstrap,
browser encryption/eviction guarantees, native devices or live provider access.
Browsers without IndexedDB/Web Locks retain the online workspace; saved mode is
unavailable. Browser data is origin-local and is not application-encrypted.

## Calendar file walkthrough

Use the built personal demo above (`npm run dev:personal-workspace -- --port 5191`).
In online Calendar, the **Calendar files** section downloads the selected
Calendar’s current blocks and scheduled Tasks as `openjob-calendar.ics`.
Select that file to inspect its titles/UTC intervals, then explicitly confirm
import. Unchanged events are skipped; a changed duplicate UID conflicts without
overwriting Tasks or blocks. Import a supported file with a new UID to add a
standalone block, then reload to verify it persisted. Another server edit after
preview requires refreshed review. The same capabilities are available through
the installed CLI and authenticated API, including named Calendar agent scopes;
see [file exchange](PERSONAL_WORKSPACE.md#calendar-file-exchange).

This is real local file/API behavior with synthetic identities and fake Firestore
in the demo, not provider synchronization. Imports accept only the documented
50-event/16-KiB timed-UTC subset; complex provider files with recurrence,
time zones, invitations or unsupported properties are rejected explicitly.
External calendar application imports and native file pickers are unverified.
The original saved fixture launcher is preserved separately and has no new file
controls. Incoming Mail remains invented; actual sends and OAuth grants remain
disabled. Native device/live provider/database acceptance and production Firebase
offline bootstrap remain outstanding. No hosted/share preview is available.
