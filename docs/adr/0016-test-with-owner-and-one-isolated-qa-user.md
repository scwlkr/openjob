# Test with the owner and one isolated QA User

OpenJob uses one stable two-User Preview fixture for repeatable real-world
testing. The Owner role maps to the existing Google-backed `@scwlkr` User;
OpenJob does not create or maintain a dedicated Google test account or an
`@qa-one` User. The second User, permanent `@qa-two`, uses one
internal password principal in an isolated `openjob-nonprod` Identity Platform
tenant. That tenant disables public User signup and deletion, and the Preview
Worker accepts only its exact tenant and Firebase UID. The password path is
visible only in Preview clients, cannot be linked, and is not a supported
product Sign-in Method or evidence for Google or Apple acceptance.

After authentication, both Users call the same `/api/v1` routes and receive no
privileged product endpoint or authorization bypass. QA activity is confined
to the clearly identified disposable QA Group. A deterministic reset restores
that Group's known Tasks and roles while preserving every `@scwlkr` non-QA
Group and notification registration; `@qa-two` remains isolated from non-QA
Groups. The owner binding and QA Two credentials live in the owner-controlled
1Password vault outside the repository and diagnostics. The
`OpenJob Preview Owner Binding` item records the nonproduction stable User ID
and owner-account reference but does not duplicate the Google password.

The two Users exercise cross-User behavior across iOS, Android, the PWA, API,
and release paths, including assignment, completion, Push Notifications,
refresh, offline reference, concurrent conflicts, and Group governance.
Destructive or high-volume automation remains non-production-only. Real Google
and Apple product acceptance remains a separate #37 gate and cannot be
replaced by the internal QA password principal.
