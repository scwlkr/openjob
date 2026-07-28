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

- For routine Preview testing, keep the physical phone signed in as `@scwlkr` and the simulator or emulator signed in as `@qa-two`. Install updates without clearing app state, and reset fixture data instead of signing out or switching Google or Apple accounts. Follow `docs/qa-fixture.md#routine-testing-lanes`.
- Use real Google or Apple sign-in only when authentication, provider configuration, or signing changes, and once on the exact release candidate. `@qa-two` never counts as real-provider evidence.

## git 

- commit frequently and ensure git is synced
- issue-backed implementation is complete only after acceptance is verified, changes are synced, and the landed issue is closed with evidence; if a PR or blocker remains, state that gate instead of claiming completion
