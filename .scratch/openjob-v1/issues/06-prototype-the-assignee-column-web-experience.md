---
id: openjob-v1-06
title: Prototype the Assignee-Column Web Experience
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:prototype
claimed: true
blocked_by:
  - openjob-v1-05
---

## Question

What is the simplest usable browser experience for entering a Group, viewing assignee columns, narrowing with ordinary filters, manipulating Tasks, and reaching Admin controls across desktop and narrow screens?

## Answer

### Prototype and selected direction

- The [three-variant browser prototype](../../../app/prototype/assignee-columns/prototype-board.tsx) runs locally at `/prototype/assignee-columns?variant=A`, with `B` and `C` selecting the alternatives. It uses in-memory sample state only and is explicitly throwaway.
- Variant A, **Group rail + lanes**, is the v1 direction. Desktop keeps a persistent Group rail beside horizontally arranged assignee columns. Narrow screens turn the Group rail into a compact horizontal picker and show one almost-full-width assignee column at a time through horizontal scrolling.
- Variant B, **Due-date ledger**, makes cross-assignee comparisons dense but invents due-date buckets as the primary structure. Variant C, **Roster focus**, is calm on narrow screens but hides the whole-Group state behind one selected assignee. Both are less faithful to the deliberately flat Task List.

### Browser contract

- Group entry is always explicit and client-local: choose a Group from the persistent desktop rail or compact narrow-screen picker. The hosted service stores no active Group.
- The default view shows open Tasks for all assignee states. `Open`, `Done`, and `All` status controls combine with an ordinary single-assignee selector. Columns remain Username-sorted, with Unassigned last as an exceptional recovery column.
- Each Member column offers an inline New Task entry point. Task cards expose complete or reopen, Edit, and confirmed permanent Delete. The Unassigned column never offers Task creation; its open Tasks use Edit to select a current Member.
- Admin controls remain separate from everyday Task work but reachable from both desktop and narrow navigation. They open a focused panel for the Invite Link, membership and roles, rename, leaving, and ending the Group.
- Implementation must rewrite the chosen direction against `/api/v1`; the prototype is not production code and must not inherit the legacy global-board API.
