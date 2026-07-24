# Test with two permanent isolated Users

OpenJob maintains two permanent ordinary Test Users, `@qa-one` and `@qa-two`,
for repeatable real-world testing. `@qa-one` uses the real Google provider.
`@qa-two` uses one internal password principal in an isolated
`openjob-nonprod` Identity Platform tenant. That tenant disables public User
signup and deletion, and the Preview Worker accepts only its exact tenant and
Firebase UID. The password path is visible only in Preview clients, cannot be
linked, and is not a supported product Sign-in Method or evidence for Google or
Apple acceptance.

After authentication, both Users call the same `/api/v1` routes and receive no
privileged product endpoint or authorization bypass. Their memberships are
limited to clearly identified disposable QA Groups, and a deterministic reset
restores known Tasks, roles, installation subscriptions, and notification
state. Credentials and recovery material live in the owner-controlled
1Password vault outside the repository and diagnostics.

The two Users exercise cross-User behavior across iOS, Android, the PWA, API,
and release paths, including assignment, completion, Push Notifications,
refresh, offline reference, concurrent conflicts, and Group governance.
Destructive or high-volume automation remains non-production-only. Real Google
and Apple product acceptance remains a separate gate and cannot be replaced by
the internal QA password principal.
