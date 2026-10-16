# Experience and interaction specification

**Detailed screens Proposed under the [owner-confirmed core](../ARCHITECTURE_ALIGNMENT.md).** Use current OpenJob brand tokens/components and platform conventions. These screen contracts are enough to implement layout and behavior without new product interviews; they are not pixel-perfect approved mockups.

## Shell and routing

Home is the human overview across authorized Workspaces, with labeled tasks,
events and unread counts. Selecting work enters its Workspace. A single Workspace
picker lists Personal, company and family contexts; a company is itself a Workspace,
not an extra selector layer. Main Workspace destinations: Today, Mail, Tasks,
Calendar, Agents. Account-level Connections and Settings remain reachable.
Workspace settings require appropriate administration rights. Legacy Task Groups
stay discoverable until deliberately mapped; they are not internal member groups.

Proposed routes: `/home`, `/connections`, and
`/workspaces/:workspaceId/{today|mail|tasks|calendar|agents|settings}`. Connection
setup may link from a Workspace but opens central management with explicit resource
destination/authority. Selected IDs support Back/Forward and deep links. Context
switch clears transient results, never retargets drafts/consent/jobs. Inaccessible
links say “Unavailable in this context” without title/address leakage. Home grants
no unified Mail search, agent aggregation or additional resource access.

## Screen contracts

| Screen / IDs | Primary content and actions | States and guardrails |
|---|---|---|
| Start / OJ-I1, OJ-X1 | Sign in; establish eligible Personal context; accept pending invitation or create Workspace; optional Connect account | Continue with empty Tasks/Calendar without a provider. Example mode is a separate labeled choice. Failed identity proof retains invitation and gives actionable recovery |
| Context picker / OJ-I3 | Accessible Workspaces, membership and accountable owner; no Company hierarchy | Suspended/departed context is unavailable. Draft indicator names origin. No blanket unified Mail or cross-Workspace search |
| Home / OJ-X1 | Authorized cross-Workspace tasks/events/unread counts, labeled with Workspace; open item into its context | No inaccessible metadata or content; actions enter explicit Workspace; revocation removes stale projection access |
| Today / OJ-X1, OJ-T3, OJ-K3 | Selected context/date; overdue/due/unscheduled open tasks; calendar agenda; connection warnings; one-click task/open-source/plan | Authorized projection only. No content duplication or new task state. Empty day offers Create task/Calendar block/Connect account |
| Mail / OJ-M1 | Authorized account/folder picker, paged message list, read pane, search, source-linked task action | Persistent account/provider label and sync timestamp. Loading differs from empty; partial failure names affected account. Unsupported folders/search explain limits |
| Compose / OJ-M2–M4 | New/reply/reply-all, To/Cc/Bcc, subject, text, chosen From identity, selected attachments, Save draft and Send | From fixed to verified permitted account/alias. Context and identity repeated beside Send. Review recipient changes on reply-all. Close preserves draft; discard is explicit |
| Tasks / OJ-T1–T3 | Open/completed filters, literal search, due/assignee/priority filters; details, notes, source, plan/complete/reopen | Source hidden unless separately allowed. Private source is never previewed in shared list. Concurrent edit keeps local text for comparison, no silent overwrite |
| Plan task / OJ-T3, OJ-K1–K3 | Destination calendar, time zone, start/end or duration, available-slot suggestions, exact pending change preview | OpenJob vs external target clearly labeled. Stale/unreadable calendars disclaim incomplete availability. Recheck before commit; explicit conflict override only when permitted |
| Calendar / OJ-K1–K4 | Day/week/agenda, calendar toggles, timezone, event details, create/edit; import/export | All-day separate from timed; recurrent provider occurrences read-only if write unsupported. Busy-only grants reveal no event title/attendees. Export names data boundary |
| Agents / OJ-A1–A3 | Connected external agent identities and their selected-Workspace grants; connect identity; grant wizard; resource and operation selection; effective access; activity; revoke | No check-all default. Read/draft/send/delete separate. Grant preview names source authority/expiry. No hosted/persistent agent runtime. Per-Workspace revocation leaves unrelated grants intact; credential UX remains Proposed |
| Connections (account-level) / OJ-C1–C3 | Only manageable provider bindings across Workspaces; resource homes, provider identity, operations, status, reconnect/disable/disconnect | Central screen grants no global access; preview affected resource homes and recheck management authority. Missing runtime setup blocks fake Connect. Consent canceled never appears connected. Disable first stops work; upstream cleanup pending separately |
| Workspace settings / OJ-I2–I5 | Workspace basics, members/invitations, internal groups/permission sets, explicit resource access, ownership transfer, suspended/departed members | Exactly one human owner; recipient accepts transfer before prior owner leaves. Role presets remain Proposed and do not grant private Mail. Invite preview names initial visible resources |
| Activity / OJ-A3, OJ-X4 | Actor, operation, context/resource, sending identity, timestamps, outcome and repair action | Redacted titles/body by default; users only see records for resources/actions they may inspect. “Provider accepted” does not mean delivered/read |

## Critical interaction flows

### Connect an account

1. Open account-level Connections; list only bindings the human may manage
2. Choose provider and implemented requested operations; distinguish Mail consent from sign-in
3. Show exposed mailbox/calendar resources and chosen home Workspace for each, with restricted/shared access preview
4. Bind consent/state to the initiating human and approved destinations; navigation cannot retarget it
5. Verify provider identity and durable authorized resource bindings before activation; fail closed if destination authority changed
6. Show actual results or honest empty/blocked state; no example data in live accounts

Proposed binding details and reconnect/disconnect impact across resources are
finished in R31, not inferred from central UI placement. Existing authorized
binding/resource IDs should reconnect without duplicate accounts; no default master
Workspace, implicit credential sharing or automatic exposure of sibling resources.

### Mail → Task → Calendar → reply

Create Task defaults to the current context's private or explicitly selected task space. Prefill an editable title only; explain when sharing the title/notes could reveal source information. Do not copy body, attachments or a mailbox URL into shared task payloads. Source metadata lives in a separately authorized relation. Offer Open existing task when one is already linked, or Create another explicitly.

Plan opens a preview showing task, calendar, identity, time and ownership. Saving to OpenJob is one transaction; saving externally returns operation status and never pretends a local block is a provider event. Completing Task changes Task state only. “Reply” returns to the original permitted message and correct account with draft preserved. Sending is a distinct explicit action.

### Grant an agent

Select an externally connected agent identity (or connect one) → choose Workspace
→ selected resources/operations → review current delegating rights and policy →
expiry → confirm. The same identity can have independent grants elsewhere; never
merge them into all-Workspace access. No agent process is provisioned or hosted.
A member may delegate only a subset of current access where policy permits it.

Proposed mailbox sets save a reviewed resource snapshot/version; adding a mailbox
requires reviewed grant expansion. Default writes off and the existing 24-hour
credential lifetime remain proposed initial details. Revoking this Workspace grant
blocks new dispatch there and preserves other independent grants. In-flight and
completed effects remain visibly distinct; disconnecting the external identity
entirely is a separate action with a preview of affected grants.

### Workspace departure and ownership transfer

An authorized human reviews membership/grants, task reassignment and credential
binding consequences. Suspension denies access; departure ends membership. The
single owner initiates transfer to an eligible member and remains accountable until
acceptance completes; departure before transfer is blocked. Workspace resources
remain attached. Provider authority may need renewed consent: never reassign a
departed user's tokens silently. Personal and other Workspaces remain unaffected.
Drafts from departed A are locked, not copied into Personal. Derived A agent grants
stop, while the external identity and unrelated B grants remain independently valid.

## State vocabulary and recovery

| State | What user sees | Allowed next action |
|---|---|---|
| Loading | Skeleton/progress tied to specific query | Cancel/navigate; repeat does not duplicate writes |
| Empty | Genuine no-result state, active filter/context visible | Clear filter/create/connect |
| Unsupported | Operation unavailable and capability reason | Use supported OpenJob alternative or provider link; no fake success |
| Offline | Last-known timestamp, local authored work/pending edits | Edit supported local Tasks/blocks/drafts; no provider sending/consent |
| Sync pending | Saved locally or service operation queued, explicitly distinguished | Inspect/cancel before dispatch where supported |
| Stale | Last confirmed provider read time | Refresh/reconnect; no “free” assertion from missing Calendar data |
| Conflict | Both base/current revision and local changes, safe diff | Keep current or explicitly reapply reviewed edit |
| Reconnect required | Scope/token/account issue without secrets | Reauthorize same connection/identity or disconnect |
| Rejected operation | No confirmed effect, safe provider error | Correct request; retry only if effect was definitively rejected |
| Unknown external outcome | May have executed; stable operation ID | Reconcile/status check; human review before any deliberate new send |
| Revoked/departed | Access ended; no source content | Return to permitted context; previously read content cannot be recalled |
| Cleanup pending | Local access disabled; upstream revocation/erasure incomplete | Inspect status, retry cleanup when allowed, no success claim yet |

## Interaction acceptance checklist

Test repeated clicks, Back/Forward, deep links, reload, Cancel/Close/reopen, context switch mid-compose/consent, membership loss while open, offline reconnect, concurrent edits, partial multi-account failure, slow upload, MIME parsing failure, ambiguous send and revoked queued operations. Keyboard order, semantic labels, contrast, screen-reader announcements, error focus and touch targets follow existing brand/native gates. Never force a person to use an AI agent to finish these flows.

## Full-product extension interactions

R51 adds an attendee section to supported provider-event editing with explicit organizer, recipients, availability and “send invitations/update/cancellation” preview. Saving an OpenJob block never sends invitations. RSVP shows the provider invitation and whether the response notifies the organizer. Series editing starts with “this occurrence” or “entire series,” previews the effect and preserves exceptions; “this and following” is offered only when faithfully supported. New local recurring blocks can use the same recurrence UI without external notification. A Task can link to one specific occurrence; recurrence does not create recurring Tasks automatically.

R52 adds per-context offline settings with mailbox/calendar selection, cached range/size, storage protection, last sync and clear-cache control. Workspace policy limits choices. A denied queued shared-Workspace edit opens an explicit recovery state tied to its original context; it is never relabeled Personal. R53 adapts all these flows to native controls. R54 adds installed-app account/profile/version/channel and update-available notice; “update” gives the explicit npm action and restart guidance rather than silently replacing the running app.
