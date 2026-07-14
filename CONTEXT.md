# OpenJob

OpenJob coordinates small working groups through one shared task list. It intentionally stays smaller than a project-management system.

## Language

**Group**:
A membership boundary with exactly one Task List.
_Avoid_: Workspace, organization

**Invite Link**:
A short-lived, Group-specific credential that lets a signed-in User become a Member.
_Avoid_: Public link, invitation

**Task List**:
The single flat collection of work belonging to a Group.
_Avoid_: Project, Kanban board

**Task**:
The smallest unit of work on a Task List, assignable to a Group Member by username.
_Avoid_: Job, ticket, card

**User**:
A person with one OpenJob identity that can participate in multiple Groups.
_Avoid_: Account, profile

**Username**:
A globally unique, first-come identifier for a User, used for assignment and recognition across Groups.
_Avoid_: Display name, email address

**Member**:
A User participating in a Group.
_Avoid_: Collaborator, teammate

**Admin**:
A Member trusted with Group governance while retaining the same Task permissions as every other Member.
_Avoid_: Owner, moderator
