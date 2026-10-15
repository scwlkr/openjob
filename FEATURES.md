# Features

## Task scheduling slots

The shared Task API and CLI accept an optional planned work interval independently of the date-only due date. Explicit time zones normalize to UTC; both endpoints are required, end follows start, and clearing the slot preserves the Task and due date. Existing membership and completed-Task rules apply. This stores an OpenJob plan; it does not create provider calendar events. The web editor creates, edits and clears slots with explicit UTC inputs; Task cards show the interval in UTC, including an accessible description. Validation, network failure and authentication recovery preserve the entered interval. Native visual scheduling controls remain unimplemented.

## Scoped agent Task reads

A signed-in human can issue, list and revoke a named agent grant through `/api/v1/agent-grants`. Each opaque credential permits only Task list/item GETs in one current Task Group for 24 hours. The service stores its hash, binds it to the owner's membership generation, and rechecks access before returning data or a conditional 304. Revocation, expiry, account deletion and membership loss/rejoin stop access. Grants cannot modify Tasks, administer Groups, read other APIs, Mail or Calendar. Account deletion removes owned grant records. Owner management UI and broader scopes remain future Linear work.

The existing CLI accepts an explicit `--agent-token-file <path|->` on `task list` and `task show`, together with explicit `--group`. It never refreshes or falls back to human credentials for these reads. Isolated API/Firestore/CLI fixtures verify behavior; no production grant is created by development checks.
