---
id: openjob-v1-map
title: Define OpenJob v1 as a group task system
status: open
labels:
  - wayfinder:map
---

## Notes

- OpenJob is company-first software that happens to be open source. Optimize for scwlkr's real company use, not hypothetical adoption.
- Keep the product bare bones: one Group owns one flat Task List; assignee columns and ordinary filters organize it; every Task normally has one Member assignee, with Unassigned reserved for forced removal, and only text, optional due date, and open/done state.
- Google is the only sign-in provider. Usernames are globally unique and first come. Groups are private and unlisted; weekly rotating Invite Links admit signed-in Users.
- Members have equal Task permissions. Admins govern membership, bans, Invite Links, and Admin status. The creator is only the first Admin, and a Group must retain at least one Admin.
- Web and CLI are equal clients of one hosted service. CLI can replace browser use after a one-time browser handoff for Google authentication; it has no local task database or offline mode.
- Every session should consult `/grilling`, `/domain-modeling`, [the domain glossary](../../CONTEXT.md), and [the equal-client ADR](../../docs/adr/0001-web-and-cli-are-equal-api-clients.md).
- Local tracker: child issues live in `issues/`. The frontier is every open issue with `claimed: false` whose `blocked_by` issues are all closed. Set `claimed: true` before work.

## Decisions so far

- [Define Group Identity and Lifecycle](issues/01-define-group-identity-and-lifecycle.md) — Groups use immutable opaque IDs with mutable non-unique names, client-local selection, Admin renaming, guarded leaving, and confirmed permanent ending.
- [Define Task Lifecycle and Query Semantics](issues/02-define-lifecycle-and-query-semantics.md) — Tasks use bounded multiline text, normally one current-Member assignee, removal-induced Unassigned handling, open/done transitions, permanent deletion, stable due-first ordering, and minimal filters.
- [Research Google Authentication for Equal Web and CLI Clients](issues/03-research-google-authentication-for-equal-clients.md) — Firebase issues one bearer-token identity to both clients; web uses Google sign-in, while CLI uses a PKCE loopback flow and stores only Firebase refresh credentials.
- [Define Invite Rotation and Membership Governance](issues/04-define-invite-rotation-and-membership-governance.md) — One weekly or 25-join Invite Link admits confirmed Users; Admin actions govern membership and roles while preserving one Admin and safely unassigning forced-removal work.
- [Define the Shared API and Authorization Contract](issues/05-define-the-shared-api-and-authorization-contract.md) — A versioned JSON API gives web and CLI one resource, action, error, privacy, pagination, and authorization contract backed by Firebase bearer identity.
- [Prototype the Assignee-Column Web Experience](issues/06-prototype-the-assignee-column-web-experience.md) — The web uses an explicit Group picker, filterable horizontal assignee lanes with Unassigned last, direct Task actions, and reachable Admin controls across desktop and narrow screens.
- [Prototype the Complete CLI Contract](issues/07-prototype-the-complete-cli-contract.md) — The resource-first CLI covers every web capability with local Group selection, browser-backed Firebase auth, explicit stream and file I/O, stable formats, confirmations, and exit statuses.

## Fog

- Open-source packaging and self-hosting expectations after the company-first v1 is proven.
- Whether real use eventually warrants notifications, recurrence, integrations, or richer Task structure.
- Operational scale, retention, export, and recovery needs once actual company usage produces evidence.
