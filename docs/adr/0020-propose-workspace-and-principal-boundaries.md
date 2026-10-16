# 0020 — One identity, human-owned Workspaces and connected-agent grants

- Status: **Owner-confirmed core; implementation details Proposed**
- Date: 2026-10-16
- Scope: Workspace boundary, ownership, membership and delegation
- Source: [actual owner confirmations](../ARCHITECTURE_ALIGNMENT.md)
- Detail: [people and Workspaces](../COMPANIES_AND_IDENTITY.md), [DOMAIN](../build-spec/DOMAIN.md)
- Supersedes: the conflicting Company → multiple Workspaces proposal in this ADR;
  no historical implemented ADR or production contract is changed

## Context and confirmed decision

Shane reviewed the diagram and clarified questions 1–12 in the source discussion.
One personal identity belongs to multiple independent Workspaces. A company is a
Workspace initially. Internal member groups/permission sets handle organization;
there is no separate Company entity above Workspaces.

Every Workspace has exactly one accountable human owner. Transfer requires another
member's acceptance, and the owner transfers before leaving. Resources and grants
remain attached to the Workspace; accountable administration is distinct from
resource location, restricted-content access and upstream provider credentials.

Invitations grant selected resources/actions. Membership gives no blanket content
access; restricted employee and shared mailboxes both work. Account-level Connections
lists only what the person may manage; each mailbox/calendar has a home Workspace.
There is no master Workspace or global access implied by this screen.

An externally connected agent identity has independent revocable permissions in
each Workspace. Members may delegate only subsets of current authority under
Workspace policy. OpenJob does not provision persistent Workspace agent runtimes.
A grant in A provides no B authority. A's revocation must not revoke unrelated B
grants, while loss of the sponsoring member's A rights invalidates derived A work.

Home may aggregate labeled authorized tasks/events/unread counts across Workspaces.
Opening work enters its Workspace; actions remain scoped. No blanket unified Mail,
search or agent access follows. OpenJob accounts initially have no hosted mailbox;
existing providers connect and hosted inboxes remain a possible future product.

## Proposed implementation details

Stable User/Workspace/resource IDs; invitation expiry and verified-recipient
acceptance; membership lifecycle; permission-group representation and role presets;
independent personal-anchor eligibility; initial company SSO disabled; exact
agent credential/grant model and operation vocabulary remain Proposed. Owner,
Admin/Employee/Guest presets must never introduce a second owner or implicit Mail
access. No default shared-resource grant is adopted merely by creating a Workspace.

Preserve [ADR 0007](0007-link-sign-in-methods-without-email-merging.md): no email
merge. Evaluate actual sign-in/data/consumer compatibility without disrupting
Personal access. Keep useful legacy Group behavior but do not reinterpret Group
membership as employment, Workspace membership or Mail access automatically.

Context-qualified APIs enforce membership, resource/action grants, current human
authority and provider consent/state before credential resolution or dispatch.
Exact schemas belong in the existing OpenAPI; no code/runtime claims follow from
this ADR. Hosting, credential storage, retention/offline and jobs remain separate
proposals in ADRs 0019/0021 and RUNTIME.

## Rejected alternatives and consequences

- Company containing multiple Workspaces: superseded by the confirmed simpler
  Workspace model. Internal groups organize access without a second tenant layer.
- Several co-owners or departing before transfer: conflicts with one accountable
  owner and accepted transfer. This does not give that owner all content rights.
- Master Workspace owns all connections/resources: superseded by account-level
  management with explicit resource homes and permissions.
- Persistent agent provisioned per Workspace: conflicts with external connected
  identity plus independent grants; OpenJob authorization is not agent hosting.
- Blanket aggregation or domain-based enrollment: not authorized by Home or
  invitation decisions. Cross-Workspace collaboration remains explicitly granted.

The confirmed core is ready to guide design. Detailed proposals still await review;
C13 now authorizes bounded owner-useful implementation and reviewed non-deploying
merges. It does not authorize credentials, provider effects, publication or release.
