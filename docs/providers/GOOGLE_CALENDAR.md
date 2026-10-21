# Google Calendar integration — R40 in progress

The backend checkpoint implements a provider boundary, durable remote planning and
canonical pilot API source. Only tests compose the service with an inseparable
invented credential/fake HTTP provider. Normal/portable runtimes configure no
Calendar service. The development launcher, OpenAPI, CLI and web flow remain
unfinished. R40 is not delivered and no real Calendar access is authorized here.

The adapter requires explicit owner/Workspace/account/connection/subject/revision
bindings and a concrete reviewed Calendar-ID set. `primary` is not a frozen
resource identity. Credential resolution and transport are injected; execution
approval defaults to false. Current rights and expiry are checked before and after
reads. Existing Google Mail consent cannot authorize Calendar.

Calendar lists page at50 rows and expose only bound resources. Event reads use a
window of at most31 days, UTC response timezone and provider recurrence expansion.
Cursors bind owner, Workspace, account, binding revision, calendar, window and zone
before HTTP. Timed instants retain IANA zones; all-day dates retain exclusive ends.
Moved occurrences keep their original start and series identity. Cancelled records
are omitted. Unspecified ends remain null. Collection access must still permit
details after CalendarList access. Events stay outside the offline projection.

Busy-only views use exact-calendar FreeBusy without fetching event details. Missing,
failed, per-calendar-error, mismatched or expired results never mean free. Output
contains only clipped busy intervals and observation/expiry. Freshness starts before
asynchronous work and is checked again after final Workspace ownership checks.
Availability is an observation, not an atomic reservation or an authority lease.
Scope families for listing, events, FreeBusy and writing are checked separately.
In particular, calendar.events alone does not authorize FreeBusy.

Managed writes support timed, ordinary, nonrecurring blocks without attendees,
meetings, attachments or other unsupported features. The derived client event ID
and private origin are frozen. A full current event GET verifies the narrow shape
before PATCH or DELETE. Both use the original reviewed If-Match ETag; conflicts
require review. PATCH sends only reviewed summary/start/end. Create disables default
reminders and supplies no attendees, meeting data, description or location. Requests
use sendUpdates=none; this is not a promise that Google can never send email.
Known rejection is distinct from unknown dispatch. No write automatically retries.

The shared durable engine persists execution before dispatch. Calendar uses separate
v1FixtureCalendar Operation/Payload/Job/Index records and cop_ IDs; reply.simulate
keeps its existing schema, namespace and sim_ receipts. Calendar's Task reservation
and initial durable intent commit atomically against the Workspace version. All
local/agent/offline writes preserve the reservation. The final effect guard checks
current authority, ownership, claim, lease and intent after provider preflight.

Definite create rejections release the reservation; duplicate-ID conflicts require
review. Queued/executing/unknown links stay reserved. Explicit review reads current
provider state and updates the link without rewriting operation history or replaying
its write. An exact cancelled tombstone proves deletion; 404 remains ambiguous.
Successful explicit delete releases the relationship. Local completion/title edits
never write remotely. Safe explicit detach while leaving a provider event is still
a required next step before UI delivery.

Source routes under `/api/v1/workspaces/{workspaceId}`:

- GET `provider-calendars` (accountId, optional cursor).
- GET `provider-calendars/events` (accountId, calendarId, start, end, optional cursor).
- GET `provider-calendars/availability` (accountId, calendarId, start, end).
- GET `planning`; POST `planning/{taskId}/review` with an empty body.
- GET/POST `calendar-operations`; GET `calendar-operations/{operationId}`.
- POST `calendar-operations/{operationId}/run-fixture` with an empty body.

Every route requires current human pilot admission and owned Workspace authority.
Existing local calendar:write agent grants acquire no provider write rights.
Enqueue returns accepted intent, not completion. Operation views omit frozen content,
private binding and request/payload hashes. New OpenAPI/CLI/UI contracts and actual
browser acceptance are pending; see w.md for the exact source/evidence checkpoint.

Primary protocol references:

- [CalendarList](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList)
  and [bounded listing](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
- [Event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
  and [event fields](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [FreeBusy](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
- [Event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert),
  [patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch),
  [deletion](https://developers.google.com/workspace/calendar/api/v3/reference/events/delete)
  and [ETag preconditions](https://developers.google.com/workspace/calendar/api/guides/version-resources)
