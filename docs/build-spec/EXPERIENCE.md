# Experience and interaction specification

**Proposed.** Use current OpenJob brand tokens/components and platform conventions. These screen contracts are enough to implement layout and behavior without new product interviews; they are not pixel-perfect approved mockups.

## Shell and routing

Persistent context selector: Personal or Company → Workspace. Main destinations: Today, Mail, Tasks, Calendar, Agents. Connections and Settings are reachable without abandoning the selected module. Company settings exist only for permitted Company actions. On narrow screens use native-friendly navigation while preserving destination names and context visibility. Keep legacy Groups discoverable as “Groups (existing)” until deliberately mapped; they are not Companies.

Proposed URL scope: `/workspaces/:workspaceId/{today|mail|tasks|calendar|agents|connections}`; selected item IDs live in route/query state so Back, Forward and copied links work. Context switch changes the route and clears transient selected objects/results; it does not retarget a draft. A user lacking the linked resource sees “Unavailable in this context” with no title/address leakage. Never quietly switch to a different owner to make a link resolve.

## Screen contracts

| Screen / IDs | Primary content and actions | States and guardrails |
|---|---|---|
| Start / OJ-I1, OJ-X1 | Sign in; establish eligible Personal context; accept pending invitation or create Company; optional Connect account | Continue with empty Tasks/Calendar without a provider. Example mode is a separate labeled choice. Failed identity proof retains invitation and gives actionable recovery |
| Context picker / OJ-I3 | Personal; active Company memberships with role; accessible workspaces | Suspended/departed context is unavailable. Draft indicator names origin. No combined company-wide inbox or cross-company search |
| Today / OJ-X1, OJ-T3, OJ-K3 | Selected context/date; overdue/due/unscheduled open tasks; calendar agenda; connection warnings; one-click task/open-source/plan | Authorized projection only. No content duplication or new task state. Empty day offers Create task/Calendar block/Connect account |
| Mail / OJ-M1 | Authorized account/folder picker, paged message list, read pane, search, source-linked task action | Persistent account/provider label and sync timestamp. Loading differs from empty; partial failure names affected account. Unsupported folders/search explain limits |
| Compose / OJ-M2–M4 | New/reply/reply-all, To/Cc/Bcc, subject, text, chosen From identity, selected attachments, Save draft and Send | From fixed to verified permitted account/alias. Context and identity repeated beside Send. Review recipient changes on reply-all. Close preserves draft; discard is explicit |
| Tasks / OJ-T1–T3 | Open/completed filters, literal search, due/assignee/priority filters; details, notes, source, plan/complete/reopen | Source hidden unless separately allowed. Private source is never previewed in shared list. Concurrent edit keeps local text for comparison, no silent overwrite |
| Plan task / OJ-T3, OJ-K1–K3 | Destination calendar, time zone, start/end or duration, available-slot suggestions, exact pending change preview | OpenJob vs external target clearly labeled. Stale/unreadable calendars disclaim incomplete availability. Recheck before commit; explicit conflict override only when permitted |
| Calendar / OJ-K1–K4 | Day/week/agenda, calendar toggles, timezone, event details, create/edit; import/export | All-day separate from timed; recurrent provider occurrences read-only if write unsupported. Busy-only grants reveal no event title/attendees. Export names data boundary |
| Agents / OJ-A1–A3 | Agent list/controller/state; create identity; grant wizard; resource and operation selection; effective access; activity; revoke | No check-all default. Read/draft/send/delete separate. Grant preview names source authority/expiry. Credential shown once through secure delivery; later view cannot reveal it |
| Connections / OJ-C1–C3 | Ownership, provider identity, operations, consent status, freshness, reconnect/disable/disconnect | Missing runtime setup is explicit and blocks fake Connect. Consent canceled never appears connected. Disable first stops work; upstream cleanup pending separately |
| Company settings / OJ-I2–I5 | Company basics, members/invitations, roles, workspace/resource access, ownership transfer, suspended/departed members | Owner-only owner assignment/transfer; Admin cannot promote self to Owner or read private Mail. Invite preview names initial visible resources |
| Activity / OJ-A3, OJ-X4 | Actor, operation, context/resource, sending identity, timestamps, outcome and repair action | Redacted titles/body by default; users only see records for resources/actions they may inspect. “Provider accepted” does not mean delivered/read |

## Critical interaction flows

### Connect an account

1. Select Personal/Company workspace and show who owns the connection and who can access content
2. Select provider and only implemented requested operations; show read and write consent separately
3. Begin server-bound consent with current context; redirect can be canceled or interrupted
4. Callback verifies session/owner/context/state/provider identity. Show the actual upstream account before completion
5. Create active connection only after durable credential/metadata binding; initial sync begins with visible state
6. Show actual Inbox results or explicit empty/blocked outcome. Never insert examples into a live mailbox

Account switching during consent must not change the original destination. If that membership is lost, callback terminates without activating access and cleanup runs. A provider account already bound in the same workspace is reconnected through its existing connection ID; it is not duplicated.

### Mail → Task → Calendar → reply

Create Task defaults to the current context's private or explicitly selected task space. Prefill an editable title only; explain when sharing the title/notes could reveal source information. Do not copy body, attachments or a mailbox URL into shared task payloads. Source metadata lives in a separately authorized relation. Offer Open existing task when one is already linked, or Create another explicitly.

Plan opens a preview showing task, calendar, identity, time and ownership. Saving to OpenJob is one transaction; saving externally returns operation status and never pretends a local block is a provider event. Completing Task changes Task state only. “Reply” returns to the original permitted message and correct account with draft preserved. Sending is a distinct explicit action.

### Grant an agent

Choose Personal or Company controller → name → selected resources → selected operations → expiry → review effective permissions. A mailbox set is a saved selection, not an automatic entitlement to future accounts. Grant stores its reviewed resource membership/version; adding a mailbox requires reviewed grant expansion. Default all writes off. Keep current 24-hour personal token lifetime initially; no silent long-lived refresh credentials. Company agent managers do not automatically grant their personal accounts. Revoke immediately changes UI to revoked and blocks newly dispatched work; in-flight/previously completed actions remain visibly distinct.

### Company departure

Admin/Owner reviews subject's Company memberships/grants, owned control responsibilities and tasks needing reassignment. Suspension blocks access immediately and is reversible by authorized action. Departure ends membership; company records remain. Last Owner is blocked until successor accepts ownership. Provider access may need renewed consent by a new controller; show “reconnect required” rather than silently reusing departed-user tokens. Personal/B are untouched. Current draft from departed A is locked and is not copied to Personal automatically.

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

R52 adds per-context offline settings with mailbox/calendar selection, cached range/size, storage protection, last sync and clear-cache control. Company policy limits choices. A denied queued Company edit opens an explicit recovery state tied to its original context; it is never relabeled Personal. R53 adapts all these flows to native controls. R54 adds installed-app account/profile/version/channel and update-available notice; “update” gives the explicit npm action and restart guidance rather than silently replacing the running app.
