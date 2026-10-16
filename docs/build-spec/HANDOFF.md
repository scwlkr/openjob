# Session handoff and continuity contract

This is a reusable implementation prompt after the owner has reviewed the design and authorized development. It does not lift the present design pause or confer provider/resource/publication permission. The proposed specification is integrated into PR #87's document system; record owner acceptance there before relying on it as adopted direction.

## Reusable prompt

> Build the accepted OpenJob platform specification, continuing the existing project rather than restarting discovery. First read current AGENTS.md, docs/MASTER_MISSION.md, w.md, the accepted platform blueprint/Companies and Identity/ADRs 0019–0021, the adopted build-spec index and the files relevant to the next slice. Read current WStack and relevant guides, available repository skills, the active Linear OpenJob issue/discussion, and current Git/PR/check state. Treat the mission as product mandate, accepted ADRs as decisions, this specification as detailed requirements, current OpenAPI/tests as implemented contracts, and Linear as the only execution queue.
>
> Check whether design review is actually accepted and whether another session already owns unfinished work. Resume that work first. Compare the recorded source commit and current branch, read the relevant diff and material comments; do not re-audit the whole repository without evidence of drift. Before IMAP TLS/login work, reconcile WLK-302's saved work/current disposition. Preserve the exact approved npm artifact and any pending authentication/publication workflow; do not replace bytes under the same version.
>
> Select the earliest dependency-satisfied, authorized slice in ROADMAP.md, reconciled to the current Linear item. Record the requirement/slice IDs and a bounded outcome. Use the documented defaults; do not ask the owner again about settled scope, provider authority, Company ownership, role boundaries, shared API/CLI or routine file/layout choices. If current evidence materially invalidates a decision, present the smallest evidence-backed decision and continue unaffected work.
>
> Inspect relevant code and test/run instructions, then implement the smallest coherent vertical change across domain/repository/API/OpenAPI/CLI/UI/native surfaces needed for the outcome. Preserve working stack, useful shared/Personal behavior and the CLI; replace obsolete prototype contracts/screens coherently where no active consumer depends on them. Keep compatibility adapters only for actual consumers and migration work only for real data that must be retained. Do not create a second task engine, schema authority, agent-only API or backlog. APIs enforce authorization and ownership; UI hiding is never the control. Keep fixture/mock/live modes visibly distinct and fail closed on unsupported capabilities.
>
> Use isolated fixtures until the specific live account/resources/operations are authorized. Design acceptance and a development mandate do not authorize provider credential creation/configuration, persistent access, real correspondence/invitations, production data/auth migrations, spending, destructive shared changes, publishing or deployments. Follow current permissions and release rules; use the user's requested environment and local Mac delivery preference. Ask only for the exact missing approval or resource when it blocks dependent work.
>
> Keep verification proportionate: cheap compile/type and affected happy path plus changed permission/send-safety boundary each cycle; targeted protocol/fault/device qualification when those boundaries change or at their release gate. Exercise relevant interrupted/repeated UI flows, not an exhaustive campaign after every edit. Follow required current repository gates/external protections on the final head; revise obsolete project-owned tests honestly and preserve failed/not-run vs passed distinctions. For native/platform claims obtain required device/release evidence; a build alone is not behavior proof. Resolve caused failures. If a required gate is blocked, record the exact blocker and complete independent authorized work.
>
> Land only within the current development/merge authority and external protections. Source merge, npm dev/latest publication, hosted deploy and native release are separate events with separate evidence/authorization. Verify remote commit and any authorized published artifact/channel before claiming success. Record a compact handoff in w.md and the relevant Linear item: changed outcome, requirement/slice IDs, branch/PR/source commit, checks/evidence, current runtime/capabilities, delivery state, blocker and exact next action. Do not copy the roadmap into a second status tracker. Keep going to the next authorized dependency-ready outcome when requested; stop dependent work for missing authority, not for repeated discovery.

## Minimum cycle record

- Outcome and requirement/slice IDs
- Linear issue, branch/PR, exact commit and artifact/version/channel if any
- Changed API/domain/UI/CLI/native surfaces
- Evidence: fixture, injected provider transport, authorized live read/write, named-device runtime, publication/deployment readback
- Checks: passed, failed and not run with reasons
- Remaining blocker and precise next action, including which approval/resource is missing
- Accepted decision change, only if one actually occurred

Keep this record compact and current in existing Linear/w.md. No new long-running status document is required. A link to the accepted design is enough; do not duplicate the product charter in every handoff.

## When to ask the owner again

Ask for a material scope/ownership/architecture change, a conflict in explicit direction, a consequential action needing authorization, missing account/resource access, or a release review that applies. Do not ask which basic screens/entities to build, whether Company membership grants Mail access, whether provider data is authoritative, whether the agent may use human tokens, or whether the existing CLI should be retained; the accepted documents answer these. Actual provider limitations may require a capability restriction or a narrow ADR update, with evidence.
