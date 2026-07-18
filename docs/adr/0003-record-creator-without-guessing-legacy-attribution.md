# Record Task Creator without guessing legacy attribution

OpenJob records the immutable User who creates each new Task for Push Notification routing but does not display Creator attribution in v1. Existing Tasks retain an Unknown Creator rather than treating their current Assignee as Creator because reassignment makes that inference unreliable; Creator status never preserves Group access after the User leaves.
