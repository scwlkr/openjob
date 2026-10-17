# Independent owner-only Workspace pilot

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

These are fixture-composed endpoints, not enabled production routes or a declared
public Workspace API rollout. No hosted database/index/rules/config changes occur.
The existing public `/api/v1/workspace` Personal contract is unchanged. This avoids
exposing multi-Workspace onboarding to real identities whose eligibility has not
been established.

## Remaining foundation gates

This does not complete R10/R11/R12/R20: retained real-Personal context mapping,
independent sign-in eligibility and normal app composition need a coherent next
slice before enabling real Workspace onboarding. Invitations/membership sharing,
resource grants, owner transfer/departure, Mail, Connections, agents, offline
Workspace sync and native UI are unavailable. Owner-only Tasks/Calendar do not
imply authority over restricted Mail or provider credentials. No fake controls
suggest those features work. PR94 simulator evidence remains the native checkpoint;
this browser/repository slice adds no native runtime or release proof.
