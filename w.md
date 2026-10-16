# OpenJob local integration handoff — WLK-309

Checkout: /Users/shanewalker/Documents/Codex/2026-10-16/task/openjob-wlk-303.
Single integration owner; unrelated PatriBible/Desktop checkouts untouched.
Branch codex/wlk-309-mail-task-links from reviewed main
 dd48c454e65a4ab1fb942ede6238dded0e67d3a9 (PR85). Linear is the queue:
https://linear.app/wlkr-labs/project/openjob-fa4830c93118

WLK309: selected Mail message lists exact owner/account/message-linked private
Tasks, including completed state. Open task reuses Task handle, clears hiding
filters, focuses exact Task, preserves unfinished Task/Mail editor text. Multiple
Tasks remain supported via explicit Create another action. Shared authenticated
and fixture web shells; no API/grant/provider scope change. Narrow owner/source
link test + browser desktop1280/phone390 roundtrip, compile/brand/secret checks.
Independent source review clean; browser test ambiguity fixed by asserting link
count increment (same default title across viewports). Final browser/PR evidence
in Linear. Native/device/fullsuite not claimed. No provider/TLS changes.

## Local package and publication

PR84 merged14b9699: OIDC cancelled, no grants/environments/activation/credential/
security changes. Actions artifact workflow manual-dispatch only, no automatic
main/release runs or publish. Local npm:prepare checks/compiles/builds/packs/
clean-prefix installs/runs/seals plan. npm:publish uses existing npm login only
AFTER owner approval of exact source/version/channel/integrity. Possible owner
interactive npm security prompt; never ask for/store/print OTPs or tokens.
See docs/NPM_LOCAL_RELEASE.md. No new publication authorized or attempted.

Pending dd48c45 package 0.3.8-dev.1792159622.dd48c454e65a preserved in
/tmp/openjob-307-pending-dd48c45 (tarball + publication.json). Full local proof
PASS: policy/distribution15, compile, secret624, actual assets/API build/pack/
fresh-prefix install/create-schedule-complete/isolation/HostOrigin/shutdown.
Adds persistence, Calendar find-time, safe Mail editing since published dev37c322b.
Main advancement invalidates this publication plan; prepare new main only after
integration and obtain applicable exact-artifact approval. Do not publish it as
if it contains WLK309. Original reviewed 0.3.8 candidate remains unchanged in
/tmp/openjob-307-candidate. Initial approved published archives preserved.

## Saved demo and recovery

Installed saved demo http://127.0.0.1:5196/workspace restored after Mac disconnect.
Uses /tmp/openjob-308-demo-prefix, saved state
/tmp/openjob-308-demo/workspace-recovered-309.json. Original workspace.json and
crash lock retained; byte-identical recovery-copy SHA256
2a87672f4c57756baa0f2e5790d909b6f75bce3d0492de923dd213a07d140578.
Existing saved demos/artifacts5193/5194/5195 preserved; processes may need restore
after transport loss. All demo providers/identities invented; actual sending off.

## Unrecovered cloud work

WLK302 TLS/login work remains in stopped cloud thread
01a14099-4e09-73d1-bed5-0e41e70560de. History is readable, but no remote branch,
PR or transferable checkpoint. No recovery claimed; do not duplicate/overwrite.
Last live provider state remains unconfigured. Prior handoff receipts are in
Linear and Git history; this compact note supersedes cancelled OIDC instructions.
