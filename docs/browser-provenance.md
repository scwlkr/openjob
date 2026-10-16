# Brand visual gate provenance

The brand light/dark visual test attaches `browser-provenance` JSON from the
same Playwright browser fixture that performs its screenshots. It records the
observed browser version/build and executable hash when CDP exposes it, the
installed Playwright browser pin, runner platform, source commit/tracked changes,
and hashes selected by `testInfo.snapshotPath`. Path labels are repository-relative
for baselines within the repository and basenames otherwise; the executable uses
only its basename. It excludes browser arguments, absolute paths and environment values. A version match alone does not establish
that the executable came from the pinned artifact.

Keep this attachment with the expected/actual/diff images when diagnosing a
failure. Separate Linux and Darwin snapshots are selected by Playwright's
platform-aware paths; do not copy one platform's baseline to another. Preserve
the failed receipt before another run clears the test output. Resolve browser
or baseline provenance before changing a comparison or accepting new images.
