# Installed app and portable Linux pilot

This prepares C11’s future Linux service locally. No server has been bought,
provisioned or deployed. The installed package carries real UI/API assets; live
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
claiming. Existing Group administration is unavailable in this pilot. Actual
Firebase sign-in/account setup remains unverified without approved inputs.
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

After Shane purchases and authorizes a target, transfer this reviewed bundle through
an approved route, unpack it there, and build the image on that target architecture.
The bundle’s JavaScript/web assets are portable; the local Mac’s Linux image does
not prove another CPU architecture. Check target Docker availability before setup.
First run loopback-only and inspect health; real Firebase inputs/ingress/provider
onboarding remain explicit later steps. This document executes none of them.

Compose ports, profiles, health checks and named volumes follow the
[official service reference](https://docs.docker.com/reference/compose-file/services/).
Preserve the existing npm latest/dev notice-only update rules; container rebuilds,
registry publication and actual deployments are separate actions.
