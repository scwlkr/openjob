# OpenJob

## Purpose

OpenJob is an open source repo that is designed for teams to be able to create groups to have shared task list that are extremly simple and easily assignable to individuals with the @{username} 

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

OpenJob uses a single-context root glossary and root ADR directory. See `docs/agents/domain.md`.

## Authentication

- When Touch ID-backed access may be needed, consolidate authentication at the start and try to use one in-memory unlock for the task so work can continue if the owner steps away. Never persist session tokens or secrets merely to avoid another prompt.

### Authentication testing

- Run all development, feature, regression, and Preview testing before the final release through iOS Simulator and Android Emulator on this Mac. Keep persistent simulated sessions for `@scwlkr` and `@qa-two`, install updates without clearing app state, and reset fixture data instead of signing out or switching Google or Apple accounts. Follow `docs/qa-fixture.md#routine-testing-lanes`.
- Do not use a physical iPhone or Android device before final Release Proof. If behavior cannot be exercised in a simulator or emulator, record that exact check as deferred Release Proof rather than treating it as passed. The exact final release candidate must still pass the coequal physical iPhone and Android gates in `docs/adr/0017-require-cross-platform-native-release-evidence.md`.
- This repository policy overrides GitHub issue text that requests physical-device evidence before final Release Proof. Reclassify that acceptance item as a deferred #41 gate; it does not block the feature issue from closing once its simulator/emulator Feature Proof passes.
- Use real Google or Apple sign-in before final release only when authentication, provider configuration, or signing changes, and only in the local simulator or emulator. Repeat real-provider acceptance on physical devices once for the exact final release candidate. `@qa-two` never counts as real-provider evidence.

## git 

- commit frequently and ensure git is synced
- issue-backed implementation is complete only after acceptance is verified, changes are synced, and the landed issue is closed with evidence; if a PR or blocker remains, state that gate instead of claiming completion
