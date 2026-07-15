---
id: openjob-v1-04
title: Define Invite Rotation and Membership Governance
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:grilling
claimed: true
blocked_by: []
---

## Question

What is the exact contract for joining through an Invite Link, automatic weekly rotation, manual rotation, kicks, Group-scoped bans, Admin promotion and demotion, and protection of the final Admin?

## Answer

### Invite Link lifecycle

- Every Group has exactly one active Invite Link. The service creates it with the Group and automatically replaces it seven days after issuance.
- Each issued Invite Link admits at most 25 successful joins. Opening it as an existing Member does not consume a use. When the link reaches its limit, the service invalidates and replaces it.
- Any Admin may manually rotate the Invite Link at any time. Rotation immediately invalidates the previous link and starts a new seven-day lifetime and 25-join allowance. v1 has no cooldown, rotation reason, or rotation history.
- Only Admins may retrieve and copy the current Invite Link. The link is reusable within its lifetime and allowance; v1 has no overall Group membership cap or per-person invitation flow.

### Joining and rejoining

- A signed-out User who opens a valid Invite Link completes Google sign-in and returns to the join flow. A signed-in User sees the Group Name and must explicitly confirm before becoming a Member; merely opening the URL never joins the Group.
- A User who is already a Member succeeds idempotently and enters the Group without consuming a link use.
- A former Member may rejoin through a valid Invite Link unless banned. Rejoining creates an ordinary membership and never restores prior Admin status.
- An expired, rotated, exhausted, unknown, or ended-Group link returns the same generic invalid-link result without exposing Group details. A banned User is denied membership.
- v1 has no approval queue. A successful confirmation admits the User immediately.

### Kicks, bans, and Unassigned Tasks

- Any Admin may kick any other current Member, including another Admin. An Admin cannot kick themselves; voluntary removal uses Leave Group. A kick is rejected if it would leave the Group without an Admin.
- Kicking ends membership and access immediately but does not prevent the User from rejoining through a valid Invite Link.
- Any Admin may ban a current or former Member, including another Admin. Admins cannot ban themselves, a ban cannot leave the Group without an Admin, and v1 does not allow preemptive bans of Users who have never belonged to the Group.
- Banning a current Member ends membership and access immediately. A Group-scoped ban remains until an Admin lifts it and blocks every Invite Link for that Group.
- If a kicked or banned Member is assigned open Tasks, those Tasks atomically become Unassigned. They appear in the Unassigned assignee state until any Member manually reassigns them to a current Member. Members cannot intentionally create an Unassigned Task or clear an assignee to produce one.
- Done Tasks retain the removed User as historical attribution.
- Any Admin may unban a User. Unbanning does not restore membership or Admin status; the User must rejoin through a valid Invite Link.

### Admin governance and enforcement

- Any Admin may promote a current Member to Admin or demote any Admin, including themselves. Demotion is rejected if it would leave the Group without an Admin. The creator has no special protection.
- Kick, ban, unban, promotion, and demotion take effect immediately. Each operation atomically checks current membership, Admin status, and final-Admin protection so concurrent requests cannot leave a Group without an Admin.
- v1 has only Member and Admin governance roles. It has no ban expiration, ban reasons, governance history, or governance notifications.
