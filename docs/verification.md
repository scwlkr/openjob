# Verification modes

OpenJob has one impact-aware verification entry point. Run it from the
repository root with the revision before the work as `--base`:

```sh
npm run verify -- focused --base origin/main
npm run verify -- merge --base origin/main
npm run verify -- release-candidate --base HEAD^
```

Missing modes, unknown modes or options, and a base that is not a commit fail
before any verification gate runs. The command includes committed, staged,
unstaged, and untracked changes in its impact decision. An unclassified path or
dirty generated output escalates to the broader release-candidate scope rather
than skipping proof.

## Modes

- `focused` is the ordinary Feature Proof used to close one feature issue. It
  runs type and lint checks, affected public tests, and the issue's written iOS
  Simulator and Android Emulator journey when native or verification behavior
  can be affected.
- `merge` runs affected public integration seams. Clean native generation,
  embedded bundle export, or the broader repository suite runs only when its
  declared inputs changed or no trustworthy matching result exists.
- `release-candidate` selects the complete deterministic suite, type and lint,
  OpenAPI and secret checks, clean generated configuration, independent iOS and
  Android embedded bundles, and a machine-readable candidate handoff. It
  requires clean synchronized `main`. This mode prepares proof for a later
  coordinator; it does not build, upload, submit, or promote a Candidate
  Artifact.

Security, signing, distribution, permission, accessibility, privacy, release,
or store-compliance changes visibly escalate a requested focused or merge run
to release-candidate scope. Unknown files do the same.

## Virtual-runtime evidence

When the plan selects the virtual journeys, start the existing development
clients and complete the issue's written smoke on both platforms:

```sh
npm run native:simulators
npm run verify -- focused --base origin/main \
  --evidence ios-simulator-journey=local://issue-44/ios \
  --evidence android-emulator-journey=local://issue-44/android
```

Use a short non-secret path or URL that identifies the written evidence. A
missing platform reference fails the run. The JSON result states `reuse` when
native generation inputs are unchanged. If it states `rebuild`, regenerate and
install both development clients before recording the journeys.

## Output and reuse

One stable JSON result is written to stdout. Gate output and a concise operator
summary are written to stderr, so automation can parse stdout without scraping
logs. The result lists the requested and effective modes, changed files,
classifications, selected or escalated gates, passed, failed, reused, and
skipped outcomes, reasons, fingerprints, and unavailable external actions.

Expensive successful gates are cached in
`.openjob/verification-cache.json`. Reuse requires the full declared input and
tool/runtime fingerprint to match. Missing, malformed, partial, or mismatched
cache state is never trusted; the affected gate runs again. Passing `--cache
<path>` selects another non-secret cache file for isolated automation.

`npm test`, `npm run typecheck`, `npm run lint`, `npm run openapi:check`, and
`npm run native:check` remain available. `native:check` is the compatibility
alias for the former all-in-one native gate. Ordinary `npm test` uses
`native:quick`; clean generation and bundle exports are selected separately by
the impact-aware entry point.

## Release boundary

This command has no EAS build, Apple upload, Google upload, store-submission, or
public-promotion executor. Focused and merge runs therefore cannot reach those
actions, including after malformed input or a partial failure.

Feature issues record their scoped Feature Proof. Merge mode supports the
integration decision. The coordinated TestFlight, Play Internal, physical
device, upgrade, offline, accessibility, privacy, and store evidence remains
Release Proof on issue #41 against one immutable Release Candidate. A later
candidate coordinator consumes the handoff; this command never substitutes
virtual checks for #41.
