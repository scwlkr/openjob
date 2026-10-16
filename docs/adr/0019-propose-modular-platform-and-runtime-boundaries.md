# 0019 — Build one modular platform with explicit runtime boundaries

- Status: **Proposed — owner acceptance pending**
- Date: 2026-10-16
- Scope: target platform structure and deployment evolution
- Context: [platform blueprint](../PLATFORM_ARCHITECTURE.md)
- Supersedes: none; no stack migration or infrastructure is authorized

The [owner-confirmed core](../ARCHITECTURE_ALIGNMENT.md) governs Workspace and
connected-agent boundaries; this runtime/modularity ADR otherwise remains Proposed.

C09 prioritizes Shane’s daily-use pilot and early usable iOS; C10 confirms initial
online/offline staging. Hosting remains undecided after his request for options;
this ADR’s hosted-first recommendation is not adopted by those decisions.

## Context

OpenJob has a working TypeScript/React/Expo product with hosted Cloudflare API
composition, Firebase identity, Firestore repositories, an existing CLI and a
packaged Node prototype. The mission spans Mail, Calendar, Tasks and agents.
Those capabilities require clear ownership and orchestration, but not four
independent services. The current local package serves invented identities and
provider data; it is not already an alternative production backend.

We need a platform that can grow without making every feature a cross-service
transaction or replacing the working application before connected work is useful.
WStack favors simple boundaries and preserving components that earn their place.

## Proposed decision

Use one modular application with bounded contexts for Identity/Workspace,
Connections, Mail, Tasks, Calendar and Delegation/Activity. Application operations
coordinate contexts; repositories hide persistence choices. Public clients use
one versioned API/OpenAPI contract, preserving the existing CLI and the principle
in [ADR 0001](0001-web-and-cli-are-equal-api-clients.md). UI components do not become
the only implementation of a workflow or authorize by hiding controls.

Treat the API, integration runner and clients as logical containers. Initially
share the server codebase and deploy integration execution through supported
invocation modes. Extract a runner process only if provider connection lifetimes,
background work or isolation require it. Extract a service only for demonstrated
independent runtime, lifecycle or scaling needs. Do not deploy a message bus,
service mesh, generalized plugin host or distributed transaction coordinator now.

Preserve the current stack. Define separate composition profiles for hosted
service, local synthetic demo and a possible secure local/self-hosted service.
Each profile binds identity, repositories, secrets and job execution explicitly.
A future local service must still expose the same domain/API contract; it does
not bypass authorization because its client is on loopback. This proposed local
profile extends the historical hosted-only assumption and needs explicit approval
before being called supported production behavior.

Use local Mac CI/package/publish with manual-only Actions as the current delivery
preference. A source merge is distinct from publishing npm, deploying the hosted
app or releasing native binaries. Existing privacy/native release gates remain.

## Proposed build defaults

[RUNTIME](../build-spec/RUNTIME.md) elaborates this ADR: hosted authority on the
retained stack; per-entity Firestore repositories; server-only encrypted provider
credential records with separately controlled deployment wrapping key; durable
Firestore jobs/leases and bounded scheduled execution in the same codebase.
Crypto/key-rotation design and actual runtime limits still need slice-level proof.
These defaults do not claim configured infrastructure or approved keys.

The required full npm app is an authenticated client of that hosted service, with
real capabilities and supported offline scope. Its loopback bridge must enforce
Host/Origin/CSRF and protected app-credential storage. It is distinct from both
the synthetic demo and an optional local-authoritative server. Verified npm
macOS/Windows/Linux support may use an installed browser app; native shell claims
need their own evidence. Automatic channel update checks notify; installation
remains explicit. See OJ-X6–X7 and R54. All additions remain **Proposed**.

## Alternatives and tradeoffs

- **Microservices per module:** permits independent deployments but adds network
  policy, distributed consistency and operation overhead before workload evidence.
  Keep modular boundaries that allow selective extraction later.
- **One unrestricted application module:** cheapest initial wiring but makes
  provider credentials, Tasks and UI policy hard to separate. Reject the lack of
  boundaries, not the single deployment.
- **Immediate Rust/PostgreSQL rewrite:** aligns with WStack defaults for suitable
  new systems, but there is no measured need to discard the working stack. A
  future runner or repository migration must show a concrete runtime/query benefit.
- **Local-only immediately:** attractive ownership model, but background sync,
  secure credentials, remote agents and optional multi-device sync are unresolved.
  Keep it a deployment choice to review, not a capability implied by npm install.

## Consequences and review gate

We retain a small deployable system and gain enforceable code ownership. Shared
processes still require disciplined repository and authorization interfaces.
The modular-domain/API decision can be accepted independently of a deployment
profile. Recommend the existing hosted service for the first live-provider
integration because identity and remote clients already exist. Owner review must
accept that profile, or select a secure local service and decide its identity,
secret storage, background lifecycle and remote-agent access, before integration
implementation is ready. Local CI preference does not itself select app hosting.
Before any extraction, record the observed constraint and its operational owner.
No new infrastructure or credentials follow from accepting the domain structure.
