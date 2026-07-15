---
id: openjob-v1-map
title: Define OpenJob v1 as a group task system
status: open
labels:
  - wayfinder:map
---

## Notes

- OpenJob is company-first software that happens to be open source. Optimize for scwlkr's real company use, not hypothetical adoption.
- Keep the product bare bones: one Group owns one flat Task List; assignee columns and ordinary filters organize it; every Task has one assignee and only text, optional due date, and open/done state.
- Google is the only sign-in provider. Usernames are globally unique and first come. Groups are private and unlisted; weekly rotating Invite Links admit signed-in Users.
- Members have equal Task permissions. Admins govern membership, bans, Invite Links, and Admin status. The creator is only the first Admin, and a Group must retain at least one Admin.
- Web and CLI are equal clients of one hosted service. CLI can replace browser use after a one-time browser handoff for Google authentication; it has no local task database or offline mode.
- Every session should consult `/grilling`, `/domain-modeling`, [the domain glossary](../../CONTEXT.md), and [the equal-client ADR](../../docs/adr/0001-web-and-cli-are-equal-api-clients.md).
- Local tracker: child issues live in `issues/`. The frontier is every open issue with `claimed: false` whose `blocked_by` issues are all closed. Set `claimed: true` before work.

## Decisions so far

<!-- Empty until a child issue is resolved. -->

## Fog

- Open-source packaging and self-hosting expectations after the company-first v1 is proven.
- Whether real use eventually warrants notifications, recurrence, integrations, or richer Task structure.
- Operational scale, retention, export, and recovery needs once actual company usage produces evidence.
