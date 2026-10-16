# OpenJob review companion

> Historical Library review summary. Company hierarchy/agent/navigation details
> are superseded by [owner-confirmed alignment](../ARCHITECTURE_ALIGNMENT.md).
> Current editable detail is the build specification; this memo is not authority.

Decision companion v2 · 16 October 2026 · Aligned to the detailed build specification

Purpose: connect the product case to explicit technical choices, evidence and review gates. The standing [Master Mission](https://github.com/scwlkr/openjob/blob/9ba3929fbf0ccc3e24e2577410a355fa3798736e/docs/MASTER_MISSION.md) remains the mandate. This memo does not replace the blueprint, accept its ADRs or authorize implementation, live access, deployment or release.

Reader guide: the deck is the executive layer. This memo maps goals to ADRs and evidence. The detailed implementation package starts at [build-spec/README.md](../build-spec/README.md), with requirements, experience, domain rules, contracts, runtime defaults, roadmap, handoff and completeness audit. Read that package before interpreting a broad slide as a build instruction.

## 1. Product position and the claim to test

OpenJob should help a person finish work across existing Mail, Calendar and Tasks accounts with one coherent human experience and optional scoped agent participation. The organizing unit is a conversation linked to its action, reserved time and outcome. Users retain providers and identities. Agents receive distinct identities and limited authority.

Initial customer hypothesis: independent consultants, fractional operators and small agency owners who manage personal and client/company accounts. Their proposed reason to add OpenJob is continuity across account and organizational boundaries, with explicit delegation. Frequency of pain, setup tolerance, retention and willingness to pay are unvalidated.

Google and Microsoft already connect email, tasks and calendars. Nextcloud Groupware combines open-source Mail/Calendar/Tasks and now documents cross-app agent tools. Thunderbird and Kontact are established account-aggregation alternatives. The credible wedge is narrower: person-first multi-company context, provider portability and independently attributable, revocable resource/operation-scoped agents. Reviewed competitor docs do not establish the whole combination. That does not establish its absence or customer demand. The separate market evidence register preserves primary sources and limits.

## 2. Mission traceability

| Mission requirement | Design implication | Deck |
|---|---|---|
| Bring existing accounts | Connection-qualified identities, honest provider capabilities and no forced mailbox migration | 3, 8, 10 |
| Three equal modules | Peer Mail/Tasks/Calendar modules with a composed Today view and source links | 4, 6, 7 |
| People and agents | Complete human app, distinct agent principals, one API/CLI capability model | 7, 8, 11 |
| Open and portable | Shared contracts with explicit hosted, demo and future local profiles | 9, 12 |
| Simple enough to maintain | One modular application, durable job records, no speculative services or stack rewrite | 9, 10, 14 |

Sources: [Master Mission](https://github.com/scwlkr/openjob/blob/9ba3929fbf0ccc3e24e2577410a355fa3798736e/docs/MASTER_MISSION.md), [platform blueprint](https://github.com/scwlkr/openjob/blob/98f4da5/docs/PLATFORM_ARCHITECTURE.md). Scope excludes mail hosting, a full office suite, a generic agent runtime, a plugin marketplace and speculative enterprise infrastructure.


---


# Architecture decisions

The existing ADRs remain Proposed. Acceptance may amend these recommendations.

## 3. The decision map

| Decision / diagrams | Proposed choice | Tradeoff / review gate |
|---|---|---|
| ADR 0019<br>Context: slide 8<br>Containers: slide 9<br>Deployment: slide 12 | One modular application with named contexts, repositories and shared versioned operations. API and runner are logical containers. Preserve useful TypeScript/React/Expo, Cloudflare and Firebase components. | More interface discipline inside one deployment. Extract processes or replace stores only for observed runtime, lifecycle, isolation or query constraints. Choose first live hosting profile independently. |
| ADR 0020<br>Identity: slide 5<br>Authority: slide 11 | One User and personal workspace per installation. Independent Company memberships. Each workspace has exactly one personal User or Company owner. Explicit invitations, roles, grants and context selection. | More explicit relationships and lifecycle coordination. Existing Groups and global sign-in links need compatibility decisions. Company-managed login cannot unlock Personal or other Companies. |
| ADR 0021<br>Work loop: slide 7<br>Ownership: slide 10 | Providers own Mail and external calendar truth. OpenJob owns Tasks, blocks, grants and receipts. Persist external intent before execution, with stable IDs and attributable outcomes. | Bounded projections need retention and cleanup policy. No cross-provider transaction. Uncertain sends require reconciliation rather than a blind retry. |

Decision sources: [ADR 0019](https://github.com/scwlkr/openjob/blob/98f4da5/docs/adr/0019-propose-modular-platform-and-runtime-boundaries.md), [ADR 0020](https://github.com/scwlkr/openjob/blob/98f4da5/docs/adr/0020-propose-workspace-and-principal-boundaries.md), [ADR 0021](https://github.com/scwlkr/openjob/blob/98f4da5/docs/adr/0021-propose-provider-authority-and-integration-execution.md). Detailed role, invitation and departure defaults: [Companies and identity](https://github.com/scwlkr/openjob/blob/98f4da5/docs/COMPANIES_AND_IDENTITY.md).

## 4. Contract and ownership details that must survive implementation

One operation model. The app, existing CLI and agent API use the same domain behavior and server-side authorization. A future MCP interface stays thin. Selecting a Company or workspace ID grants no access by itself.

Connection identity. Bind workspace ID, connection ID, verified upstream subject, consented capabilities, controller and server-only credential reference. External references also identify record kind and provider object ID. Addresses and thread IDs alone are insufficient.

Scheduling invariant. Tasks owns the canonical task-to-OpenJob-block relationship. Calendar owns the interval. One application operation coordinates creation, rescheduling, unscheduling and deletion transactionally. A provider event uses a separate explicit intent/result.

Private source context. A shared task may retain an unavailable source stub. It must not copy or disclose private Mail or create a cross-company grant. OpenJob drafts and provider drafts remain distinguishable.


---


# Feasibility, lifecycle and deployment

## 5. Evidence boundary

The mission at main commit 9ba3929 documents a persisted invented-data personal Mail/Task/Calendar journey, shared API/CLI, scoped personal grants and offline mechanisms. Gmail/Graph/bounded IMAP translation has injected-transport proof. Provider Mail remains simulated in the full journey, live production connections are unconfigured and mock OAuth remains Google-only. Company tenancy, full IMAP TLS/login/MIME, production Firebase offline startup and native device/release acceptance remain unverified. This review reads repository evidence; it is not a fresh runtime audit. [Mission checkpoint](https://github.com/scwlkr/openjob/blob/9ba3929fbf0ccc3e24e2577410a355fa3798736e/docs/MASTER_MISSION.md) and [prototype delivery](https://github.com/scwlkr/openjob/blob/98f4da5/docs/PROTOTYPE_DELIVERY.md).

## 6. Principal feasibility risks and the evidence needed

| Risk | Required proof / owner decision |
|---|---|
| Provider authorization | Select one approved provider/test account. Prove consent, verified identity, current scope checks, secure refresh, reconnect and bounded Inbox reads. Google verification/restricted-scope obligations and Microsoft tenant consent can constrain the initial audience. |
| Durable integration | Proposed default: bounded same-codebase runner, Firestore leases/outbox and stable receipts. Prove restart, leasing, reconciliation and uncertain outcomes against actual provider/runtime limits. |
| Tenancy and identity | Test independent roles and resource visibility across two Companies plus Personal. Assess current sign-in linking and Group compatibility before claiming employer-isolated authentication or changing ownership. |
| Live-data responsibility | Review minimal pilot metadata caching without persistent provider bodies/attachments. Preserve authored drafts/receipts and cleanup. Later scope adds controlled Mail caches and Company offline writes. Validate hosting/backup configuration. |
| Local and device support | Define identity, local secrets, background lifecycle, remote agents and optional sync before calling the Node demo a secure local service. Prove actual device behavior separately from builds. |

Sources: [blueprint](https://github.com/scwlkr/openjob/blob/98f4da5/docs/PLATFORM_ARCHITECTURE.md), [Google scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference). The degree of compliance and provider policy work depends on chosen deployment, distribution and scopes; this memo does not certify it.

## 7. Lifecycle and deployment defaults for review

Revocation first blocks new authorization and rechecks queued actions. Identity/Workspace coordinates membership departure or account deletion. Delegation stops derived grants. Connections owns credential/provider cleanup completion. Mail/Calendar invalidate readable projections. Tasks preserves company-owned work and reconciles planning links. An unavailable provider leaves cleanup pending. Previously read content or sent mail cannot be recalled.

Hosted-first preserves existing identity and remote clients. The full npm client uses that service while the synthetic demo stays separate. Secure local hosting needs an explicit profile. Local CI does not choose app hosting. Source, npm, deployment and native release retain separate gates.


---


# Validation and owner choices

## 8. Product and delivery evidence

Customer discovery now. Recruit a small purposive group through independent-professional networks and open-source groupware communities. Observe their most recent real cross-account message-to-work workflow and current alternative. Ask about provider access policies, context boundaries, setup cost, trust and willingness to pay. These are proposed channels, not an acquisition forecast. Avoid leading with AI as a required benefit.

One useful live slice. Approved account consent and verified identity, paged Inbox/reconnect, linked Task, planned OpenJob block and local draft. Add provider send/calendar writes only with separate supported capabilities and consent. Show the same operations through the app and CLI.

Company acceptance. Use Alex (Employee A, Admin B), Sam (Owner A, no B membership) and Jo (Owner B, Guest A), each with personal work. Demonstrate invitation/acceptance, role/resource visibility, switching, and departure from A preserving Personal/B. This is the blueprint scenario, not evidence of existing implementation.

Agent acceptance. Demonstrate an allowed operation, a denied operation, attributable activity and human revocation. Read does not imply draft/send. No upstream credential leaves the server boundary. Company-agent authority cannot silently outlive its sponsoring basis.

| Question | Measure before setting a numeric target |
|---|---|
| Does it improve real work? | Observed loop completion, current-tool comparison, time/steps and handoffs, voluntary weekly return use and reasons for abandonment. |
| Does context remain clear? | Wrong-context or sending-identity errors, missing source links, accidental disclosure and recovery friction. |
| Is delegation trustworthy? | Allowed/denied/revoked checks, visible effective grants, understandable receipts and failed/uncertain operation handling. |
| Can a small team own it? | Observed failure rate, stale/blocked sync, queue age, manual recovery steps and maintenance cost. |

## 9. Decisions requested

Owner design review has three choices: product/ownership and full-target scope, hosted-first runtime with full installed clients, and privacy/offline experience. The decision register supplies proposed defaults. Specific provider/test-account access is a later execution gate. The build roadmap expands the deck into P0-P5 dependency stages with 22 bounded slices and acceptance evidence. Continue execution in Linear after design review; these stages are not another backlog.

Revise the wedge if users prefer existing suite/PIM workflows, cannot authorize provider access, or do not reuse the cross-context journey. Expand provider, local and company features when the evidence supports them. No TAM, adoption, performance, security certification or uptime claim is established.

Source snapshots: mission 9ba3929; design 98f4da5. Market checked 16 October 2026. See [build-spec/README.md](../build-spec/README.md) for authority/change control and the evidence register for competitor source limits, including [Nextcloud docs](https://docs.nextcloud.com/server/stable/user_manual/en/ai_assistant.html).
