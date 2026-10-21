# Agents in an owned Workspace

P-WLK-6/R22, 20 October 2026: this owner-pilot slice lets an external agent use
reviewed Tasks and OpenJob Calendar resources in one independent Workspace.
The configured pilot must already admit that Workspace's human owner. The normal
runtime remains unconfigured; this document does not activate real-account access.
Retained Personal and Group agents keep their existing, separate contracts.

## Issue and use access

Open the Workspace in the app. Its URL contains the `wsp_` ID. A human snapshot
from `GET /api/v1/workspaces/{workspaceId}` contains its exact `taskSpaceId` and
`calendarId`. Review those IDs and the required operations before issuing access.
Set `private_token_path` to a new absolute file path in a private directory you
control. Use the existing signed-in CLI profile against the same configured API:

```sh
node cli/openjob.mjs workspace agent grant \
  --workspace "$workspace_id" \
  --name 'Planning assistant' \
  --scopes tasks:read,tasks:write,calendar:read,calendar:write \
  --resources "$task_space_id,$calendar_id" \
  --token-out "$private_token_path"
```

The output path must be new and private. The CLI saves the credential atomically
with mode 0600 and prints only grant metadata. Access expires after 24 hours.
Only its hash is stored by the service. If issuance or delivery is uncertain,
inspect the grant list and revoke the uncertain grant before issuing another;
mutations are never automatically retried.

Give the agent only its private credential file and explicit Workspace ID:

```sh
node cli/openjob.mjs workspace tasks \
  --workspace "$workspace_id" --agent-token-file "$private_token_path"

node cli/openjob.mjs workspace command \
  --workspace "$workspace_id" --agent-token-file "$private_token_path" \
  --input reviewed-command.json
```

The agent has no human-session refresh or fallback. A credential from another
Workspace, Personal or Group is rejected before a CLI request. `workspace snapshot`
returns only the granted readable families. Task-only reads omit Calendar links
and planning slots. Calendar-only reads omit Tasks and Task IDs; readable Calendar
blocks retain their own titles, including blocks originally planned from a Task.
Successful writes return only the operation and item ID, without a work snapshot.

Supported command types are `task.create`, `task.update`, `task.notes`,
`task.complete`, `task.delete`, `task.schedule`, `task.unschedule`,
`calendar.create`, `calendar.update` and `calendar.delete`. See the CLI help and
[OpenAPI contract](../openapi/openapi.yaml) for exact fields. Notes require
`expectedNotes`, the value being replaced. Scheduling a Task, changing a linked
Task title/deleting/unplanning it, or changing/deleting its Calendar block needs
both relevant write scopes. Availability planning remains a human operation.

## Review and revoke

In the same Workspace, open **Agents**. The owner sees names, exact scopes and
resources, expiry/revoked state, and up to 200 recent confirmed agent writes.
Action buttons open the corresponding Task or block when it still exists. This
bounded history records operation, item ID, agent and time; it is not a complete
audit log and contains no Task notes, Mail references or reply text.

The same human operations are available through the CLI:

```sh
node cli/openjob.mjs workspace agent list --workspace "$workspace_id"
node cli/openjob.mjs workspace agent revoke "$agent_id" \
  --workspace "$workspace_id" --yes
```

API administration uses GET/POST `.../{workspaceId}/agent-grants` and DELETE
`.../{workspaceId}/agent-grants/{agentId}`. Only the current human owner can use
those routes. Agents cannot list other Workspaces, use Home/Personal, administer
access, read Mail or send messages. Current owner activity, sponsor, grant, expiry,
hash, resources and operation are checked on each request; a concurrent revocation
conflicts with a stale write. Changing a grant requires revoking it and issuing a
new reviewed grant.

If a revoke request fails, the app clears stale access metadata and labels the
result unconfirmed. Use **Refresh agent access** to inspect the saved state before
acting again. Revocation and confirmed actions survive service restart; revoking
access retains authored Task/Calendar work.

## Evidence and remaining scope

Source `7b59ba0414d8a9378c65d56486ff1cb7d40c68b9` passed focused domain/API/CLI,
scope, revoke-race, sidecar preservation and secret-scan regressions. A headed
browser and actual CLI used invented local identities to create a Task, edit its
notes, plan it, create a standalone block, review linked actions, recover from an
injected revoke failure, revoke, restart and verify denial. An independent grant
remained valid; Calendar-only access and a second human stayed isolated. All
synthetic credentials were revoked and their private files removed after proof.

This is bounded Tasks/Calendar owner-pilot delivery, not full R22 acceptance.
Mailbox-set delegation, multi-person sponsoring rights/lifecycle, broader policy,
native agent controls and integrated live acceptance remain separate. No real
grant, credential activation, provider effect, deployment or release was performed.
