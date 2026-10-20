# Installed app and portable Linux pilot

This prepares C11’s portable Linux service. The target has been purchased and
Docker installed under the separate infrastructure owner; this source work deploys
no app or public ingress. The installed package carries real UI/API assets; live
provider login, Mail sending, Workspace model and full legacy-service parity are
not implemented by this slice. Existing authenticated Personal behavior is reused.

## Use the installed app

Install the reviewed local app tarball, then:

```sh
openjob app --state-file /path/to/local-demo.json
openjob server --port 5192
```

`app` is the clearly labeled Alex/Sam invented-provider prototype on127.0.0.1:5191.
`server` serves the real Firebase authentication entry at127.0.0.1:5192/workspace.
The `/account` page reuses existing sign-in, explicit User creation and username
claiming. Existing Group administration is unavailable in this pilot. Actual local Firebase sign-in and saved Tasks/Calendar were verified separately
with the approved operator and alternate account; that is not hosted-service proof.
Without configuration it shows setup, health/API503 and no demo fallback. `/__test`
never exists in service mode. `/healthz` only checks required input presence; it does
not prove credentials, live Firebase, providers or native behavior. `/runtime-config`
contains public Firebase browser fields only, never the server credential.

The service expects FIREBASE_PROJECT_ID, FIREBASE_API_KEY, FIREBASE_APP_ID,
FIREBASE_AUTH_DOMAIN, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY (or an explicit
FIREBASE_PRIVATE_KEY_FILE for direct Node use). Use only separately authorized
existing development configuration; new credentials/access need approval. The blank
`deployment/service.env.example` contains no access. Never commit private values or
copy business infrastructure secrets. Firebase authorized-domain/redirect setup may
need separate approval. No existing authentication settings are changed here.

## Run locally with Docker Compose

From source, inspect scripts and install locked dependencies without native release
setup: `npm ci --ignore-scripts --no-audit --no-fund`. Then:

```sh
npm run app:build
# Real packaged assets, then one Linux image:
docker compose --profile demo build demo
docker compose --profile demo up -d demo
# http://127.0.0.1:5191/workspace
# Separate setup-only real-service profile:
docker compose --profile service up -d service
```

Both host ports bind loopback. Demo uses a named state volume and retains authored
work across restart; `docker compose stop` preserves it. Do not remove volumes to
update. Do not publicly expose synthetic identities. The demo’s internal container
listen option requires its explicit local-only environment flag; normal installed
app binding stays loopback and Host/Origin checks remain.

Service is unhealthy/503 until inputs are provided, intentionally. After separately
approved setup, use an ignored local environment file with Compose `--env-file`.
A future non-loopback browser origin requires explicit HTTPS OPENJOB_PUBLIC_ORIGIN;
this neither configures TLS/ingress nor authorizes firewall/DNS changes. The portable
Node slice covers identity and Personal workspace/agent APIs; other legacy routes,
background deletion scheduling and live connector execution are not silently enabled.

## Prepare the later deploy path

```sh
npm run server:bundle
# dist/openjob-server-bundle.tgz includes Compose, Dockerfile, built npm assets,
# a quick-start README and file-hash/source receipt. No source env/credentials.
```

After approval of the exact deployment target/origin and secret-delivery handoff,
transfer this reviewed bundle through
an approved route, unpack it there, and build the image on that target architecture.
The bundle’s JavaScript/web assets are portable; the local Mac’s Linux image does
not prove another CPU architecture. Check target Docker availability before setup.
First run loopback-only and inspect health; real Firebase inputs/ingress/provider
onboarding remain explicit later steps. This document executes none of them.

Compose ports, profiles, health checks and named volumes follow the
[official service reference](https://docs.docker.com/reference/compose-file/services/).
Preserve the existing npm latest/dev notice-only update rules; container rebuilds,
registry publication and actual deployments are separate actions.


## Optional Google configuration preparation

Default service behavior is unchanged: Google is disabled, no Google secret files
are read, and Connections returns503. The opt-in mode requires all nonsecret
selection inputs and two explicit absolute secret-file paths. Incomplete/malformed
configured mode stops startup with a sanitized error rather than falling back.
`/runtime-config` still includes only public Firebase/Apple fields. Health says
`configured_read_only` only for configuration presence, not successful grants or
provider/database verification. Sending remains disabled.

Inputs, in addition to existing Firebase settings:

- `OPENJOB_GOOGLE_CONNECTIONS_MODE=configured` for a later authorized activation.
- Exact approved HTTPS `OPENJOB_PUBLIC_ORIGIN`; callback is exactly that origin
  plus `/connections/google/callback`, never a free-form callback override.
- Existing Web `OPENJOB_GOOGLE_CLIENT_ID` and chosen `OPENJOB_GOOGLE_KEY_ID`.
- Explicit existing `OPENJOB_GOOGLE_OWNER_USER_ID`, its Google
  `OPENJOB_GOOGLE_OWNER_FIREBASE_UID`, and `OPENJOB_GOOGLE_MAILBOX`. No lookup by
  email/domain, account creation or identity linking occurs. Other Users/linked
  sign-ins/mailboxes are denied. A configured flag does not authorize them.
- `OPENJOB_GOOGLE_CLIENT_SECRET_FILE` (bounded client secret) and
  `OPENJOB_GOOGLE_KEY_FILE` (canonical base64 of32 existing approved AES key bytes).
  Files are explicitly selected, bounded regular files; no default credential
  discovery, key generation or rotation. The imported key is nonextractable.

The runtime uses existing owned/mapped Personal home metadata. It does not create
or map a Workspace, populate Workspace-pilot admission, or change Mail home access.
The chosen account must have an explicitly prepared owned Mail home before consent;
missing homes remain unavailable. Key rotation across existing envelopes still
uses explicit injected previous keys and the reviewed maintenance API, not this
single-current-key file loader.

For local Compose configuration review, the optional overlay
`deployment/compose.google-local.yaml` mounts the two explicit source files as
read-only Compose secrets. `OPENJOB_GOOGLE_CLIENT_SECRET_SOURCE` and
`OPENJOB_GOOGLE_KEY_SOURCE` name approved files on the host, never their contents.
The base service remains host-loopback bound. Validate without starting anything:

```sh
docker compose --env-file /path/to/private-approved.env -f compose.yaml \
  -f deployment/compose.google-local.yaml --profile service config --quiet
```

Do not use real files or start containers until the setup is authorized. This slice
validated the configuration with temporary invented files and compiled the portable
service SSR bundle without executing it. No Docker image/build/service, listener,
TLS/ingress, DNS/firewall or live provider was activated by that validation.
The server bundle includes the overlay and blank input template.

`npm run test:google-local` now exercises this exact portable runtime opt-in using
injected synthetic database/auth/Google/Mail transports. No Google transport has a
default in the runtime API; the later explicitly configured Node composition is
what supplies real fetch. The internal deletion-cleanup capability is returned for
an authorized worker to inject; this portable server has no deletion worker or
cleanup HTTP endpoint. That operational hookup remains part of activation.
