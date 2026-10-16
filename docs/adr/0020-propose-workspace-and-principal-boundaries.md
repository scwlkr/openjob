# 0020 — One personal identity with independent Company memberships

- Status: **Proposed — owner acceptance pending**
- Date: 2026-10-16
- Scope: identity, Company tenancy, workspaces, ownership and delegation
- Context: [platform blueprint](../PLATFORM_ARCHITECTURE.md),
  [Companies and identity](../COMPANIES_AND_IDENTITY.md)
- Supersedes: none; existing Group permissions and sign-in linking remain

## Context

A person may be employed by two companies, own another and retain personal Mail
and work. Companies need employee accounts, shared resources, invitations and
continuity when someone leaves. Treating every company as another login fragments
the person; treating everyone as one shared tenant leaks authority. The current
owner-keyed personal workspace and separate Task Groups implement neither a
Company tenancy model nor employment-derived resource ownership.

## Proposed decision

One stable OpenJob User per installation has one personal workspace and zero or
more independent Company memberships. Sign-in methods prove access to that User;
email/domain equality never merges Users or authorizes membership, preserving
[ADR 0007](0007-link-sign-in-methods-without-email-merging.md). Separate self-hosted
installations remain independent trust boundaries, not automatically linked IDs.

A Company owns company workspaces and company resources. A Workspace is owned by
exactly one Company or one personal User. Company policy is the organizational
isolation boundary; workspace and resource grants narrow access. A User can be
Owner in A, Employee in B and Guest in C without carrying authority across them.
Active membership authorizes company access; it does not prove legal employment
or establish ownership of the person's identity, personal accounts or other memberships.

Require an independently controlled personal authentication/recovery anchor for
personal or multi-company use. Company-managed login, if later supported, proves
only the bound company context; it does not create a global session for Personal
or another company. The first Company release uses eligible independently personally authenticated
Users; company SSO is disabled. Preserve existing Personal access during anchor
eligibility assessment; unknown control is not resolved by user attestation alone. Global sign-in linking/removal/recovery
requires fresh independent personal proof; company admins manage only their own
binding and cannot reset the global User. Departure or reassignment must not make
an employer the person's recovery authority. Establish a replacement before
removing the last independent anchor.

Provider subject plus configured company/IdP binding classifies managed login;
email domain is not enough. Unknown-control credentials cannot silently become
personal anchors. Existing global method links need assessment/compatibility
planning before claiming this separation. This proposed company-context policy
extends the eligibility assumptions around ADR0007; it does not claim existing
Google/Apple linking already implements managed-login isolation. Protocol and
migration specifics must be accepted before company login is enabled.

Recommend basic per-company Owner/Admin/Employee/Guest roles. Owners establish
company policy and ownership; admins manage memberships/company resources within
policy; employees use explicitly shared/granted work; guests access named work
only. Administrative role does not silently grant mailbox-content access. A
company may expose a basic employee directory and a clearly disclosed shared
workspace without exposing restricted Mail or credentials. Avoid a custom policy
language or enterprise directory/federation suite in the first implementation.

A person explicitly creates a Company as its initial Owner. Invitations identify
a verified intended recipient, role and initial access, and require signed-in
acceptance. Existing Users add membership, not another identity. Maintain a
successor when transferring the last Owner. No domain-based enrollment or automatic
conversion of existing Task Groups into Companies. Existing records require an
explicit compatibility mapping before ownership changes.

Context switching selects Personal or Company, then an accessible Workspace.
APIs resolve membership/resource authority server-side for every selected context;
a submitted company/workspace ID grants nothing by itself. Do not merge company
inboxes, searches, compose identities or agent resource pickers by default.
Cross-company collaboration is an explicit guest grant into one owner's named
resources, not a two-company-owned resource or a grant to the guest's employer.

Connections record explicit personal/company ownership, upstream subject,
controller, consented capabilities and credential reference. A company-domain
address does not establish ownership. Company-owned individual Mail can be
restricted to the employee; shared company Mail requires its own grants. Personal
accounts remain private. Moving a Task cannot silently disclose its source Mail.
Upstream provider consent remains independent of OpenJob membership/admin status.

Personal agents are controlled by a User; company agents by a Company with named
managers and attributable sponsorship. Both use distinct principals. Effective
access intersects company/workspace policy, resource grants, current delegating
human or approved company-service authority, agent operations, provider consent
and connection state. A company agent cannot inherit a manager's personal access.
An employee token cannot silently become a perpetual company-service grant.

Membership suspension/departure first stops company access and derived delegation.
Personal identity/work and unrelated memberships remain. Company-owned Tasks,
calendars and shared work remain with the Company; reassign managers/work explicitly.
Identity/Workspace coordinates lifecycle; Delegation disables affected grants;
Connections owns credential/revocation cleanup; Mail/Calendar invalidate readable
projections; Tasks preserves company work and reconciles planning links. Transfer
of upstream access requires provider-supported authorization or new consent,
never reassignment of a departed person's raw credentials. Retention and actual
provider cleanup outcomes remain explicit, distinct from local access revocation.

[DOMAIN](../build-spec/DOMAIN.md) supplies proposed entity/role/access contracts;
[EXPERIENCE](../build-spec/EXPERIENCE.md) specifies invitation/context/departure
flows. Initial Company creation adds one shared TaskSpace and OpenJob calendar;
invitations disclose and explicitly grant contribution to these defaults.
Company agents initially have sponsor-derived authority and named managers;
service grants wait for an explicitly supported binding and lifecycle proof.
These are proposed elaborations, not implemented roles or new access.

## Alternatives and tradeoffs

- **Separate User per employer:** simple isolation, but duplicate identities,
  disconnected personal work and confusing invitations/recovery. Reject as default.
- **Flat workspaces without Company:** fewer entities, but employer ownership,
  policy and departure cannot be expressed coherently. Company is core scope.
- **Domain-based automatic membership/account ownership:** convenient onboarding,
  but confuses addresses with identity and consent. Use verified explicit invitations.
- **Global company-spanning Inbox and grants:** convenient aggregation, but obscures
  context/sending identity and risks unintended sharing. Defer opt-in aggregation.
- **Group equals Company immediately:** reuses membership but changes private Mail
  visibility and Task ownership without a migration contract. Preserve Groups first.

The recommendation requires more explicit relationships but gives people identity
continuity and companies meaningful ownership. Basic roles and one company
workspace are sufficient initial scope; hierarchy, federation and custom policy
can grow from evidence.

## Consequences and acceptance gate

All context-owned resources need stable ownership-qualified IDs, membership and
resource checks. Existing owner IDs can map to personal workspaces without becoming
Company IDs. Company creation/invitation, employee/guest access, switching,
connection ownership and departure must be designed together before company data
is introduced. Owner review accepts or adjusts the defaults above; no account,
Company, membership, credential or grant is created by this ADR.
