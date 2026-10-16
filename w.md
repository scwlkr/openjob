# WLK-310 platform design — OWNER REVIEW, NO FEATURE IMPLEMENTATION

Owner corrected scope twice Oct16: stop minor workflow/edge slices; then pause
all new feature implementation until a platform-level system blueprint and ADRs
are reviewable. No feature code was changed for310. Isolated worktree
/Users/shanewalker/Documents/Codex/2026-10-16/task/openjob-product-entry,
branch codex/wlk-310-platform-blueprint from main9ba3929.

Review entry: docs/PLATFORM_ARCHITECTURE.md; Companies and identity detail in
docs/COMPANIES_AND_IDENTITY.md. One User/personal workspace, independent company
memberships/roles, company-owned workspaces and explicit resource grants. No
employment-based personal ownership or automatic cross-company visibility.
Creation/invitations/switching/connections/agents/departure/collaboration all
proposed together in revised ADR0020. Managed company login is context-only;
personal/multi-company identity requires independent personal authentication and
recovery. Existing global sign-in links need compatibility assessment first. Charter/users/scope, capability map,
system/container diagrams, workspace/principal boundaries, domains, provider data
authority, sharedAPI/CLI/UI, integrationjobs/sync, deployment/extensibility,
prototypegaps/phasedoutcomes. ADRs0019–0021 all PROPOSED, not accepted. No stack
migration, credentials, infrastructure, settings or implementation authorized.
Independent design review clean after clarifying private connection grants,
agent effective authority, lifecycle ownership and Task/Calendar planning owner.
Local links/fences and diff checks pass; no application code changed, so no app
build or runtime suite repeated. DraftPR only; do not auto-merge or start feature work ahead of owner designreview.
Linear310 is currentpriority; outcomephases inblueprint are not a secondbacklog.

Phase2 acceptance now explicitly demonstrates three people/two companies with
independent roles and personal work, invitation acceptance, scoped context views
and departure from one company preserving the other/personal contexts. Hosting,
retention, credential refresh and runner ownership remain proposed/open decisions.

## Separate publication blocker

Owner approved exact dev0.3.8-dev.1792161876.9ba3929fbf0c from source
9ba3929fbf0ccc3e24e2577410a355fa3798736e. One local publication attempt was
rejected by npm EOTP. Public readback: version404, devstillinitial37c322b,
latest0.3.7 unchanged. No automaticretry; owner Terminal authentication handoff
in Linear307. Preserve original checkout clean atapprovedsource, archive/plan
/tmp/openjob-309-pending-9ba3929. This designworktree doesnotdirty thatcheckout.
No newpublicationorlatestchangeconfirmed. No authconfiguration/securitychanges.

## Existing product and saved work

PR84localCI/manualActions, PR85Mail editor, PR86Mail↔Task navigation merged.
Their checks and actualnpm app/API smoke are recorded inLinear307–309. Current
prototypeproviders remaininvented; real sendsdisabled; liveconnectionsunconfigured.
Saved installed demos5196/5197 retained. Mac disconnect may stopprocesses: restore
fromfresh-pathcopy ifcrashlocked, retainoriginalstate+lock. 5196 uses
/tmp/openjob-308-demo/workspace-recovered-309.json, 5197 /tmp/openjob-309-demo/workspace.json.
Initialapprovedarchivesandoriginal0.3.8candidatein/tmp retained. Do notreplace
an approved artifact with latercode under thesameversion.

WLK302 remainsunrecovered in stoppedcloudthread01a14099-4e09-73d1-bed5-0e41e70560de;
no remote branch/PR/checkpoint. Do notduplicateitsTLS/login work. Unrelated
PatriBible/Desktopwork untouched. Detailedhistory/evidence remainsLinear/Git.
