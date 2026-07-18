# Task Priority

Task Priority is a post-v1 feature shipping in OpenJob `0.2.0`.

## Contract

- Every Task has exactly one Priority: High, Normal, or Low.
- Normal is the default for new requests that omit Priority and for existing stored Tasks without the field.
- API and CLI wire values are `high`, `normal`, and `low`; clients present title-case labels.
- Any Member may set Priority when creating a Task or change it while the Task is open. Done Tasks must be reopened before Priority changes.
- Done Tasks retain Priority, and reopening returns them to that Priority level.
- Simultaneous Priority changes use the existing last-accepted-write rule; OpenJob adds no Priority history.

## Ordering

- Each assignee section orders open Tasks High, then Normal, then Low.
- Within one Priority, dated Tasks come first by earliest due date, then creation time and Task ID.
- Unassigned open Tasks use the same ordering.
- Done Tasks keep their existing newest-completed-first order.
- Priority adds no filter, separate lane, custom sort, or Task List-wide grouping.

## Clients

- Web create and edit forms use a Priority selector that defaults to Normal.
- Open Tasks show compact text badges for High and Low; Normal stays visually quiet. Color is never the only signal.
- CLI create and edit accept `--priority`; JSON input and output include `priority`; list and show tables display it.

## Compatibility

- Task responses always include `priority`.
- Create requests may omit `priority` and receive Normal; Task patches may change it.
- Existing stored Tasks resolve to Normal at read time without a bulk database migration.
- The additive contract stays under `/api/v1`.
