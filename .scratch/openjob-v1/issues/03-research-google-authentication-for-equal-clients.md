---
id: openjob-v1-03
title: Research Google Authentication for Equal Web and CLI Clients
status: resolved
parent: openjob-v1-map
labels:
  - wayfinder:research
claimed: true
blocked_by: []
---

## Question

What is the simplest secure Google-only authentication and session design that supports the web client plus a one-time browser handoff for a fully capable CLI, using OpenJob's current Cloudflare and Firebase deployment?

## Answer

Use Firebase Authentication as the only identity issuer for both clients. The web signs in with Firebase's Google provider; the CLI uses Google's Desktop OAuth flow with PKCE and a random loopback callback, exchanges the Google ID token for Firebase credentials, then stores only the Firebase refresh token in the operating-system credential store.

Both clients send short-lived Firebase ID tokens to the same hosted API in the `Authorization` header. The Worker verifies one token format, identifies the User by Firebase `uid`, and checks current Group authorization on every request. OpenJob does not need its own session database, custom CLI handoff service, opaque API tokens, or a web-only cookie credential.

The full flow, security requirements, deployment fit, rejected alternatives, and build checks are in [Google Authentication for Equal Web and CLI Clients](../research/google-authentication-for-equal-clients.md).
