# Durable reply simulations — P-WLK-6 / R30

This bounded R30 foundation runs only in the local invented Google fixture. Real
Mail remains read-only. Normal/portable runtimes have no operation dispatcher;
Google consent still requests only OpenID, email and Gmail read access.

Start an isolated saved fixture:

```sh
npm run dev:owned-workspaces -- --port 5214 --state-file /tmp/openjob-reply-fixture.json --google-fixture
```

Open `/workspaces`, enter retained Personal, create a source-linked Task from Mail,
open its source and prepare a reply. Review the account/recipients and save the
authored text. Refresh operation history, queue the saved reply simulation, then
run the queued operation. The UI names this a simulation; it never reports a real
send. Save unfinished authored edits before reloading. The selected fixture file
contains invented credentials and authored test work, without encryption; use no
real correspondence in it. Restart with the same file and `--google-fixture`.

The existing CLI shares the Workspace API. Use an authenticated selected human
profile and an explicit Workspace; no agent credential or human fallback is
accepted by these commands:

```sh
node cli/openjob.mjs connections reply <workspace-id> <task-id> --format json
node cli/openjob.mjs operation enqueue --workspace <workspace-id> --input <json-file>
node cli/openjob.mjs operation list --workspace <workspace-id> --task <task-id>
node cli/openjob.mjs operation show <operation-id> --workspace <workspace-id>
node cli/openjob.mjs operation run-fixture <operation-id> --workspace <workspace-id>
```

Enqueue JSON has exactly `action: "reply.simulate"`, `taskId`, a new UUID
`requestId`, the saved `draftRevision` and the fresh reply preparation's
`reviewToken`. Keep this exact input after a lost response. The same key/input
recovers the original operation even after later draft edits; changed input with
the same key conflicts. HTTP 202 accepts intent and does not confirm execution.
CLI run exits 0 for confirmed simulation, 4 for rejected, and 8 for an unresolved
or unknown result. List/show inspect without dispatching. API paths and response
types are in `openapi/openapi.yaml` and the generated existing CLI types.

Private frozen payload, redacted status and leased job occupy separate fixture
records. The payload fixes owner, Workspace, Task source, original account and
connection revision, recipient/thread plan, authored body and saved revision.
Later draft edits cannot alter it. Status/history excludes text, recipients,
provider subject, credential references/tokens and payload hashes. History is
owner/Workspace/Task scoped, at most 50 rows per cursor page; this pilot caps the
owner index at 100 operations. The UI reads at most its two possible pages.

An intent can enter execution for 15 minutes. A 30-second claim can be reclaimed
only before execution. The runner commits `executing` before invoking the injected
synthetic dispatcher, whose response is bounded to five seconds. A crash, timeout,
expired execution claim or ambiguous dispatch becomes `unknown` and cannot replay.
Known rejection records no simulated effect. An ambiguous execution commit never
enters the dispatcher; an ambiguous result commit is inspected before retrying
storage. Current User, home ownership, Task source, original connection revision
and fresh addressing must still authorize execution. An already dispatched result
can be recorded after revocation, while current authorization still fences reads.

The launcher saves every operation commit before acknowledging it to the runner,
including dispatch entry. Restarts keep the original invented connection identity.
The seven-day receipt-expired flag does not delete records or reopen execution.
After provider disconnect, use CLI/API history even if the source reader cannot
open. There is no automatic retry, background scheduler, production queue, live
send adapter, durable cleanup/retention policy or broader permission policy here.
Those remaining R30/R31 and provider/release gates stay open in Linear.
