# Record Task Creator without guessing legacy attribution

OpenJob records the immutable User who creates each new Task as an internal nullable `creatorUserId` for Push Notification routing but does not expose Creator attribution through the Task API or UI in v1. Existing Tasks retain an Unknown Creator rather than treating their current Assignee as Creator because reassignment makes that inference unreliable; Creator status never preserves Group access after the User leaves.
