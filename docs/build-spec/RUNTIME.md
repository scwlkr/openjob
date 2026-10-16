# Runtime, deployment and data policy

**Runtime/storage/offline choices remain Proposed.** The [confirmed core](../ARCHITECTURE_ALIGNMENT.md) selects Workspace/account/agent boundaries, not hosting or credential storage. This selects a maintainable first live profile and concrete full-client target. It does not provision infrastructure, upload credentials, authorize real accounts or publish anything.

## Recommendation: hosted authority, installable clients

Use the existing Cloudflare application/API plus Firebase identity and Firestore repositories as the first live authoritative service. Keep React web, Expo mobile and the existing npm/Node CLI. Add a production-mode npm-installed app client to that service; retain the current synthetic local app as an explicitly separate demo mode. Local Mac CI/package/publish is a delivery preference, independent of where the authoritative app runs.

This choice serves the product beyond preserving code: a shared Workspace needs access changes and ownership to apply consistently while its members are on different devices; agents need an endpoint that remains available when one member's laptop sleeps; provider callbacks, token refresh and sync need one accountable execution owner; and scheduling conflicts need one authoritative version. Hosting centralizes those boundaries. It does not require every feature to be online or justify indefinite storage of Mail content. An offline client can keep bounded authorized projections and pending edits without becoming a second Workspace authority.

Tradeoff: the hosted operator processes provider data and holds encrypted credentials, creating real security/privacy and service-operating obligations. Users seeking an entirely local trust boundary will not get that from this profile. Those tradeoffs are why hosting/data handling are owner review choices. No availability, cost, scale, region or security certification is assumed.

## Concrete composition

| Component | Default | Boundaries |
|---|---|---|
| Interactive API | Current TypeScript/Cloudflare application, domain services and repositories | Bounded request work; one policy implementation for web/native/npm/CLI/agents |
| Identity | Existing Firebase-backed user identity, plus explicit SignInBinding and context eligibility | Mail consent separate; no Company SSO in first core; migration never merges by email |
| Owned state | Firestore per-entity collections for Users/memberships/workspaces/internal permission groups/tasks/blocks/grants/operations | Authoritative local transactions for Task/block + outbox; no full Inbox JSON aggregate |
| Provider projections | Firestore metadata documents keyed by connection-qualified refs with expiry and indexes | Cache, not provider authority; prune and invalidate independently of user Tasks |
| Credential broker | Existing token-vault interface backed by a separate server-only encrypted Firestore credential repository; versioned encryption key in the deployment secret store | No plaintext token in ordinary app documents; key and encrypted record access administered separately; a managed vault can replace only this adapter if justified |
| Connections management | Account-level screen/API projection of only manageable provider bindings; resource homes/grants remain Workspace-scoped | No master Workspace or global credential ownership; exact binding/cleanup schema remains Proposed |
| Integration execution | Durable Firestore jobs/leases and bounded scheduled handler sharing domain/adapter code | Same codebase; no external call in a database transaction; resume safely after restart |
| Webhooks | Validated provider subscription callbacks enqueue sync hints | Does not trust payload ownership or directly mutate canonical provider truth |
| Web/native clients | Shared OpenAPI semantics, platform-specific layout/storage | Never upstream credentials or a second authorization engine |
| npm app | Installed assets/loopback client bridge to selected hosted API, authenticated with existing profile conventions | Real app mode distinct from fixture mode; no fake localhost owner headers in live mode |

The integration runner executes authorized provider operations; it does not host an agent runtime. Central Connections does not adopt this proposed credential repository. The first credential implementation must record its security design before live binding: standard authenticated envelope encryption, per-record data key, distinct deployment wrapping-key/credential storage, unique nonces where required, authenticated context/provider/binding metadata, key identifier/rotation path, redacted diagnostics and broker-only decrypt access. A separate provider credential reference is not itself proof of encryption. Do not invent a cryptographic primitive, store values in project files or expose a vault API to agents. Approve the deployment key setup and prove rotation/recovery in isolation. If an existing approved managed vault clearly reduces risk/operations, record that narrow adapter substitution and its actual region/access policy; it does not require a backend rewrite.

### Durable runner

Persist jobs with due time, lease, attempts, connection/binding revision and Operation identity. A scheduled handler claims a bounded batch transactionally, verifies current grants/connection state, performs work outside the transaction, then commits receipts/cursors/projection updates. Retry known non-effects with capped exponential backoff and provider Retry-After; expose blocked/error state when a permanent failure or repeated transient failure needs attention. A retry budget limits one worker run; unfinished recoverable jobs remain durable for later runs rather than being silently dropped.

Cloudflare documents scheduled handlers for periodic API work, and outbound TCP/TLS support with restrictions; this supports evaluating bounded IMAP/SMTP sessions, not assuming any particular provider/server works. Port 25 is restricted; use a provider's supported authenticated submission endpoint only after validating it. Long-lived IMAP IDLE is not the initial design. Prove TLS/MIME/login and bounded polling against an authorized standards provider before claiming support. If needed, extract only the integration runner, preserving the API and repositories. [Cloudflare schedules](https://developers.cloudflare.com/workers/configuration/cron-triggers/) · [TCP/TLS sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

Firestore transactions may retry and must keep reads before writes; provider effects never run inside a retried transaction callback. Lease acquisition and Task/block/outbox changes can be transactional, while external confirmation is reconciled afterward. [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

## Proposed pilot data policy

These are concrete proposed defaults, not legal compliance claims or currently configured retention. Accept them with the hosting decision; implement and test cleanup before importing real data.

| Data | Proposed storage/retention | Disconnect/deletion handling |
|---|---|---|
| Provider Mail bodies/attachments | Fetch on demand; memory/response only in first live pilot; no persistent server/body-search cache | No retained body to expose; clear client transient view and stop future retrieval |
| Provider Mail metadata | Necessary account/ref, from/to, subject, date, flags/folders; at most 30 days and 1,000 most-recent messages per connection, whichever is smaller | Immediately inaccessible on revoke; purge asynchronously with observable receipt. Older Mail remains retrievable by paged provider query |
| Provider Calendar projections | Requested display/planning window only, default previous 30/next 90 days; refreshable cache | Remove readable projection on disconnect; retain only source stub required by an owned task/receipt |
| OpenJob Tasks/blocks | Until owner deletes under application policy; not automatically erased when source disconnects | Preserve correct Workspace homes/ownership; deleted records follow approved recovery/cleanup process |
| User-authored local drafts | Until sent, discarded or explicitly removed; do not auto-delete unfinished text under metadata expiry | Access follows originating context. Confirmed send can mark archived; authored draft deletion remains deliberate |
| Pending send attachments/payload | Only in a protected outbound area needed by the draft/operation; bounded size and authorization | Clear attachment bytes after confirmed terminal operation/discard; unknown outcome retains minimum repair data until resolved |
| Successful operation/activity receipts | 90 days, no bodies or tokens; provider IDs and redacted outcome | Keep ownership-appropriate minimal history; redact source details after access loss; expiry does not authorize duplicate replay |
| Idempotency fences and unknown operations | Minimal request-key hash, operation/result status retained while replay remains possible; unresolved unknown operations do not expire into retryability | Operation remains blocked/reviewable until resolution. Old request key can be rejected as expired, never treated as a fresh send |
| Raw diagnostic logs | Redacted identifiers/error class, default 7 days in the chosen development/pilot environment | Verify actual platform log settings and deletion; do not assert control over undisclosed provider logs |
| Provider credentials | Encrypted broker storage while active, no logs/cache outside broker | Disable binding first, revoke/delete through durable cleanup and show external completion separately |

Reply quoting is omitted by default. A person may explicitly insert reviewed source text into a protected draft; that copy follows the draft policy and remains subject to source/context authorization. Automatic quoting must not turn on-demand provider bodies into an undisclosed persistent cache. Operation-specific frozen outbound snapshots follow the pending payload policy.

These caps are initial engineering/privacy defaults, not product archive limits or capacity/SLO promises. Search/read beyond cache delegates to the provider. Adjust cache sizes from observed performance without broadening the accepted body-retention policy. Cache identifiers/headers are still private data and need the same access boundary.

Before public production rollout, extend the existing privacy inventory with actual processors/data locations, app-store disclosures, account export/deletion behavior, operator access, backups/restore and retention. Choose an approved hosting/data region from available resources; do not promise residency from a global edge URL. Backup policy must show what can be restored, who can restore it, and how revoked/deleted state cannot be resurrected into active access. Run an isolated restore rehearsal. The pilot is not evidence of regulatory readiness.

## Full-product offline and installed clients

Required later slice OJ-X5 adds explicit per-mailbox offline opt-in. Cache only the chosen bounded window, protected by platform secure storage and existing native encryption/system-authentication gates. Attachments are opt-in downloads, not automatic mailbox mirrors. Keep cache encryption keys out of logs/config files. Lock/logout/disconnect removes keys/readability promptly; physical cleanup reports remaining work honestly. Previously read/exported bytes cannot be recalled. Workspace policy can deny offline content or shorten its window; employee preferences cannot widen it.

shared-Workspace offline Task/Calendar edits retain base version, exact workspace/resource and principal, stable operation ID and authored changes. Reconnect reauthenticates and rechecks current membership/grants; rejected changes remain a private recovery draft where policy allows, never silently write to another context. External sends, invitations and recurring-series effects remain online reviewed operations. Web may support less offline content than native if secure storage cannot meet the policy; show that capability boundary explicitly and retain complete online functionality.

The full npm app serves the real UI using an authenticated local client bridge, not the current invented-user server. If a bridge holds an app refresh credential, store it using the existing supported OS credential mechanism; it never holds upstream provider credentials. Bind loopback only, validate Host/Origin and CSRF state, use a per-session anti-forgery channel, restrict upstream destination, and prevent an arbitrary website from driving local actions. No publicly reachable local API or implicit trust in localhost. The CLI remains the remote API client; agents do not inherit a human app session.

Installation is managed through npm. `@latest` follows reviewed releases; `@dev` follows authorized builds from main with unique source/version identity. On startup/check, automatically detect available updates and notify; installation is separate and never silently replaces the running app. Show current version/channel/source and available version, preserve local state, offer exact npm update command, and test interruption/rollback. The user's update request does not imply automatic security/credential changes or production deploy permission.

macOS/Windows/Linux first desktop distribution can use the npm-installed browser app where its local bridge/keyring/runtime works; label it an installed browser application rather than a native binary. An Electron shell is optional only when measured OS integration need justifies it. iOS/Android use existing Expo clients with real network/offline acceptance. Every named platform gets explicit supported/limited/unverified entries and actual runtime evidence, not an inference from shared TypeScript compiling.

## Alternatives and trigger conditions

| Alternative | Benefit | Cost / when to choose |
|---|---|---|
| Secure local-authoritative service first | Provider data/control stays with operator's computer; less hosted trust | Requires independently designed auth, secure credentials, reliable background service, external agent endpoint access and multi-device/Workspace coordination. Choose only if local-only trust is owner priority |
| Self-hosted service deployment | Workspace operator controls hosting boundary | Needs supported provisioning/update/backup/security operations and explicit trust boundary per installation; not implied by npm client |
| Narrow always-on integration worker | Better fit for long-lived protocol/network/runtime constraints | Add only after bounded worker proof fails or measured work requires it; preserve shared domain policy/API |
| PostgreSQL/Rust migration | May simplify proven relational/query/background needs | Requires data/auth compatibility, cutover and rollback. Do not migrate solely for WStack language preference |
| Per-domain microservices/event bus | Independent scaling/deployments | No present workload evidence justifies coordination/operating cost; defer |

## Delivery gates

Run local Mac checks using current project commands, preserving artifacts with source/hash/version and evidence. Manual-only Actions preference does not bypass branch protections. Separate: code merge; npm dev publication; npm latest release; hosted deploy; mobile store/OTA release. Each needs its actual scope/review/credentials and post-publication readback. A source merge is not proof that any user has a new app. Never republish changed bytes under an already approved version.
