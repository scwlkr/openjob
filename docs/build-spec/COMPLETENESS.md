# Specification completeness and readiness audit

**Assessment: ready for owner product/architecture review; implementation starts only after recorded acceptance and the applicable development authorization. Not production-ready and not a promise of question-free engineering.**

## What is specified well enough to implement

| Area | Defined | Trace |
|---|---|---|
| Product scope | Equal Mail/Calendar/Tasks; separate agents; personal/multi-company architecture; first pilot vs full target; explicit non-goals | PRODUCT, DECISIONS |
| Human experience | Shell, routes, context switching, screens/actions, source/draft/compose/plan flows, accessibility and failure states | EXPERIENCE |
| Ownership and policy | Entities, Personal/Company boundary, roles, resource operations, source privacy, invitation/departure/transfer and agent authority | DOMAIN |
| Contracts | Current code seam map, additive context endpoints, legacy compatibility, revisions/idempotency/error/state rules, CLI and adapter strategy | CONTRACTS |
| Runtime | Hosted authority on retained stack, normalized Firestore, durable runner, encrypted credential repository and full npm client profile | RUNTIME |
| Data handling | Concrete proposed minimal pilot cache/retention, source cleanup, authored draft distinction, later controlled offline scope | RUNTIME |
| Delivery | 22 bounded slices, dependencies, proof, traceability and named native/npm/provider outcomes | ROADMAP |
| Continuity | Authority order, resume prompt, current code/Linear checks, compact cycle record and escalation boundary | README, HANDOFF |

After the three owner review choices are accepted, the specification supplies the product/scope/architecture defaults needed to start R10–R22 in isolated development without another discovery interview. It also defines the live/full-product targets and their safety/acceptance gates. Future technical evidence can still require a deliberate revision.

## What still needs implementation-level detail

These are bounded engineering outputs owned by a specific slice, not open product questions or reasons to wait indefinitely.

| Remaining detail | Default already selected | Where it is finished / required evidence |
|---|---|---|
| Exact collections/indexes, field schema and transaction granularity | Per-entity Firestore; preserve needed Personal/shared-task behavior; temporary legacy adapters only for active consumers | R10 current contract diff; migration/rollback only if actual retained data exists |
| Eligible personal-anchor proof and current-user compatibility | Unknown/managed proof cannot unlock global Personal/multi-company; company SSO disabled | R11 issuer/subject/account evidence and negative tests; preserve old Personal access while resolving eligibility |
| Exact OpenAPI path schemas, CLI flags and generated types | One existing `/api/v1` contract; additive workspace routes; shared auth and errors | R21/R22 OpenAPI/type/contract tests, not a second prose schema |
| Credential ciphertext schema/key-wrap implementation and runtime configuration | Standard envelope encryption; server-only encrypted Firestore records, key in deployment secret store; existing broker seam | R31 crypto/security review, approved setup, key rotation/recovery and no-secret evidence |
| Scheduler packaging and actual limits | Bounded scheduled worker in same codebase; Firestore leases/outbox | R30/R31 actual deployment-profile proof; narrow worker extraction only if measured constraint |
| Provider-specific consent/scopes/delta/search/thread/draft/calendar behavior | Capability-oriented adapters, explicit provider authority, no fictitious universal semantics | R31/R32/R40–R42/R50 official current docs plus conformance/live evidence |
| Calendar series/invitation wire operations | Explicit occurrence/series scope; separate notification capability; no hidden attendees | R51 exact provider mapping and test-recipient proof |
| Per-platform secure caches/loopback login bridge | Platform-protected cache, context fencing, no offline effects, hosted authority | R52–R54 device/security/interruption tests; unsupported platforms remain honest |
| Hosting region, operator access, backup settings and public compliance/disclosures | Separate environments; no unapproved residency/compliance promise; privacy inventory and restore test | R31 approved live resources; R55 actual configuration/inventory/restore evidence |

No endpoint or field-level schema above is claimed to exist already. The live provider/specification completeness boundary is explicit: design selects behavior and architecture; the assigned slice supplies exact code/schema/runtime proof before its acceptance. If a bounded task uncovers a material design contradiction, change the canonical decision deliberately and trace the affected requirements.

## Remaining owner choices versus execution gates

Owner design review: accept/adjust (1) scope/ownership and full-product target, (2) hosted-first + full installed clients, (3) privacy and online-first Mail followed by controlled offline capability. Technical cache/cleanup defaults are supplied, not a storage-knob questionnaire. Suggested defaults are complete, not a list of unanswered alternatives.

Execution gates later: connected authorized environment, provider/test accounts, OAuth or standards credentials, permitted test recipients/Calendar effects, key setup, real hosting/data-location confirmation, production migration, publication/deployment/native release permissions. Lack of these does not prevent accepting the design or completing isolated contracts/UI/fixtures. It does prevent claiming live/production completion.

## Evidence limits

- Current implementation statements come from source inspection at main `9ba3929...` and PR #87 `98f4da5...`, the mission and supplied repository evidence. No fresh app test campaign or production health audit was run for this documentation task
- Company tenancy, real consent/credential runtime/sync/send/Calendar writes and native/device release acceptance are not proven by the existing prototype
- The market register supports a differentiation hypothesis. It does not establish competitor absence, demand, adoption, market size or willingness to pay
- No dates, team capacity, cost budget, availability target or security certification is invented
- The source package was prepared without repository/Linear changes. This integration changes repository documentation and records delivery in Linear; it performs no infrastructure operations, credential setup, provider calls or releases

## Package review checks

Before delivery, verify local document links, requirement/slice coverage, no Proposed→Accepted promotion, source refs, consistent pilot/full scope, runtime/client distinction and permission gates. These checks validate the document package only. They do not substitute for application tests, owner approval or a successful release.

## Source register

1. [Master Mission, inspected main](https://github.com/scwlkr/openjob/blob/9ba3929fbf0ccc3e24e2577410a355fa3798736e/docs/MASTER_MISSION.md)
2. [PR #87](https://github.com/scwlkr/openjob/pull/87) and [platform blueprint at review head](https://github.com/scwlkr/openjob/blob/98f4da596c743c7bf577afb6b584ac38d408ab9f/docs/PLATFORM_ARCHITECTURE.md)
3. [Companies and Identity](https://github.com/scwlkr/openjob/blob/98f4da596c743c7bf577afb6b584ac38d408ab9f/docs/COMPANIES_AND_IDENTITY.md) and proposed ADRs 0019–0021 in that same tree
4. [AGENTS.md](https://github.com/scwlkr/openjob/blob/9ba3929fbf0ccc3e24e2577410a355fa3798736e/AGENTS.md), existing ADRs, package scripts, API/CLI/domain/provider files named in CONTRACTS.md
5. [WStack](https://github.com/scwlkr/wstack/blob/c3e3ac671d2df19158ba6390e356f978e1abc1a8/skills/wstack/SKILL.md) and [technical guidance](https://github.com/scwlkr/wstack/blob/c3e3ac671d2df19158ba6390e356f978e1abc1a8/skills/wstack/references/technical-stack.md)
6. [Market evidence register](../market-evidence.md), checked 16 October 2026
7. Cloudflare/Firestore official implementation references linked at the specific runtime claims in RUNTIME.md

Re-read live repository/Linear/provider documentation at implementation time. These fixed SHAs preserve provenance; they do not freeze future valid changes.
