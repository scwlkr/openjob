# OpenJob.dev — Master Mission

> A shared workspace for people and their personal agents.

15 October 2026  |  scwlkr/openjob  |  Standing product direction

> **Build an open-source workspace where people and their personal agents can manage mail, calendars, and tasks together, across the services they already use, under permissions the person controls.**

### The problem

Work is scattered across Outlook, Gmail, Purelymail, calendars, and task tools. People switch applications to connect a conversation to an action. Agents add another layer of fragmentation: they need useful access without inheriting every account, credential, or permission their owner has.

OpenJob should make these services feel like one coherent workspace. Users keep their providers and identities. OpenJob connects the work and gives both people and authorized agents practical ways to act on it.

### The experience to build

A message arrives in a connected mailbox. A person or permitted agent turns it into a task with a link to the original conversation, schedules the work on a connected calendar, completes it, and replies from the correct account. The person can see what happened and change or revoke the agent’s access.

### Product principles

**Bring your accounts.** Connect existing providers; do not force a migration to OpenJob-hosted email. Support multiple accounts from the same provider.

**Three equal modules.** Mail, Calendar, and Tasks are peers in one application. Preserve useful personal and group workflows; do not bolt two unrelated tools onto a task list.

**Agents belong in the product.** Give agents their own identities, scoped permissions, and a useful CLI/API. The human experience must remain complete without an AI subscription.

**Open, portable, and coherent.** Target web, iOS, Android, macOS, Windows, and Linux. Favor shared behavior and local/offline capability where practical, without pretending every device or provider has identical capabilities.

**Simple enough to maintain.** Add a service, abstraction, dependency, or process only when it solves an observed problem. Progress means useful, verified behavior—not more code or more paperwork.

### Outside the current mission

Do not build an email-hosting company, office suite, generic agent runtime, or enterprise administration platform. Do not add chat, documents, storage products, billing complexity, or broad automation merely to look like a larger ecosystem. Revisit expansion only when the core experience and user evidence justify it.

---

## Start with the real product

OpenJob already exists. The owner describes it as bloated, poorly executed, and only partly working. That is the reason for this program, not a substitute for an engineering assessment.

### Repository baseline

The reviewed repository documents a shared Task List for Groups, authenticated /api/v1 contracts, a real installable openjob CLI, and an Expo iOS/Android shell. Its documented services are Cloudflare Workers and Firebase/Firestore. The CLI is currently documented for macOS and does not have offline task storage. [1]

The manifest also contains existing build, API, CLI, native, verification, and release commands. AGENTS.md names Linear’s WLKR LABS / OpenJob project as the sole execution queue, superseding older GitHub-backlog instructions. [2–3]

*This baseline comes from repository documentation and configuration, not a running-system audit. Deployment health, real usage, costs, and working behavior must be verified in the first implementation session.*

### The first job: make improvement possible

**Inspect once; reuse the result.** Reproduce the main task workflow. Identify the runtime, data ownership, auth boundaries, deployment path, active work, and the few failures that most obstruct use or development.

**Keep what earns its place.** Preserve useful task/group behavior, data, identities, the shared API contract, and the existing CLI. Judge components by observed value, not by age or whether they use the preferred framework.

**Simplify what gets in the way.** Remove verified dead code, duplicate workflows, unused infrastructure, and unnecessary release friction. Do not delete unfamiliar components merely because they look complicated.

**Replace deliberately.** A substantial rewrite is allowed when it is the clearest maintainable solution. State the benefit, preserve needed behavior, define the cutover and rollback, and retire the replaced path once verified. Avoid a second unfinished product.

### Working boundaries

This mission expands the old task-only product purpose. Do not let historical product descriptions freeze that scope. Do preserve explicit access and release requirements until they are deliberately revised through the owner’s normal review path.

Do not turn initial discovery into weeks of planning. After a bounded assessment, land the smallest useful repair or simplification and identify the next product outcome. Infrastructure work must explain which workflow, reliability problem, cost, or development obstacle it improves.

### Source record

*Reviewed 15 October 2026. Product direction comes from the owner’s conversation. Technical baseline and operating rules come from the sources below; future sessions must re-read live sources. This document does not grant new production access or certify runtime health.*

- [[1] OpenJob README](https://github.com/scwlkr/openjob/blob/main/README.md)
- [[2] OpenJob package.json](https://github.com/scwlkr/openjob/blob/main/package.json)
- [[3] OpenJob AGENTS.md](https://github.com/scwlkr/openjob/blob/main/AGENTS.md)
- [[4] WStack skill](https://github.com/scwlkr/wstack/blob/main/skills/wstack/SKILL.md)
- [[5] WStack technical stack](https://github.com/scwlkr/wstack/blob/main/skills/wstack/references/technical-stack.md)
- [[6] OpenAI scheduled tasks](https://developers.openai.com/codex/automations)

---

## The product contract

### A person owns the workspace; agents receive access

An OpenJob personal account connects provider accounts and controls agent identities. The owner can assign a dedicated agent mailbox, select existing mailboxes, or grant access to a defined mailbox group. Mailbox-access groups are distinct from existing task Groups unless a deliberate domain decision unifies them.

| Control | Required behavior |
| --- | --- |
| Identity | Each agent authenticates as itself. Do not hand it the owner’s account session or upstream provider credentials. |
| Resources | Grant access to named mailboxes, mailbox groups, calendars, and task spaces. Define how membership changes affect access. |
| Operations | Separate reading, draft creation/editing, sending, modification/deletion, and access administration. Read access must not imply send access. |
| Visibility | Show effective permissions and important actions, including which agent used which sending identity. Redact secrets and unnecessary message content. |
| Revocation | Stop new actions when access is revoked; recheck queued writes before execution. Do not imply that already-read data or already-sent mail can be recalled. |

Mailbox setup means connecting or configuring a mailbox supplied by an external provider. Provision new mailboxes only where that provider supports it and the owner authorizes it. Do not represent an alias or label as a separately isolated mailbox.

### One capability model; several interfaces

The human apps, existing openjob CLI, and API must use the same domain behavior and permission enforcement. Extend the current CLI instead of introducing a parallel agent-only product. Favor machine-readable output, stable IDs, pagination, clear exit codes, and repeatable commands. Add MCP when it reduces integration effort; keep it a thin interface over the same operations.

### Broad compatibility, with honest limits

Priority targets are Gmail/Google Workspace, Outlook/Microsoft 365, and Purelymail or another standards-based mailbox. Investigate provider APIs, IMAP/SMTP, JMAP, and calendar APIs/CalDAV as needed. Maintain a tested capability matrix; “universal” is a direction, not a claim that every provider supports every feature.

Preserve account identity, folders/labels, message/thread references, and provider-specific behavior where it matters. OpenJob owns its tasks, permissions, links, and operation history; providers remain authoritative for their mail and calendar records. Local caches and pending edits must expose sync state rather than silently becoming a second truth.

### Security proportional to the actual risk

Protect credentials, enforce account/resource boundaries, validate inputs, and test allowed and denied actions. Treat incoming mail and attachments as untrusted content, never as permission to expand access. Handle ambiguous send outcomes explicitly rather than blindly retrying and sending twice. Add heavier controls only for a demonstrated risk.

---

## Use WStack; earn each migration

The current WStack skill is the live engineering standard. Read the relevant guides each session; do not copy their full contents into OpenJob. WStack preserves working frameworks, package managers, and lockfiles. Its defaults do not require a wholesale migration. [4, 5]

| Area | Preferred direction |
| --- | --- |
| Backend and data | Rust + Axum; PostgreSQL; one OpenAPI contract; Zod where useful at TypeScript boundaries. |
| Web and mobile | TypeScript; React / React Native; Expo + Expo Router; Tailwind / NativeWind; platform-appropriate components. |
| Desktop | Electron + Electron Forge when a dedicated desktop surface earns its cost. |
| Tooling and services | Cargo; pnpm for appropriate new work; Docker / Compose where services need them. Preserve current npm workflows until a migration is justified. |
| Developer controls | Reuse the owning project CLI and existing scripts. Favor Rust for a needed new CLI; do not rebuild the existing openjob CLI for language purity. |
| Delivery and access | GitHub for source and PRs; Linear for execution; 1Password references for credentials; practical browser and native tooling for affected behavior. |

### Architecture direction

Prefer one modular application with clear domains and provider adapters over a collection of new services. Centralize account identity and authorization. Keep provider-specific translation and sync behavior behind adapters, without forcing every provider into an artificially identical feature set.

Map actual mail-sync, background-job, storage, networking, and deployment requirements before choosing new infrastructure. Evaluate whether the current environment can support them. A move to Rust/PostgreSQL should remove a real constraint or simplify the system, not postpone useful delivery until a stack migration is “complete.”

### Migration and offline checkpoints

For a data or auth migration, identify users and records to preserve, validate the new path in an isolated environment, and provide a tested recovery path before any production cutover. Remove obsolete infrastructure only after the replacement is proven.

Treat local-first/cloud-optional operation as a product direction that needs an explicit sync design. Decide what works offline, where credentials live, how conflicts resolve, and what background work requires a running client or server. Do not promise fully local email automation without verifying those constraints.

### Tools are means, not milestones

Discover current commands and available skills/plugins before guessing. Use 2brain context when available, without making it a prerequisite. Use focused subagents for independent work when they save effort; Sean integrates the result. Avoid multi-agent ceremony, custom orchestration frameworks, and wrapper tools that delay the actual feature.

---

## Grow through proven outcomes

These are outcome checkpoints, not a second task backlog or fixed calendar. Sean orders the next small changes in Linear using current evidence and dependencies. Agent permissions begin early; they are not a final feature added after broad mailbox access already exists.

### 1  A dependable starting point

Existing task, identity, and group workflows can be reproduced. Development and affected checks have a clear path. The worst failure or unnecessary layer is repaired or removed. The next session can resume without rediscovering the repository.

### 2  A useful human-and-agent vertical slice

Using an owner-approved test mailbox and calendar: connect an account, receive/read a message, create a linked OpenJob task, create a calendar block, and prepare a reply. A restricted agent can perform only its permitted portion through the existing CLI/API. An allowed test send succeeds; an unauthorized read or send is rejected; revocation stops subsequent actions.

Ship this in small complete increments. The full slice is a checkpoint, not a single oversized change. Choose the first provider based on available access and implementation evidence; do not invent a fixed integration order.

### 3  A genuinely multi-provider workspace

Exercise supported workflows across Gmail, Outlook, and Purelymail/standards-based accounts, including multiple accounts from one provider. Verify correct sending identities, provider updates, reconnect/retry behavior, search and task links, and visible unsupported capabilities. Add contacts and automation when they strengthen these workflows.

### 4  A product worth using across devices

Polish the integrated experience, local caching, notifications, accessibility, installation, and recovery. Expand verified platform coverage across web, iOS, Android, macOS, Windows, and Linux without claiming that a web wrapper or successful build proves complete platform support.

### Measure results, not activity

| Question | Evidence to keep |
| --- | --- |
| Can a person finish the work? | Observed workflow result and remaining friction; screenshots when they explain a UI change. |
| Can an agent act within its scope? | A successful allowed operation, a rejected forbidden operation, and a revocation check. |
| Is the product more dependable? | Relevant failures fixed; honest sync/retry behavior; affected tests on the recorded commit. |
| Is the system easier to own? | An observed reduction in unnecessary services, steps, recurring cost, or maintenance burden. |

Do not invent uptime, adoption, cost, or speed targets without a baseline. Commit counts, issue counts, and time spent are not the success metric. Keep both a working preview and a clear distinction between code that landed and a release that actually shipped.

---

## Sean’s continuous operating model

### Overnight prototype directive — 16 October 2026

The owner requests a full working prototype by morning Central (working target 7 AM), accepting rough edges and aggressive application refactoring. Prioritize a connected Mail, Calendar, Tasks and agent experience over legacy compatibility, migration work or pixel-exact historical screens. Use up to three bounded implementation workers under one integration owner. External providers may be simulated when visibly labeled; application actions and persisted state must be real behind shared APIs/CLI where practical. Deliver a running/reproducible demo and walkthrough. A prototype is not completed live provider integration or production readiness.

Project-owned test standards may change through reviewed implementation to match this phase. Keep cheap compile/type and functional checks for account isolation, authorization, revocation and accidental real sending. Preserve external branch protections. No production release, live correspondence, credentials/settings changes, spending or permanent deletion of live data is authorized. See [prototype delivery](PROTOTYPE_DELIVERY.md).

### The session loop

Resume → choose → implement → verify → land → record → continue.

On every run, load WStack, applicable AGENTS.md guidance, this mission, w.md, the relevant Linear issue/discussion, and current Git/PR state. Resume unfinished work before opening another track. Pick one bounded outcome; complete it before selecting the next. A longer session can finish several small cycles.

Each cycle should improve a usable workflow or remove a demonstrated blocker. Fix caused failures, run affected checks and required gates, inspect real behavior, and keep the diff coherent. Do not restart discovery, manufacture busywork, or repeatedly retry an unchanged blocker.

### Keep persistent state small

| Location | Purpose |
| --- | --- |
| Master mission | docs/MASTER_MISSION.md: stable product direction. Change intentionally, not to justify an unrelated task. |
| AGENTS.md | A short mission/WStack pointer plus necessary repo rules; preserve relevant existing guidance. |
| w.md | Compact handoff: current outcome, Linear ID, branch/PR/commit, checks, blocker, exact next action, and runner pointer when relevant. |
| Linear / OpenJob | The only execution backlog and status source. Link existing work; do not duplicate it in Markdown or GitHub Issues. |
| FEATURES.md / existing docs | Update affected behavior or a consequential decision only; do not create parallel documentation systems. |

### Autonomy with clear boundaries

The proposed standing assignment lets Sean inspect, prioritize, implement, test, commit, push, and merge ordinary in-scope changes within configured permissions. Follow WStack’s human-review rule before public release; when merging triggers release, review comes before merge. [4]

Keep payment, live DNS/mail routing changes, production data/auth cutovers, destructive shared changes, and use of real mailboxes outside routine development authority unless separately authorized. Use isolated fixtures and approved test accounts. A development mandate is not permission to send real correspondence.

### Continuity and reporting

Use Sean’s available long-running or scheduled environment; the prompt does not itself create a runner. Reuse an existing OpenJob assignment, avoid overlapping work, and honor pause, timing, and resource limits. Record unavailable native/device checks honestly and continue independent work. [6]

At cycle end, record observed acceptance, check results, and the landed change or exact remaining gate in Linear/w.md. Mark Done only when the issue’s acceptance and required delivery criteria are met. Report briefly: changed; verified; remaining blocker or next action. Notify meaningful progress or needed decisions—not every routine check. Leave a durable handoff before stopping.
