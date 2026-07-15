---
id: openjob-v1-02
title: Define Task Lifecycle and Query Semantics
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:grilling
claimed: true
blocked_by: []
---

## Question

What are the exact create, edit, reassign, complete, reopen, delete, retain, sort, and filter semantics for the deliberately minimal Task shape?

## Answer

### Shape and creation

- A Task has an immutable opaque ID, multiline plain text, an assignee state, an optional due date, and an open or done state. Creation requires one current-Member assignee; forced removal is the sole exception and follows [Define Invite Rotation and Membership Governance](04-define-invite-rotation-and-membership-governance.md). Timestamps used for ordering are metadata rather than additional user-authored fields.
- Any Member may create a Task assigned to any current Member. The assignee is identified by Username; former Users and Users outside the Group cannot be assigned.
- Task text is trimmed at its outer edges and must contain 1–2,000 Unicode characters. Internal line breaks and blank lines are preserved, line endings are normalized, and control characters other than line breaks are rejected. Tasks have no rich-text formatting or attachments.
- A due date is optional and may be any valid past, present, or future calendar date. It has no time or timezone.

### Editing and reassignment

- Any Member may edit any open Task's text, due date, or assignee, subject to the normal creation rules. The due date may be cleared, reassignment is limited to current Members, and an assignee cannot be manually cleared. Any Member may assign an Unassigned Task to a current Member.
- Done Tasks are frozen. A Member must reopen one before changing its text, due date, or assignee; deleting it remains allowed.

### Completion and reopening

- Any Member may complete or reopen any Task. Clients send the desired state rather than a toggle instruction, making repeated requests idempotent.
- The first open-to-done transition records the completion time without changing the Task's other fields. Repeating that transition preserves the original completion time. Reopening clears it.
- v1 records neither who completed a Task nor an activity history.

### Deletion and retention

- Any Member may permanently delete any open or done Task after explicit confirmation in an interactive client. Deletion has no archive, tombstone, undo, or restore path in v1.
- Otherwise, Tasks remain in the Group indefinitely. Done Tasks retain their assignee as historical attribution after that User leaves. Ending the Group permanently removes all of its Tasks under the Group lifecycle contract.

### Sorting

- Username assignee columns sort by Username ascending. Unassigned Tasks form a separate assignee state whose presentation is left to the web-experience prototype.
- Within each column, open Tasks with due dates sort by date ascending, followed by undated open Tasks. Equal dates and undated Tasks sort by creation time ascending, then Task ID ascending.
- Done Tasks sort by completion time descending, then creation time ascending, then Task ID ascending.
- An all-status view places open Tasks before done Tasks. Filtering happens before these stable ordering rules are applied.

### Filtering and due-date display

- v1 supports only a status filter (`open`, `done`, or `all`) and an assignee filter (all assignee states, Unassigned, or exactly one Username). The filters combine, and the default view is open Tasks for all assignee states.
- v1 has no text search, multi-assignee selection, due-date filters, saved filters, or custom sorting.
- A due date becomes overdue when the viewing User's local calendar date has passed it. Reopening retains the due date, so a reopened Task may immediately be overdue.

### Concurrent changes

- v1 has no edit locks or version-conflict workflow. Among otherwise valid concurrent edits, the last accepted edit wins.
- Every mutation is validated against the Task's current state when accepted. An edit cannot change a Task that is already done, and a mutation against a deleted or unknown Task reports that it was not found.
