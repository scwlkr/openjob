# Domain model, ownership and permissions

**Proposed implementation model under the [owner-confirmed core](../ARCHITECTURE_ALIGNMENT.md).** The Workspace boundary, single human owner, explicit grants and external-agent model are confirmed; field schemas, role presets and technical defaults below remain Proposed. Logical entities below do not require separate services. Use opaque stable IDs and explicit references; addresses, labels and provider thread IDs are not global keys.

## Entities and invariants

| Entity | Essential fields / relationship | Invariants |
|---|---|---|
| User | id, displayName, lifecycle, independent auth anchors | One person-facing identity per installation; no automatic merge by email/domain |
| SignInBinding | userId, issuer, subject, controlClass, permittedContext, verifiedAt | Unique issuer/subject; independent personal vs company-bound control is explicit. Unknown control cannot silently become independent |
| Membership | workspaceId, userId, permissionSetRefs, state, revision, invitedBy | Unique Workspace/User pair; invited/active/suspended/departed; no blanket content rights |
| Invitation | id, workspaceId, intended verified recipient, initial resource/action grants, expiresAt, state | Single-use signed-in acceptance; token possession alone insufficient |
| Workspace | id, ownerUserId, name, timeZone, policyVersion, lifecycle | Exactly one accountable human owner; Company is a Workspace, no companyId hierarchy. Resources stay attached through owner transfer |
| OwnershipTransfer | workspaceId, currentOwnerId, recipientMemberId, state, revision | Current owner remains until recipient accepts; transfer atomic; owner cannot leave first |
| MemberGroup / PermissionSet | id, workspaceId, members or operations, revision | Internal access organization only; not another Workspace or legacy Task Group; no implicit content grant |
| Resource | id, workspaceId, kind, lifecycle, revision | Exactly one home Workspace for each mailbox/calendar/task space; human owner does not personally acquire restricted content |
| ResourceGrant | human/group/agent subject, workspaceId, resourceId, operations, grantor/authority, revision, lifecycle | Workspace policy and current subject authority limit grant; group expansion cannot silently widen agent delegations |
| TaskSpace | resourceId, name, collaboration policy | Private or explicitly shared; default creation/grants remain Proposed; old Groups separate |
| Task | id, workspaceId, taskSpaceId, fields from PRODUCT.md, revision, creator, completer | OpenJob authoritative; assignment only to accessible active member; creation/assignment does not transfer ownership |
| TaskSource | taskId, sourceConnectionId, sourceKind, providerObjectId, optional internal messageRef | Separate source authorization; task access alone cannot read this relation's identifying metadata or content |
| PlanningLink | taskId, targetKind, blockId OR providerEventRef, operationId, state | At most one active link per task; Tasks owns relationship; Calendar owns local interval |
| CalendarBlock | id, workspaceId, calendarId, title, start/end, timeZone, revision, optional taskId | OpenJob authoritative; local schedule operation updates both sides atomically |
| CalendarSeries / Exception (R51) | id, calendarId, start/timeZone, supported recurrence rule, bounded expansion window; exception keyed by original occurrence; optional provider ref | OpenJob series authoritative only for OpenJob blocks; external series stays provider-owned. Task link targets one occurrence, not an implicit recurring task |
| ProviderConnection | id, providerKind, upstreamSubject, authorized manager refs, consent, bindingRevision, state, secretRef | Account-level management projection is filtered by management authority, not a master Workspace or global credential ownership |
| ConnectionResourceBinding | connectionId, resourceId, workspaceId, approved capabilities, controller/authority, revision | Each resource has one home; same provider authorization never implicitly shares other resources or credentials. Exact multi-home binding/cleanup schema remains Proposed |
| ExternalRef | workspaceId, connectionId, kind, providerObjectId, providerRevision | Qualified identity across accounts; account address/folder/thread name never substitutes |
| ProviderProjection | externalRef, permitted metadata, observedAt, syncRevision, tombstone | Disposable cache; no authority to modify provider merely because cached |
| Draft | id, workspaceId, connectionId, storageKind, recipients/subject/body, attachments, revision, sourceRef | OpenJob draft distinguished from provider draft. From account fixed to allowed verified identity; no implicit cross-context copy |
| AgentPrincipal | id, externalSubject/binding, connectedByUserId, name, state | Connected external identity, distinct from human/upstream credentials; no Workspace-owned persistent runtime |
| Delegation | id, agentId, workspaceId, sponsoringMemberId, exact resources, operations, expiry, revision, state | Independent per Workspace; subset of current member rights under policy; no inferred unattended Workspace-service authority |
| AgentCredential | id, agentId, grantId, hash, issued/expires/revoked | Secret shown once; hash stored; not a human session; current personal 24-hour lifetime preserved initially |
| Operation | id, requestKey, principal/initiator, context/resource, action, payloadHash, authority/binding revisions, state, resultRef | Stable idempotency scope and receipts; no mutable target/sending account after enqueue |
| IntegrationJob | id, operationId or sync key, state, nextAttemptAt, lease owner/expiry, attempt count, cursor | Durable scheduling; retries never invent new authority; cursor advancement and projection batch atomic |
| Activity | id, operationId, actor, context, resource identifiers, action, timestamps, outcome | Minimal attributable observation; not proof of delivery/read; no body/token leakage |

## Identity and existing-data compatibility

Proposed initial Workspace implementation uses independent personal authentication. Managed company SSO is disabled. Inspect current issuer/subject links and support only verified eligible personally controlled anchors before enabling multi-Workspace operations. A user attestation by itself does not override a known company-managed binding; an unknown-control method remains unknown until provider/account evidence or a new eligible independent method resolves it. Existing Personal use is preserved while eligibility is assessed. Users are not merged, abandoned or relabeled to make the new schema convenient.

For actual identities/data that must be retained, maintain the User ID and map its Personal workspace explicitly, never treating ownerUserId as a Workspace ID. Use temporary route adapters only for identified active consumers. Disposable prototype fixtures may be regenerated and obsolete contracts replaced in one coherent client/server cutover; do not build a migration program for invented data. If actual retained data exists, test the necessary mapping, ownership/links and rollback before an authorized cutover. Do not keep indefinite dual writes or reset real shared data as a shortcut.

Preserve useful shared-task functions, not every historical Group endpoint/screen. Retain Group IDs/roles/data only where actual users or active consumers depend on them; otherwise simplify the prototype deliberately. Legacy Task Groups do not automatically become Workspaces or internal member groups. Any mapping that changes real ownership/membership shows the new contract explicitly; mailbox access is never part of automatic mapping.

## Human ownership, groups and proposed role presets

The confirmed model has exactly one accountable human Workspace owner, active
members, internal groups/permission sets and explicit resource/action grants.
Owner transfer changes the ownerUserId only after the receiving member accepts;
resources/grants stay in the Workspace. The owner cannot leave or be removed first.
Neither owner status nor group membership alone reveals restricted Mail.

**Proposed presets:** Admin manages invitations/resources within granted policy;
Employee contributes to selected work; Guest sees named resources/collaborators.
Owner/Admin/Employee/Guest labels do not establish legal employment, multiple
co-owners or accepted default visibility. Presets compile to explicit operations.
A member with delegable rights may connect an agent where policy permits, without
becoming an administrator. No new all-content or service-agent privilege follows.

Proposed initial TaskSpace/calendar creation and basic directory fields require
review. If provided, invitations enumerate actual initial access and acceptance;
no content is shared automatically by joining. A directory must omit personal
recovery methods and restricted connected-account lists.

## Effective authorization algorithm

For every read and mutation, resolve the authenticated principal independently of client data. Resolve the selected Workspace, its accountable human owner and current membership/policy. Human owner status is administrative, not a substitute for restricted-resource grants. For an agent require the selected Workspace delegation and current sponsoring member authority; do not combine grants across Workspaces. Require resource existence in that exact workspace, current role/policy, resource grant and the requested operation. For agents additionally intersect active delegation, credential validity, approved resource-set snapshot and current sponsoring authority. For external effects additionally require active connection/controller binding, actual upstream consent, implemented adapter capability and enabled runtime profile.

Authorize before loading sensitive content or resolving a provider credential. Lists/searches filter at query/repository boundaries; do not fetch unauthorized bodies and hide them in the UI. Return an indistinguishable unavailable result for inaccessible object IDs where needed to avoid existence leakage. A supplied workspaceId, ownerId, account address or agent label never grants authority.

Mutations recheck membership/group/policy/grant/binding revisions immediately before durable local commit or external dispatch. A queued job uses its original approved resource/operation, never an expanded later interpretation. Revocation committed before dispatch blocks it. A request already sent upstream may complete after revocation; record that boundary honestly instead of promising recall. Provider responses are still authorized/redacted before returning to a caller whose access changed.

### Operation vocabulary

Canonical new grants distinguish `mail.read`, `mail.draft.create`, `mail.draft.update`, `mail.send`, `mail.modify`, `mail.trash`; `tasks.read`, `tasks.create`, `tasks.update`, `tasks.complete`, `tasks.delete`; `calendar.availability`, `calendar.read`, `calendar.create`, `calendar.update`, `calendar.delete`. Connection/access administration remains human-only in first core. Keep operation strings aligned with adopted OpenAPI; legacy `mail:read`, `tasks:write` etc. are compatibility aliases restricted to their original Personal/fixture semantics, never automatically upgraded to live send/delete/admin authority.

R51 adds explicit `calendar.invite` and `calendar.respond` for provider notification effects. Series write scope also identifies occurrence versus series; broad read does not permit either. OpenJob-owned recurring blocks can be edited without invitations; a connected provider is required to send a provider-organized invitation in this build target.

Draft-create/send rights need not expose all mailbox contents. A caller with write but no read gets a minimal operation receipt rather than the stored body/message response. Replying to a message requires access to that source, while a permitted new compose can use explicitly supplied recipient/content. Busy-only Calendar access yields intervals, no titles/attendees. No principal gains additional operations because it can call the API instead of the UI.

## Mailbox sets and membership changes

A MailboxSet names selected mailbox resources in one workspace. A delegation records the reviewed membership/version, expanding to exact resource IDs when issued. Removing a mailbox removes effective authority immediately; adding one does not expand existing agent grants until an authorized manager reviews that expansion. Deleting a mailbox set does not grant its contents individually. Sets are not legacy task Groups and cannot span Workspaces.

## Lifecycle ownership

| Trigger | Immediate authority action | Durable cleanup / preserved data |
|---|---|---|
| Disable/disconnect connection | Connection revision changes; credential resolution and queued effects denied | Connections queues revocation/credential cleanup; Mail/Calendar invalidate projections. Tasks stay with unavailable source stub |
| Workspace agent grant revoked/expired | That delegation invalid; no new action/dispatch in that Workspace; unrelated grants stay valid | Retain minimal outcome history; no claim that already-read data or mail is recalled |
| Member suspended/departed | Membership revision changes; derived grants denied | Workspace work remains; task reassignment explicit; privately controlled provider bindings reconnect/remove; Personal and other memberships unchanged |
| Workspace inactive/deleted | Workspace policy/lifecycle blocks all new actions | Context-owned cleanup reports progress; preserve user identities; deletion/retention requires the approved policy and confirmations |
| User deletion | Restricted deletion-pending state denies ordinary work but permits freshly authenticated owner-transfer/approved-closure steps; deactivate only after ownership prerequisites resolve | Recipient accepts each owned Workspace transfer or separately approved closure completes before User deactivation; then revoke derived access/cleanup. Never erase another Workspace’s records merely because the person authored them |
| Source removed at provider | Projection tombstone; source unavailable | Task and planning relationship remain unless separately changed; no stale source body retained through task |
| Task/block changed/deleted | Transaction preserves local planning invariants | Provider event action is separate; unknown external result remains operation pending/review |

Connections owns completion of provider cleanup; Identity/Workspace coordinates departure/account lifecycle; Delegation removes derived authority; domain owners perform their cleanup. A provider outage creates visible pending cleanup. An access-denied state is not evidence that provider credentials were revoked or retained bytes were erased.

## Central management and bounded Home

Account-level Connections lists only manageable bindings. Resource detail and data
access still authorize the home Workspace and resource. R31 must finalize binding
and disconnect effects where one upstream authorization supplies several resources:
preview impact, require management authority for affected bindings, and distinguish
resource detach from whole-provider revocation. Central placement alone settles no
credential storage or cross-Workspace reuse policy.

Home queries only currently authorized Task/event projections and unread counts,
labels each Workspace, and links into it for actions. Count queries enforce the
same resource grants; inaccessible sources contribute neither content nor metadata.
No global Mail search, agent grant union or cross-Workspace mutation is introduced.

Proposed account-deletion flow must not deactivate the sole owner before accepted
transfer or approved closure. Deletion-pending permits only those lifecycle steps
with fresh human proof and their own authorization; it confers no ordinary content
or provider authority. Actual deactivation then denies all new actions.
