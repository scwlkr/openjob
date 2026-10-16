# 0020 — Make workspaces and explicit principals the authorization boundary

- Status: **Proposed — owner acceptance pending**
- Date: 2026-10-16
- Scope: identity, tenancy, ownership and delegation
- Context: [platform blueprint](../PLATFORM_ARCHITECTURE.md)
- Supersedes: none; existing Group permissions and sign-in linking remain

## Context

The current personal workspace is keyed by owner User ID; existing Groups have
separate membership. Agent grants are already distinct hashed credentials with
resource/operation limits. Provider identity and OpenJob sign-in are separate.
The platform needs a coherent model for personal work, eventual collaboration,
multiple provider accounts and agents without conflating those identities.

## Proposed decision

A User is a stable OpenJob identity. Sign-in methods prove access to that User;
matching email addresses never merge Users or authorize resources, preserving
[ADR 0007](0007-link-sign-in-methods-without-email-merging.md).

A Workspace is the application tenancy and resource-ownership boundary. Begin
with a personal workspace and its owner. Model membership explicitly so shared
workspaces can be introduced deliberately; do not expose organization hierarchy,
SSO administration or billing before there is an actual product need. Separate
installations are independent identity/data trust boundaries. Existing owner-keyed
storage is a baseline implementation, not the definition of a permanent workspace
ID. Introduce a compatibility mapping before changing existing resource ownership.

Authorization resolves a principal, workspace membership, operation and resource.
A server derives accessible workspace context; a caller-supplied workspace ID
alone confers no access. An agent is a distinct principal acting under an explicit
human delegation with named resources, operations, expiry and revocation. It gets
neither a human session nor upstream credentials. Its important operations are
attributed to the agent and delegating human/workspace context. Future queued
external writes resolve the current grant when executed, not only when queued.

Workspace membership alone never authorizes discovery of private connection
metadata, mailbox identities or their readable projections. A connection has an
explicit human controller; additional resource grants are opt-in. An agent's
effective authority intersects its delegation, its delegating human's current
resource access, provider consent and current connection state.

A Provider Connection belongs to the owning workspace/private resource scope and
binds the verified upstream subject. A connection to another mailbox from the
same provider is another resource. A label, alias or sign-in method does not
create a separate isolated mailbox or establish mailbox consent.

Personal Tasks may reference private Mail. Moving or sharing a Task must not
implicitly share source content; choose explicit projection/redaction or a
separately authorized source resource. Keep existing Group membership and Task
behavior until an accepted mapping/migration exists. Do not automatically convert
Groups to workspaces, expose private Mail to Group members or rewrite history.

Identity/Workspace owns membership departure and account/workspace deletion
coordination. Access becomes inactive before cleanup; Delegation disables affected
grants, Connections stops credential resolution and owns credential/revocation
cleanup, and Mail/Calendar invalidate projections. The integration runner executes
those durable cleanup intents but does not own their policy. Private connection
transfer must be explicit; departure never makes it visible to remaining members.
Retained Task source stubs do not authorize retaining message bodies.

## Alternatives and tradeoffs

- **Owner User ID as all future tenancy:** simple now, but cannot express shared
  ownership/lifecycle cleanly. Preserve it as a compatibility mapping, not a
  universal identifier for Users, workspaces and provider accounts.
- **Group equals workspace immediately:** reuses membership but risks changing
  Task visibility and inheriting Mail access unexpectedly. Defer unification until
  the sharing contract is accepted and existing records can be preserved.
- **Agents impersonate owners:** easy client integration, but no meaningful
  operation/resource limits or attributable revocation. Reject it.
- **Enterprise organization tree from day one:** models future administration at
  the cost of product scope and implementation. Explicit workspace membership is
  the smaller foundation with a growth path.

## Consequences and review gate

Clients and adapters carry stable ownership-qualified references. Membership,
connection consent and agent grants are separate checks, not one global role.
This adds explicit relationships but prevents email, provider or Group identity
from accidentally becoming authority over private work.

Acceptance requires agreement on the first personal/shared workspace contract,
what can be shared, and the compatibility mapping for existing Groups and owner
records. No new tenant, account, membership or grant is created by this ADR.
