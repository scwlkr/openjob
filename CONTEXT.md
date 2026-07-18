# OpenJob

OpenJob coordinates small working groups through one shared task list. It intentionally stays smaller than a project-management system.

## Language

**Group**:
A membership boundary with exactly one Task List.
_Avoid_: Workspace, organization

**Group Name**:
A required, mutable, non-unique label by which Users recognize a Group.
_Avoid_: Group ID, handle

**Group ID**:
The immutable, opaque identity assigned to a Group when it is created.
_Avoid_: Group Name, URL handle

**Invite Link**:
A short-lived, Group-specific credential that lets a signed-in User become a Member.
_Avoid_: Public link, invitation

**Task List**:
The single flat collection of work belonging to a Group.
_Avoid_: Project, Kanban board

**Task**:
A smallest unit of work on a Task List. An open Task is normally assigned to exactly one current Member by Username; forced removal of that Member can make it Unassigned. A done Task keeps its User as historical attribution if they later leave the Group.
_Avoid_: Job, ticket, card

**Task Creator**:
The User who originally adds a Task, distinct from its current Assignee. A Task Creator does not change when the Task is edited or reassigned.
_Avoid_: Task owner, author

**Push Notification**:
A User-enabled alert that can appear outside the active OpenJob app when a relevant Task event matters to that User. It is an ephemeral alert, not a durable inbox item.
_Avoid_: In-app notification, Notification inbox

**Priority**:
A Task's primary relative order within one assignee's open work: High before Normal before Low, then due date within each level. Every Task has exactly one Priority; Normal is the default, and completed work remains completion-ordered.
_Avoid_: Urgency, severity

**Unassigned**:
The exceptional assignee state of an open Task whose Member was kicked or banned. It lasts until a Member reassigns the Task and cannot be chosen during ordinary Task creation or editing.
_Avoid_: Group-owned, Group assignee

**User**:
A person with one OpenJob identity that can participate in multiple Groups.
_Avoid_: Account, profile

**Username**:
A globally unique, first-come identifier chosen once after a User's first Google sign-in, used for assignment and recognition across Groups. It contains 2–32 lowercase ASCII letters or numbers, may contain `.`, `_`, or `-` internally, and begins and ends with a letter or number. OpenJob reserves `admin`, `support`, `openjob`, `unassigned`, and `me`. A Username is immutable after it is claimed.
_Avoid_: Display name, email address

**Member**:
A User participating in a Group.
_Avoid_: Collaborator, teammate

**Leave Group**:
The voluntary end of a User's membership in a Group.
_Avoid_: Kick, Ban

**End Group**:
The permanent conclusion of a Group and its Task List after every Member except one Admin has left or been removed.
_Avoid_: Archive Group, Delete workspace

**Admin**:
A Member trusted with Group governance while retaining the same Task permissions as every other Member.
_Avoid_: Owner, moderator

**Kick**:
Removal of a Member from a Group without preventing that User from rejoining.
_Avoid_: Ban

**Ban**:
A Group-scoped restriction that removes a Member and prevents that User from rejoining until an Admin lifts it.
_Avoid_: Kick, global block
