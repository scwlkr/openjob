# OpenJob build specification

**Owner-confirmed core plus Proposed detail · 16 October 2026 · documentation only**

This is the detailed implementation specification supporting draft [PR #87](https://github.com/scwlkr/openjob/pull/87), not a competing platform proposal. The master mission is the mandate. [platform blueprint](../PLATFORM_ARCHITECTURE.md), [Companies and Identity](../COMPANIES_AND_IDENTITY.md), and [ADR 0019](../adr/0019-propose-modular-platform-and-runtime-boundaries.md), [0020](../adr/0020-propose-workspace-and-principal-boundaries.md), and [0021](../adr/0021-propose-provider-authority-and-integration-execution.md) are the architecture baseline. The [owner confirmation record](../ARCHITECTURE_ALIGNMENT.md) supersedes conflicting Company hierarchy, ownership, agent and navigation proposals. ADR 0020 records that confirmed core plus Proposed detail; ADRs 0019/0021 remain Proposed. C09–C10 confirm owner-first daily-use/early-iOS priority and online/offline staging; hosting remains undecided. This package does not authorize implementation/access or prove production behavior.

## Read in this order

1. [Decision register](DECISIONS.md): recommended defaults and the short owner review list
2. [Product requirements](PRODUCT.md): stable requirement IDs, core boundaries and completion criteria
3. [Experience specification](EXPERIENCE.md): navigation, screens, actions and non-happy states
4. [Domain and permissions](DOMAIN.md): identity, ownership, lifecycle and exact authorization rules
5. [Contracts and integration](CONTRACTS.md): current code seams and proposed API/CLI/connector changes
6. [Runtime and data policy](RUNTIME.md): hosted-first recommendation, local delivery, operational/data defaults and alternatives
7. [Build roadmap](ROADMAP.md): dependency-ordered slices and acceptance evidence; Linear remains the only execution queue
8. [Session handoff](HANDOFF.md): how a future session selects and completes the next authorized slice without repeating product discovery
9. [Completeness audit](COMPLETENESS.md): implementation-ready decisions, bounded technical work still required and release gates

## Authority and change control

- Owner’s latest explicit direction and applicable access/release constraints govern the work
- Mission: `docs/MASTER_MISSION.md` on main, inspected at `9ba3929fbf0ccc3e24e2577410a355fa3798736e`
- Historical pre-alignment design snapshot: PR #87 at `98f4da596c743c7bf577afb6b584ac38d408ab9f`
- Confirmed core: [C01–C10 and actual user turn references](../ARCHITECTURE_ALIGNMENT.md)
- This package: detailed proposed elaboration beyond that core. Where it adds a default, the decision register records it as proposed. Do not mistake prose for owner acceptance
- Execution status and next work: [Linear OpenJob](https://linear.app/wlkr-labs/project/openjob-fa4830c93118), current code/PR state and compact `w.md`
- Contract truth after implementation: one `openapi/openapi.yaml` plus tested domain contracts. No competing API generated from this prose
- Market context: [evidence register](../market-evidence.md). The differentiator is a hypothesis, not validated demand

This directory is the integrated proposed detail set in PR #87. After owner review, record accepted/amended decisions once in these documents and the corresponding ADRs. The Library ZIP and executive deck/memo are source snapshots and summaries, not independently changing authorities. See [source provenance and reconciliation](SOURCE.md). Only C01–C10 have confirmation references; no whole-package acceptance is recorded; Linear alone tracks execution.

## What “build this” should mean

Build the accepted requirements through the roadmap’s dependency order, keeping the useful prototype and shared API/CLI. Resolve ordinary implementation details with the documented defaults and verification. Return to the owner only for a material product/architecture change, an explicit review gate, missing access, or a consequential action requiring permission. Future engineering can still uncover constraints; it should not reopen settled product choices without evidence.

Current evidence is a working invented-data prototype and isolated contract tests. Shared Workspaces are not implemented; provider Mail is simulated; production consent, sync, sending, Calendar writes, secure provider credentials and native/device release acceptance are not established. No application code, infrastructure or live data was changed in preparing this specification.
