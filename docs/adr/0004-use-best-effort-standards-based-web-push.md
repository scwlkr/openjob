# Use best-effort standards-based Web Push

OpenJob uses standards-based Web Push so supported browsers, including installed iPhone and iPad Home Screen apps, share one feature-detected delivery path. Delivery runs asynchronously only after a successful Task change; a failed or missed notification never fails the Task action, and v1 has no durable retry pipeline. Each browser subscription persists through sign-out while its OpenJob User association pauses, then resumes only when the same User returns; another User must explicitly enable notifications for themselves.
