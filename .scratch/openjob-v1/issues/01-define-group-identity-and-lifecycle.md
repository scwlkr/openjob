---
id: openjob-v1-01
title: Define Group Identity and Lifecycle
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:grilling
claimed: true
blocked_by: []
---

## Question

What is the smallest complete contract for naming, identifying, creating, switching, leaving, renaming, and ending a Group, including whether names or URL handles must be globally unique?

## Answer

### Identity and naming

- Every Group receives an immutable, opaque Group ID when created. It is the stable identity used by URLs and API operations, and it is never reused.
- Every Group has a required, mutable Group Name. Names are not globally unique and are not URL handles.
- A Group Name is 1–80 Unicode characters after trimming surrounding whitespace. Blank names, line breaks, and control characters are rejected; otherwise spelling and case are preserved.

### Creation

- Any signed-in User may create a Group by supplying only its Group Name. v1 requires no approval and imposes no Group-creation limit.
- The creator immediately becomes the first Member and first Admin. Creator is not a lasting role and grants no privilege beyond Admin status.

### Selection and switching

- The service has no server-wide active Group. Every Group-scoped API operation identifies its Group explicitly.
- The web client remembers the last selected Group. The CLI may store an optional default Group ID and allows each command to override it.
- If a remembered Group becomes inaccessible, the client clears it. One remaining Group may be selected automatically; with multiple Groups, the User must choose.

### Renaming

- Any Admin may rename the Group, subject to the normal Group Name rules. The change is immediate.
- Renaming creates no alias or name history because Group ID links remain stable.

### Leaving

- A Member may leave unless they are the Group's last Admin or are assigned an open Task. Open Tasks must be completed or reassigned first; the last Admin must promote another Member first.
- The sole remaining Admin ends the Group instead of leaving it.
- Leaving ends access immediately. Done Tasks keep the departed User as historical attribution.
- A departed User may rejoin through a valid Invite Link unless they are banned from the Group.

### Ending

- Only an Admin who is the sole remaining Member may end the Group. They must confirm the current Group Name.
- Ending permanently removes the Group, Task List, Tasks, memberships, bans, and Invite Links. v1 provides no restore, and the Group ID is never reused.
