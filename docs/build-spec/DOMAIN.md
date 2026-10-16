# Domain model, ownership and permissions

**Proposed implementation model for ADR 0020/0021.** Logical entities below do not require separate services. Use opaque stable IDs and explicit references; addresses, labels and provider thread IDs are not global keys.

## Entities and invariants

| Entity | Essential fields / relationship | Invariants |
|---|---|---|
| User | id, displayName, lifecycle, independent auth anchors | One person-facing identity per installation; no automatic merge by email/domain |
| SignInBinding | userId, issuer, subject, controlClass, permittedContext, verifiedAt | Unique issuer/subject; independent personal vs company-bound control is explicit. Unknown control cannot silently become independent |
| Company | id, name, lifecycle, policyVersion | Owns its workspaces/resources; at least one active Owner while active |
| Membership | companyId, userId, role, state, revision, invitedBy | Unique Company/User pair; invited/active/suspended/departed; role is Company-specific |
| Invitation | id, companyId, intended verified recipient, proposed role, initial grants, expiresAt, state | Single-use, signed-in acceptance; acceptance atomically binds intended User and grants. Token possession alone insufficient |
| Workspace | id, ownerKind, ownerUserId OR companyId, name, timeZone, lifecycle | Exactly one owner. One Personal workspace per User; one initial Company workspace, later multiple through same model |
| Resource | id, workspaceId, kind, lifecycle, revision | Named mailbox, mailbox set, TaskSpace, OpenJob/external calendar; never joint company ownership |
| ResourceGrant | principalId, workspaceId, resourceId, operations, grantor/authority, revision, lifecycle | Company policy and active membership limit grant; grant cannot expand source authority |
| TaskSpace | resourceId, name, collaboration policy | Private Personal by default; Company shared default explicitly disclosed; old Groups separate |
| Task | id, workspaceId, taskSpaceId, fields from PRODUCT.md, revision, creator, completer | OpenJob authoritative; assignment only to accessible active member; creation/assignment does not transfer ownership |
| TaskSource | taskId, sourceConnectionId, sourceKind, providerObjectId, optional internal messageRef | Separate source authorization; task access alone cannot read this relation's identifying metadata or content |
| PlanningLink | taskId, targetKind, blockId OR providerEventRef, operationId, state | At most one active link per task; Tasks owns relationship; Calendar owns local interval |
| CalendarBlock | id, workspaceId, calendarId, title, start/end, timeZone, revision, optional taskId | OpenJob authoritative; local schedule operation updates both sides atomically |
| CalendarSeries / Exception (R51) | id, calendarId, start/timeZone, supported recurrence rule, bounded expansion window; exception keyed by original occurrence; optional provider ref | OpenJob series authoritative only for OpenJob blocks; external series stays provider-owned. Task link targets one occurrence, not an implicit recurring task |
| ProviderConnection | id, workspaceId, providerKind, upstreamSubject, account address/label, controller, consent, bindingRevision, state, secretRef | Same-provider multiple accounts allowed; subject uniqueness within declared binding; credentials never client-visible |
| ExternalRef | workspaceId, connectionId, kind, providerObjectId, providerRevision | Qualified identity across accounts; account address/folder/thread name never substitutes |
| ProviderProjection | externalRef, permitted metadata, observedAt, syncRevision, tombstone | Disposable cache; no authority to modify provider merely because cached |
| Draft | id, workspaceId, connectionId, storageKind, recipients/subject/body, attachments, revision, sourceRef | OpenJob draft distinguished from provider draft. From account fixed to allowed verified identity; no implicit cross-context copy |
| AgentPrincipal | id, controller User OR Company, name, managers, state | Separate identity from owner, token and upstream account; managers have only their authorized administration powers |
| Delegation | id, agentId, authoritySubject, exact resources, operations, expiry, revision, state | Personal delegated authority requires current human access; company-service authority requires explicit reviewed service binding |
| AgentCredential | id, agentId, grantId, hash, issued/expires/revoked | Secret shown once; hash stored; not a human session; current personal 24-hour lifetime preserved initially |
| Operation | id, requestKey, principal/initiator, context/resource, action, payloadHash, authority/binding revisions, state, resultRef | Stable idempotency scope and receipts; no mutable target/sending account after enqueue |
| IntegrationJob | id, operationId or sync key, state, nextAttemptAt, lease owner/expiry, attempt count, cursor | Durable scheduling; retries never invent new authority; cursor advancement and projection batch atomic |
| Activity | id, operationId, actor, context, resource identifiers, action, timestamps, outcome | Minimal attributable observation; not proof of delivery/read; no body/token leakage |

## Identity and existing-data compatibility

First Company implementation uses independent personal authentication. Managed company SSO is disabled. Inspect current issuer/subject links and support only verified eligible personally controlled anchors before enabling Company/multi-company operations. A user attestation by itself does not override a known company-managed binding; an unknown-control method remains unknown until provider/account evidence or a new eligible independent method resolves it. Existing Personal use is preserved while eligibility is assessed. Users are not merged, abandoned or relabeled to make the new schema convenient.

For actual identities/data that must be retained, maintain the User ID and map its Personal workspace explicitly, never treating ownerUserId as a Company ID. Use temporary route adapters only for identified active consumers. Disposable prototype fixtures may be regenerated and obsolete contracts replaced in one coherent client/server cutover; do not build a migration program for invented data. If actual retained data exists, test the necessary mapping, ownership/links and rollback before an authorized cutover. Do not keep indefinite dual writes or reset real shared data as a shortcut.

Preserve useful shared-task functions, not every historical Group endpoint/screen. Retain Group IDs/roles/data only where actual users or active consumers depend on them; otherwise simplify the prototype deliberately. Groups do not automatically become Companies. Any mapping that changes real ownership/membership shows the new contract explicitly; mailbox access is never part of automatic mapping.

## Company role and resource access matrix

| Action | Owner | Admin | Employee | Guest |
|---|---|---|---|---|
| View basic Company directory | Yes | Yes | Yes | Assigned collaborators only |
| Invite/manage Employee or Guest | Yes | Yes | No | No |
| Assign/remove Admin or Owner; transfer last Owner | Owner only; preserve successor | No | No | No |
| Create/configure company workspace/resource | Yes | Within policy | Only explicitly granted create authority | No by default |
| Read/write Company tasks/calendar | Resource grant required | Resource grant required | Resource grant required | Named resource grant required |
| Read/send restricted mailbox | Explicit mailbox operation grant + provider authority | Same | Same | Only explicitly permitted policy/grant; none by default |
| Manage Company agent/grants | Authorized manager + delegable authority | Same | Only explicitly delegated manager authority | No by default |
| Access person's Personal or another Company | No authority from this role | No | No | No |
| Delete Company | Owner action + applicable confirmation | No | No | No |

Creating a Company creates one shared TaskSpace and one OpenJob calendar. Invitations explicitly list whether the member will receive read/contribute grants to these defaults. This is visible shared-work policy, not implicit unrestricted content access. A restricted employee mailbox remains restricted even when Company-owned. A basic directory contains only display name, Company role and relevant work contact information; never personal recovery methods or connected mailbox lists.

Resource grant presets are conveniences over operations, not bypasses: viewer, contributor, manager for TaskSpace/OpenJob calendars; explicit operations for mailboxes. Manager can manage a resource only within Company role limits. No custom policy language or agent access-administration in first core. Company agents initially use named managers and sponsor-derived grants; durable company-service grants wait for a provider-supported service binding and lifecycle proof rather than becoming perpetual employee tokens.

## Effective authorization algorithm

For every read and mutation, resolve the authenticated principal independently of client data. Resolve selected workspace and its owning User/Company. For Company work require active membership or an explicitly supported Company-service grant. Require resource existence in that exact workspace, current role/policy, resource grant and the requested operation. For agents additionally intersect active delegation, credential validity, approved resource-set snapshot and current sponsoring authority. For external effects additionally require active connection/controller binding, actual upstream consent, implemented adapter capability and enabled runtime profile.

Authorize before loading sensitive content or resolving a provider credential. Lists/searches filter at query/repository boundaries; do not fetch unauthorized bodies and hide them in the UI. Return an indistinguishable unavailable result for inaccessible object IDs where needed to avoid existence leakage. A supplied workspaceId, ownerId, companyId, account address or agent label never grants authority.

Mutations recheck membership/grant/binding revisions immediately before durable local commit or external dispatch. A queued job uses its original approved resource/operation, never an expanded later interpretation. Revocation committed before dispatch blocks it. A request already sent upstream may complete after revocation; record that boundary honestly instead of promising recall. Provider responses are still authorized/redacted before returning to a caller whose access changed.

### Operation vocabulary

Canonical new grants distinguish `mail.read`, `mail.draft.create`, `mail.draft.update`, `mail.send`, `mail.modify`, `mail.trash`; `tasks.read`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.delete`; `calendar.availability`, `calendar.read`, `calendar.create`, `calendar.update`, `calendar.delete`. Connection/access administration remains human-only in first core. Keep operation strings aligned with adopted OpenAPI; legacy `mail:read`, `tasks:write` etc. are compatibility aliases restricted to their original Personal/fixture semantics, never automatically upgraded to live send/delete/admin authority.

R51 adds explicit `calendar.invite` and `calendar.respond` for provider notification effects. Series write scope also identifies occurrence versus series; broad read does not permit either. OpenJob-owned recurring blocks can be edited without invitations; a connected provider is required to send a provider-organized invitation in this build target.

Draft-create/send rights need not expose all mailbox contents. A caller with write but no read gets a minimal operation receipt rather than the stored body/message response. Replying to a message requires access to that source, while a permitted new compose can use explicitly supplied recipient/content. Busy-only Calendar access yields intervals, no titles/attendees. No principal gains additional operations because it can call the API instead of the UI.

## Mailbox sets and membership changes

A MailboxSet names selected mailbox resources in one workspace. A delegation records the reviewed membership/version, expanding to exact resource IDs when issued. Removing a mailbox removes effective authority immediately; adding one does not expand existing agent grants until an authorized manager reviews that expansion. Deleting a mailbox set does not grant its contents individually. Sets are not legacy task Groups and cannot span Companies.

## Lifecycle ownership

| Trigger | Immediate authority action | Durable cleanup / preserved data |
|---|---|---|
| Disable/disconnect connection | Connection revision changes; credential resolution and queued effects denied | Connections queues revocation/credential cleanup; Mail/Calendar invalidate projections. Tasks stay with unavailable source stub |
| Agent revoked/expired | Credential/delegation invalid; no new action/dispatch | Retain minimal outcome history; no claim that already-read data or mail is recalled |
| Member suspended/departed | Membership revision changes; derived grants denied | Company work remains; task reassignment explicit; privately controlled provider bindings reconnect/remove; Personal and other memberships unchanged |
| Company inactive/deleted | Company policy/lifecycle blocks all new actions | Context-owned cleanup reports progress; preserve user identities; deletion/retention requires the approved policy and confirmations |
| User deletion | User inactive first, then owned context cleanup | Handle Company successor/memberships and shared ownership; do not delete another Company's records just because the person authored them |
| Source removed at provider | Projection tombstone; source unavailable | Task and planning relationship remain unless separately changed; no stale source body retained through task |
| Task/block changed/deleted | Transaction preserves local planning invariants | Provider event action is separate; unknown external result remains operation pending/review |

Connections owns completion of provider cleanup; Identity/Workspace coordinates departure/account lifecycle; Delegation removes derived authority; domain owners perform their cleanup. A provider outage creates visible pending cleanup. An access-denied state is not evidence that provider credentials were revoked or retained bytes were erased.
