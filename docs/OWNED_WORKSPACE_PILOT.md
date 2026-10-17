# Owner-only Workspace pilot

WLK325 implements a bounded first R10/R11/R20 milestone under the confirmed
Workspace model. One synthetic signed-in identity creates Work and Family, each
with its own opaque Workspace ID, one human owner, Task-space ID and Calendar ID.
The app creates, edits, completes and plans work in the selected context without
Mail or a provider. Current Personal work, offline caches and legacy Groups remain
separate and unchanged.

```sh
npm run dev:owned-workspaces -- --port 5202 --state-file /tmp/openjob-owned-pilot.json
```

Use a fresh state path for a new fixture. Reusing the same file reopens saved work.
The launcher binds loopback only, labels Alex/Sam as synthetic identities, uses
fake identity/Firestore transports, and stores a private local fixture file (not
encrypted). It locks its state file; stop its owning process before restart. Do
not reset/delete old shared state or remove another process's lock. Failed saves
retain the prior in-memory state; uncertain local filesystem outcomes still require
restart/readback. This is development fixture storage, not a backup service.

Open Alex's fixture identity, create Work, add a Task and notes, schedule it and
open its linked Task from Calendar. Create Family and add different work. Switch
between them: lists/planning and unfinished editors stay in their Workspace.
The URL fragment selects an owned Workspace for reload and Back/Forward. Changing
fixture identity discards the previous identity's in-memory editors and clears the
selected context. Sam sees only Sam's Workspace list; direct foreign requests fail.

## Implementation boundary

`db/owned-workspaces.ts` uses existing Firestore REST/CAS and active-user fences.
Creation atomically records the owner catalog and Workspace record. Each Workspace
record contains metadata and its own Task/Calendar projection, independent of the
Personal Mail aggregate. Task and block updates commit together through the
existing pure Task/Calendar engine; Mail, source links and agent commands cannot
enter this repository. The reused engine's existing `offline_` item ID spelling
is an opaque ID format, not a claim this app supports offline edits.

All repository calls qualify both current User and Workspace ID. The API derives
the human from the verified session, rejects agent credentials, bounds command
input and rechecks the identity before returning. The client checks returned
owner/context, aborts the identity's request lease on unmount, keeps opened
Workspace editors mounted separately, and disables switching during mutations.
Responses never populate a different Workspace editor.

The local fixture composes the real repository/API/component source at:

- `GET/POST /api/owned-workspaces`: list owned metadata / create `{name}`.
- `GET /api/owned-workspaces/{workspaceId}`: exact metadata and work projection.
- `POST /api/owned-workspaces/{workspaceId}/commands`: existing owned Task/Calendar
  commands; current conflict-checked time suggestions reuse existing availability.

These original fixture endpoints remain local. WLK328 composes the same operations
under the normal `/api/v1/workspaces` prefix behind the admission gate below.
The existing `/api/v1/workspace` Personal contract is unchanged. No hosted
database/index/rules/config changes occur.

## Remaining foundation gates

This does not complete R10/R11/R12/R20. Retained Personal mapping and normal
composition are implemented below; actual pilot admission remains unconfigured. Invitations/membership sharing,
resource grants, owner transfer/departure, Mail, Connections, agents, offline
Workspace sync and native UI are unavailable. Owner-only Tasks/Calendar do not
imply authority over restricted Mail or provider credentials. No fake controls
suggest those features work. PR94 simulator evidence remains the native checkpoint;
this browser/repository slice adds no native runtime or release proof.

## Retained Personal context and identity policy

WLK326 adds **Open existing Personal context** to the same fixture shell. This
explicit action creates one durable `v1PersonalWorkspaceContexts/{userId}` reference,
with opaque Workspace/Task-space/Calendar resource IDs. The existing User ID and
`v1PersonalWorkspaces/{userId}` remain authoritative. It does not create another
User, link a Sign-in Method, copy/rekey Tasks or Mail, rewrite offline caches or
create grants. Concurrent/repeated mapping requests return the same reference.

The context adapter reads a Task/Calendar projection from the retained Personal
store. Calendar resource IDs are translated at the API boundary; Task/event IDs,
notes and canonical planning links remain unchanged. The same saved work is visible
through the old Personal API and this mapped context. Updates use the old Personal
command handler and preserve Mail, authored drafts, grants and sync receipts.
Source Mail references are excluded from this Tasks/Calendar surface. Wrong
Workspace/Calendar/item IDs, Mail/source/grant commands and agent credentials fail.
The current adapter supports the existing single canonical Personal Calendar; an
unfamiliar retained shape fails without replacing or dropping any data.

This reference is listed next to independent Work/Family Workspaces; it is not
copied into their records or catalogs. The existing independent-context repository
stays unchanged. The fixture also composes the existing `/api/v1/workspace` handler
locally so both API paths can verify continuity. Normal composition is described below.

## Normal application composition (WLK328)

`/workspaces` reuses the existing Personal app's Firebase auth observer, sign-in,
sign-out and private cleanup/request lease. The existing Personal navigation links
to it. Both normal Cloudflare and portable Node runtimes compose the real owned
repository and retained Personal context adapter through `createWorkspacePilotRuntime`.
The portable service also serves `/workspaces`; no hosted preview is required.

**All actual runtime admission is unset.** An authenticated existing User receives
503 `workspace_pilot_unconfigured`, before any Workspace storage call. The page
explains that the pilot is unconfigured and links back to existing Personal work.
This source does not add an environment variable, configure a real selection or
activate any real access. Existing Personal/offline/Groups behavior is retained.

The trusted server composition accepts one exact existing `userId`, `provider`
(Google/Apple) and Firebase `uid` binding, copied at construction. Later owner-assisted
onboarding must explicitly select that binding. It is not an identity classifier.
The session must resolve through the existing binding store to that same active
User on every request. Another linked Sign-in Method on the same User is denied;
linking does not implicitly widen pilot admission. Unknown identities are not
created. Agents, browser claims/headers, email/domain matching and owner IDs in
request bodies cannot supply admission. Mutation admission is rechecked after
reading the body, and current identity is checked before returning data. Workspace,
Calendar and item isolation still use the existing repository/API checks.

Bounded pilot routes, subject to the gate:

- `GET /api/v1/workspaces/session`: existing owner User plus
  `assurance: limited_owner_pilot`, `employerIsolation: false`.
- `GET/POST /api/v1/workspaces`: list owned metadata / create `{name}`.
- `POST /api/v1/workspaces/personal-context`: exact `{}` maps retained Personal.
- `GET /api/v1/workspaces/{workspaceId}` and
  `POST /api/v1/workspaces/{workspaceId}/commands`: selected Task/Calendar work.

These compose the existing typed owned-Workspace contract; they do not represent
adopted general onboarding, invitation or agent APIs. The fixture's historical
`/eligibility` policy status is not exposed through the normal prefix.

## Identity policy and authority

C12/C13 permit bounded engineering defaults for Shane's owner-first pilot. Using
his existing stable User and an explicitly selected existing binding for later
onboarding is an engineering recommendation, **not owner acceptance of D06**.
D06 independent-control mechanics remain Proposed. Limited admission neither
classifies a binding as personally independent nor guarantees employer isolation.
WLK327 owns the future policy before employer-isolation/general onboarding claims.
A known company-controlled binding or a current requirement for independent
recovery remains a consequential owner choice. No control-evidence records,
classification system, new identity or real account settings are added.

Actual account/setup/credential/provider permissions remain separate; the two
unanswered WLK318 approvals are not retried. No publication, deployment, real
provider connection, correspondence, downloads or native distribution is performed.

## Reproduce the normal composition with synthetic identities

Run the command above with a fresh owned state file and open `/pilot`. This harness
injects synthetic signed Alex/Sam sessions into the **normal** Personal auth observer
and Workspace session component. It composes the same server runtime as both actual
runtimes, selecting only synthetic Alex's exact User/Google/UID. Sam is denied and
switching identity clears Alex's mounted contexts/editors. The original `/` fixture
remains available for wider two-owner repository exploration. Both are labeled
synthetic, use fake Firestore and never connect a real account or provider.

Focused proof: `node --test tests/workspace-pilot.test.mjs
 tests/owned-workspaces.test.mjs tests/personal-workspace-context.test.mjs
 tests/workspace-availability.test.mjs` (run on one shell line). This covers signed
normal runtime composition, retained Personal authority, Task/Calendar writes,
linked-binding/foreign-context/agent denial, unset admission without storage,
revoked binding before mutation/disclosure and actual portable router fail-closed.
Browser proof covers mapping/create/notes/schedule/linked completion, retained
per-Workspace editors and normal auth-observer identity-switch denial.
