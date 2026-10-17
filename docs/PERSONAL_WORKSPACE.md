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

The Mail preview reads synthetic examples and explicitly labeled mock Gmail/Outlook/IMAP
protocol accounts through the authenticated provider-preview API and existing CLI.
In the cloud personal demo, select **Mock Outlook protocol · Alex** to read mapped
Graph text/folder pages, then create a title-only Task. These are invented HTTP
responses, not a live Microsoft connection. **Mock IMAP protocol · Alex** reads
a bounded Inbox through invented read-only protocol bytes; UIDVALIDITY changes
invalidate its old cursor, and Refresh preview starts a new view. Neither mode
implements a live provider login. Consent-required/revoked accounts
return no Mail; switching to Sam exposes only Sam's accounts. Account-qualified
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
clear it. Cached Tasks and Calendar can be edited offline under the last protected owner; Mail and online operations require session restoration.
Agents shows effective scopes/resources, expiry, activity and confirmed revoke.
Use the existing CLI for agent issuance; no secret is displayed in the app.

Mail and agent access remain online-only. An uncertain ordinary Mail request is never replayed automatically. Native controller, HTTP and component checks do not prove device keyboards, backgrounding or native storage. Cross-platform device/release gates in ADR0017 still apply.

## Native offline Tasks and Calendar

The saved-on-device workspace keeps only personal Tasks and Calendar in a
separate SQLCipher database in the app document directory, with its encryption
key in the existing device-only Keychain/SecureStore boundary. Mail, source
message/account references, drafts, grants and credentials are excluded.
**Online Mail and linked work** retains the complete online source-Mail journey.
Returning to saved Tasks/Calendar refreshes safely; pending local work is never
silently discarded. The Group cache retains its separate existing schema.

1. Confirm a session and Refresh from server once. Disconnect: edit/create/complete,
   schedule/unschedule/delete Tasks or create/edit/delete manual Calendar blocks.
   **Pending · saved on device** means the encrypted write completed. A storage
   failure preserves the previous saved work and unfinished editor.
2. Reopen offline under that same protected owner, including when no Group was
   ever opened. Restore the session to reconnect, then choose **Sync saved changes**.
   The atomic batch requires the last confirmed Tasks/Calendar revision.
3. If another client changed those records, **Conflict · review required** keeps
   the local proposal and shows current server work. Compare both versions.
   Explicitly discard local work or confirm replacing server Tasks/Calendar with
   the reviewed local version. A further server edit requires another review.

Sync receipts bind the owner, operation ID and complete payload. Retrying a lost
acknowledgement cannot duplicate that batch. Queued newer local edits survive
an older acknowledgement. Ambiguous attempted batches must be checked with the
same operation before editing them again. New batches expire after 24 hours;
expired unresolved work requires review rather than silent replay. Receipts are
retained beyond that window; capacity errors preserve pending work. Whole-domain
conflicts are conservative: there is no automatic field merge. Source-Mail
provenance stays server-owned and is preserved on surviving Tasks.

Signing out/switching users or revocation/deletion purges private local state,
including pending work. Mail, agent credentials, CLI offline editing,
background sync and provider Calendar writes are outside this slice. Real
native durability, encryption bridges, rendering and keyboard behavior remain
device acceptance work; no release is implied.

The human-only authenticated sync endpoint is
`GET /api/v1/workspace/task-calendar-sync` → `{data:{revision,projection}}`;
`POST` accepts `{operationId,baseRevision,expiresAt,projection}` and acknowledges
`{data:{operationId,revision}}`. Personal agent credentials cannot replace this
domain. Existing command/snapshot endpoints remain unchanged.

## Browser saved Tasks and Calendar

The authenticated web workspace offers **Saved Tasks and Calendar** separately
from the complete online Mail/source workflow. Refresh once while verified, then
edit Tasks and Calendar offline. Pending batches use the same shared controller,
revision checks and human-only API as native. Explicit sync and confirmed
whole-domain conflict choices preserve uncertain operations; competing tabs use
Web Locks and reject stale editor proposals without losing input.

IndexedDB stores a strict Tasks/Calendar projection after transaction completion.
Firebase UID+tenant is bound online to the verified OpenJob owner; restoration
never chooses a last owner. Mail/source references, tokens and grants are excluded.
Signout/switch/deletion/revocation purge private work and fence other tabs. Remote
revocation is unverifiable while offline. Browser storage is not app-encrypted;
eviction/private-mode restrictions can prevent durability. Unsupported storage
keeps saved mode unavailable while preserving the online workflow.

**Prepare offline page** explicitly caches bounded public code/assets using the
existing notification service worker, without requesting notification permission.
API/auth/Bearer responses are never cached. Full offline reload is verified in
the [built isolated demo](WORKSPACE_DEMO.md#fresh-checkout-browser-offline-demo);
production Vinext/Firebase offline bootstrap remains unverified.

Mail optionally retains only authored unfinished composition/reply text in a
separate owner-bound browser buffer. It survives offline reload and restores
when online Mail loads again; no offline inbox or automatic submit/send is
provided. Explicit save clears that authored buffer without clearing newer
typing. Competing tabs cannot overwrite or clear a newer recovery buffer: the
stale tab keeps its editor text and asks you to copy it before reloading to review
the saved version. Review the restored mailbox, recipient and content before saving.

## Calendar file exchange

In online **Calendar → Calendar files**, select a Calendar and choose **Download
calendar file** to save its currently loaded blocks and scheduled Tasks as
`openjob-calendar.ics`. Refresh first to include newer server work. Export contains
only opaque stable UIDs, UTC intervals and titles; it excludes Mail/source links,
account/owner IDs, descriptions, agents and credentials. A calendar application
can read the file without OpenJob provider credentials; importing into an external
service is a separate user action and is not exercised by cloud tests.

Choose a local `.ics` file to preview its events and target Calendar. Nothing is
uploaded until **Import reviewed events → Confirm calendar import**. Imported
events become standalone OpenJob blocks. They never create/update Tasks, copy
Mail links, send invitations or write an external calendar. The server atomically
checks the reviewed Calendar revision. Newer server work requires another preview;
an existing UID with different title/times conflicts with no partial import.
Unchanged reimports and retries are skipped durably, including after restart.
Copies into a different Calendar have separate identities.

The first subset is limited to 50 events and 16 KiB of valid UTF-8, with whole-second
timestamps (nonzero fractional seconds are rejected). It accepts
VCALENDAR VERSION2.0/PRODID and VEVENT UID/SUMMARY/DTSTAMP/DTSTART/DTEND with explicit
UTC times. Unsupported recurrence, floating/local/TZID/all-day time, invitations,
alarms, URLs, attachments, properties or components are rejected. It does not
silently flatten a complex provider export. OpenJob exports use CRLF, escaped
TEXT and UTF-8-safe folding under [RFC5545](https://www.rfc-editor.org/rfc/rfc5545.html).
Files stay local during browser preview.

The existing CLI provides the same authenticated workflow:

```sh
openjob workspace calendar export --calendar personal --file calendar.ics
openjob workspace calendar import --calendar personal --file calendar.ics --dry-run
openjob workspace calendar import --calendar personal --file calendar.ics
```

Import displays the target/events and asks for confirmation; `--yes` explicitly
authorizes an unattended import. Export writes the raw file atomically and refuses
to replace an existing path. Personal agents need `calendar:read` on the named
Calendar for export and both `calendar:read`/`calendar:write` for import. Revoked,
expired, foreign or wrong-resource grants deny. No human-session fallback occurs.
The API exposes authenticated `GET /api/v1/workspace/calendar-export?calendarId=personal`
and `calendar.import` through the existing command endpoint. Native/offline file
controls are outside this slice; imported blocks enter normal Task/Calendar sync.

## Find time for a Task

In Calendar, choose an open Task and the calendar to save its block on. Set
**Find after / Find before (UTC)** and **Minutes needed**, then choose **Find
open slots**. The finder checks all your saved OpenJob calendars, including
imported blocks, regardless of the Calendar display filter. It returns up to
12 non-overlapping suggestions in a window of at most seven days. Durations
are whole minutes from 5 to 480. It can suggest past time if your explicit window
includes it; it does not assume working hours or a local time zone.

Choose **Schedule …** to save one suggestion. Current saved blocks are checked
again during each database retry. If the time became occupied, your Task stays
unchanged: Refresh, then find time again. Moving a scheduled Task excludes only
its exact linked block and keeps one link. Completed Tasks must be reopened first.
Existing manual scheduling can still overlap blocks intentionally.

The same read calculation works in the existing authenticated human CLI:

```sh
openjob workspace availability --task TASK_ID \
  --schedule-start 2027-05-11T09:00:00Z \
  --schedule-end 2027-05-11T17:00:00Z --minutes 30 --format json
```

Submit a chosen slot using `openjob workspace command --input FILE`:

```json
{"type":"task.schedule-available","taskId":"TASK_ID","calendarId":"personal","start":"2027-05-11T09:00:00Z","end":"2027-05-11T09:30:00Z"}
```

A stale occupied slot returns `schedule_conflict` (HTTP409, CLI exit6). Availability
is advisory until the command succeeds. This flow requires a human session;
existing scoped agents keep their existing explicit scheduling operations and
cannot use this new operation. No new grant or provider capability is implied.
Live provider calendars, external booking and attendee availability are not
checked. In the packaged local prototype, identities remain synthetic and only
an explicit `--state-file` keeps saved work across restart.

## Personal Today

The Today navigation item shows saved Calendar blocks overlapping the browser-local day, open Tasks planned today and unscheduled open Tasks. It labels the browser timezone; no due/overdue status is inferred. Completed Tasks leave the open list while their Calendar history remains. Open an exact Task/block to continue in its existing module without replacing unfinished editor text; destination filters clear to reveal it. Calendar editors retain explicit UTC. Refresh reloads saved data; the date clock itself does not fetch new data. This is the current private Personal view, not a cross-Workspace Home or provider sync.

## Authored Task notes

Choose **Edit notes** on a Task to save optional plain text, up to20,000 Unicode
characters. Saving notes leaves its title and Calendar block unchanged. Empty notes
clear the saved field. Title edits, scheduling, completion and reopening preserve
notes. No Mail body is copied automatically, and Calendar files/activity contain no
notes. The app preserves unfinished note text during module navigation and failed
saves; opening another Task's notes asks before discarding an unfinished edit.
Unfinished note edits are not saved across page reload; use Save notes first.

Existing CLI JSON commands accept `{ "type": "task.notes", "taskId": "...",
"notes": "Authored context" }` through `openjob workspace command --input`.
The API/CLI command bound is256KiB, enough for valid20k-character JSON escaping;
per-field limits remain. Existing Task-write authorization applies. Foreign,
read-only and revoked agents cannot update notes; write-only responses stay minimal.

Explicit Saved Tasks and Calendar include authored notes while still excluding Mail
source metadata. Offline edits/reload/sync preserve them. Online saves enforce the
same projection capacity (300k serialized UTF-16 units and500k UTF-8 bytes, leaving
room inside512KiB sync requests); capacity failure retains the prior saved state
and editor input. Web/native conflict summaries expose notes for version review.
Native source validates/displays notes and shares the sync contract; native editing
UI/device behavior is not qualified by the source HTTP check.
