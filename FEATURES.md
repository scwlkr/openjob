# Features

## Task scheduling slots

The shared Task API and CLI accept an optional planned work interval independently of the date-only due date. Explicit time zones normalize to UTC; both endpoints are required, end follows start, and clearing the slot preserves the Task and due date. Existing membership and completed-Task rules apply. This stores an OpenJob plan; it does not create provider calendar events. The web editor creates, edits and clears slots with explicit UTC inputs; Task cards show the interval in UTC, including an accessible description. Validation, network failure and authentication recovery preserve the entered interval. Native visual scheduling controls remain unimplemented.
