# Owner-confirmed workspace architecture

**Confirmed core, 16 October 2026.** These decisions supersede conflicting PR #87
proposals. The later C09–C10 pilot/staging decisions below also apply. These confirmations
do not adopt hosting, exact storage/retention choices, role presets,
full specification, or ADRs 0019/0021, and do not authorize feature implementation.

## Confirmed decisions

| ID | Owner-confirmed direction | Boundary |
|---|---|---|
| C01 | One personal OpenJob identity participates in multiple independent Workspaces | Personal, company and family contexts do not require duplicate accounts |
| C02 | Company is a Workspace in the initial model; groups/permission sets organize access inside it | No separate Company entity containing multiple Workspaces |
| C03 | Exactly one accountable human owner per Workspace; transfer to another member requires recipient acceptance before owner departure | Resources and grants remain attached to the Workspace; owner status grants no provider credentials or automatic restricted-Mail reading |
| C04 | Invitations and grants select resources/actions; restricted individual and deliberately shared mailboxes both work | Membership alone exposes no blanket content; internal groups do not bypass resource policy |
| C05 | Account-level Connections screen lists connections the human may manage; each mailbox/calendar has a selected home Workspace | No master owning Workspace, global bypass, or implied credential-storage decision |
| C06 | Externally connected agent identity has independent revocable grants per Workspace; members may delegate subsets of current rights when policy permits | No persistent Workspace-hosted agent/runtime; no inherited human/provider credentials or cross-Workspace grant |
| C07 | OpenJob accounts initially have no hosted mailbox; existing providers connect | Hosted inboxes remain a possible future product, not current scope |
| C08 | Home may show labeled authorized tasks/events/unread counts across Workspaces; opening work enters its Workspace | Actions remain Workspace-scoped; no blanket unified Mail/content/search or agent authority |
| C09 | Build the first usable Mail/Calendar/Tasks/agent-permission loop for Shane’s daily use; progressively onboard real accounts/connectors/mailboxes with his participation; include an early usable iOS TestFlight path | Do not wait for broad multi-user/provider/platform readiness; advanced Calendar and company SSO stage later. No present feature-work, provider-grant, credential, real-send or TestFlight distribution authority |
| C10 | Online-first shared work; retain existing personal offline Task/Calendar support; initially fetch Mail bodies on demand and defer full offline email | Exact cache caps, retention, storage/crypto and later offline mechanics remain Proposed; online-first does not select hosting |

## Actual confirmation record

Source discussion: Codex task `01a145d7-6310-7083-9b8a-25f8e1f8b0dc`,
**Discuss OpenJob architecture**. Integration owner read the actual user turns,
not only the saved alignment summary, on 16 October 2026.

- Turn `01a145e9-7722-700a-a7d3-2fde88a7d2a1`: Q1 “yes”; Q2 workspaces
  “owned by 1 user”; Q3 invitations give access “only to things you select”;
  Q4 “my connected agent ... not like a persistent agent”; Q5 accounts may supply
  mailboxes in future “but not intially.”
- Turn `01a145fe-56bf-7506-8615-2d56a1ca536b`: Q6 chose company = Workspace,
  “different groups inside a workspace/company ... groups/permission sets”; Q7
  “agreed” to transfer with recipient acceptance before departure.
- Turn `01a14601-18a7-7512-b3ec-d0b2fd534317`: Q9 “agreed” to restricted
  individual Mail. Q8 initially suggested a master connection location; the next
  clarification explicitly offered account-level Connections versus master Workspace.
- Turn `01a14625-9b73-7542-a312-598604b01fc8`: Q10 “ok that's fine” to the
  recommended account-level screen; later agreement to the summarized core resolves
  the earlier master-Workspace suggestion in favor of C05.
- Turn `01a14635-0f6c-7454-a773-18f75e946163`: Q11 “yes obviously” to member
  delegation bounded by current access/policy; Q12 “sure that's fine” to labeled
  cross-Workspace Home with actions entering a Workspace.
- Turn `01a14638-338b-71cf-84fe-859150d929bb`: “agreed, and communicate with sean
  my codex dot, and make alignment for the openjob architecture and what not”
  confirmed the summarized core and requested this reconciliation.

Supporting handoff: `task-3/OPENJOB_ARCHITECTURE_ALIGNMENT.md` in the shared local
session. The discussion owner inspected the original tldraw records and preview;
this reconciliation uses the explicit conversation decisions as authority and does
not infer extra acceptance from the diagram. Sean subsequently confirmed receipt
and authorized this documentation-only update; no further relay retry is needed.

## Pilot clarification — 16 October, 4:36 p.m. Central

Sean relayed the following exact owner message from parent thread
`01a0f838-a174-70eb-a090-8bdce60620f1` (source time 21:36 UTC):

> 1. what are hosting options
> 2. yea that sounds fine, instead of trying to build the system for everyone at first. Just approach the developoment cycle as building for me so as you get to connector stages and setting up accounts etc have me setup an account and progressively attach connectors and mailboxes so we can test and see how things work with real life and it starts being useful and physical for me. this includes getting a test flight ios app out that i can use and interact with proabbly
> 3. agreed

Numbered context: (1) hosting options remained under discussion; no hosting choice
was accepted. (2) the recommendation was a first useful real Mail/Calendar/Tasks/
agent-permissions release, staging advanced Calendar/company SSO later; Shane
refined it into an owner-first progressive pilot with early iOS TestFlight.
(3) the agreed recommendation was online-first shared work, retaining personal
offline Task/Calendar and deferring full offline Mail with on-demand bodies initially.
This records C09–C10 only, not adoption of the whole blueprint or permission to
begin features, configure accounts/credentials, send externally, distribute a
TestFlight build or publish production releases. Specific approvals still apply.

## What remains proposed

Detailed role presets/default resources, identity eligibility protocol, exact API
schemas, hosting, repositories, encrypted credential storage, jobs, retention,
later offline/platform mechanics and release approach remain at their prior
authority. C09–C10 settle pilot priority and online/offline staging only; hosting
is expressly undecided.
See [DECISIONS](build-spec/DECISIONS.md). Stable OJ and R IDs retain their intent
where applicable, with wording revised to this Workspace boundary. Design status,
implementation proof, merge and release are separate facts.

## Cross-document traceability

Stable OJ and R IDs describe revised design intent, not completed implementation.

| Confirmed decision | Requirement anchors | Slice anchors | Detailed contract |
|---|---|---|---|
| C01 | OJ-I1, OJ-I3 | R10, R11 | DOMAIN identity/membership; EXPERIENCE picker |
| C02 | OJ-I2, OJ-I3, OJ-I5 | R10, R11, R12 | DOMAIN Workspace/internal groups; CONTRACTS Workspace administration |
| C03 | OJ-I2, OJ-I4 | R11, R12 | DOMAIN OwnershipTransfer; EXPERIENCE departure |
| C04 | OJ-I2, OJ-I3, OJ-I5, OJ-A2 | R11, R12, R22 | DOMAIN resource/action grants; PRODUCT restricted Mail |
| C05 | OJ-C1, OJ-C2, OJ-I3 | R12, R20, R31 | EXPERIENCE central Connections; CONTRACTS management/bindings |
| C06 | OJ-A1, OJ-A2, OJ-A3, OJ-A4 | R22, R30, R43 | DOMAIN external principal/delegation; EXPERIENCE grants |
| C07 | OJ-C1, OJ-C2, OJ-X1 | R20, R31, R50 | PRODUCT initial non-goals; EXPERIENCE first run |
| C08 | OJ-I3, OJ-X1 | R20 | EXPERIENCE Home; DOMAIN authorized projections |
| C09 | OJ-C1, OJ-C2, OJ-M1, OJ-T1, OJ-K1, OJ-A1, OJ-X1, OJ-X3, OJ-X7 | R11, R12, R20, R22, R31, R33, R40, R41, R43, R53 | Owner-first pilot path; EXPERIENCE onboarding; early R53 milestone |
| C10 | OJ-C3, OJ-M1, OJ-X2, OJ-X5 | R21, R32, R52, R53 | RUNTIME confirmed staging versus proposed mechanics |

Blueprint/Companies/ADR 0020 describe the same boundary. RUNTIME/ADRs 0019/0021
retain their Proposed technical status. COMPLETENESS/HANDOFF/SOURCE preserve this
authority split; the dated executive memo is marked superseded where it differs.
