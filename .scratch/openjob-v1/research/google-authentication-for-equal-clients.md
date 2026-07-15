# Google Authentication for Equal Web and CLI Clients

## Recommendation

Use Firebase Authentication as OpenJob's only identity issuer. The web and CLI both call the same hosted API with a short-lived Firebase ID token in `Authorization: Bearer <token>`. The Cloudflare Worker verifies that token, resolves its Firebase `uid` to an OpenJob User, then performs Group authorization from current Firestore data.

This keeps the equal-client promise literal: one API, one token type, one authenticated subject, and one authorization path. It adds no OpenJob session database and no custom long-lived API tokens.

## Web flow

1. Configure Firebase Authentication with Google as the only enabled sign-in provider and authorize `openjob.dev`.
2. Use the Firebase Web SDK and `GoogleAuthProvider`; prefer popup on desktop and redirect where popup handling is unreliable.
3. Keep Firebase's default local browser persistence so the User remains signed in until explicit sign-out.
4. Before each API request, obtain the current Firebase ID token. The SDK refreshes it when needed.
5. Send the ID token in the `Authorization` header. Do not use it in a URL, cookie, or request body.
6. On sign-out, call Firebase sign-out and clear client state.

Firebase documents Google sign-in as the simplest web path, local persistence as the browser default, and sending the resulting ID token to a custom backend for verification:

- [Authenticate Using Google with JavaScript](https://firebase.google.com/docs/auth/web/google-signin)
- [Authentication State Persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence)
- [Verify ID Tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

## CLI flow

`openjob auth login` performs one browser handoff without involving an OpenJob browser session:

1. Bind an HTTP listener to `127.0.0.1` on a random available port.
2. Generate a high-entropy OAuth `state` plus a PKCE verifier and S256 challenge.
3. Open Google's authorization endpoint with the OpenJob Desktop OAuth client ID, the loopback redirect URI, and only `openid email profile` scopes.
4. Reject callbacks whose `state` is wrong, missing, or already consumed.
5. Exchange the authorization code and PKCE verifier at Google's token endpoint. A desktop client is public, so OpenJob ships a client ID but no client secret.
6. Exchange the returned Google ID token for Firebase credentials using `accounts:signInWithIdp`, `providerId=google.com`, `requestUri=http://localhost`, and `returnSecureToken=true`.
7. Immediately discard the Google code and Google tokens. Store only the Firebase refresh token in the operating system credential store; keep the Firebase ID token in memory.
8. On later CLI starts, exchange the Firebase refresh token at the Secure Token API for a fresh ID token. If Firebase rotates the refresh token, replace the stored value atomically.

Google supports PKCE and random-port loopback redirects for desktop applications. Firebase's REST API explicitly accepts a Google ID token and returns a Firebase ID token plus refresh token:

- [OAuth 2.0 for iOS and Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google OAuth 2.0 Best Practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Firebase Auth REST API: sign in with an OAuth credential](https://firebase.google.com/docs/reference/rest/auth#section-sign-in-with-oauth-credential)
- [Firebase Auth REST API: exchange a refresh token](https://firebase.google.com/docs/reference/rest/auth#section-refresh-token)

The CLI must not implement Google's removed out-of-band copy/paste flow, use a fixed loopback port, accept a callback without `state`, or persist Google access or refresh tokens. If no supported operating-system credential store is available, v1 should fail with a precise message instead of silently writing the refresh token to a plaintext config file.

## API authentication and authorization contract

- The API accepts only Firebase ID tokens issued for project `openjob-dev`. It does not accept raw Google tokens, Firebase custom tokens, API keys, usernames, or email addresses as proof of identity.
- Verify the JWT signature against Google's cached public keys and validate `alg`, `kid`, `exp`, `iat`, `auth_time`, `aud`, `iss`, and non-empty `sub` exactly as Firebase documents. Cache keys according to their response `Cache-Control` lifetime.
- Require `firebase.sign_in_provider` to be `google.com`. Firebase `uid`/JWT `sub` is the authentication subject.
- A User's email and Google profile fields are mutable metadata. They are not identity keys, Username, membership, or authorization.
- Every Group request names its Group explicitly. After authentication, the API reads current membership, Admin, and ban state before acting. A valid token never grants Group access by itself.
- Return `401` for a missing, expired, or invalid token. Return `403` when the authenticated User lacks permission for the requested Group operation.
- All client traffic uses HTTPS. Never log authorization headers, OAuth codes, ID tokens, or refresh tokens.

Firebase supports manual ID-token verification when an Admin SDK is unsuitable. The Worker can implement that verification with Web Crypto and cached public certificates, matching the platform style already used for service-account JWT signing:

- [Verify Firebase ID Tokens with a third-party JWT library](https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library)

## Session lifetime and revocation

- Firebase ID tokens last about one hour. Web and CLI refresh them before expiry and retry one request after a `401` only when a refresh succeeds.
- Web persistence lives in Firebase's origin-scoped browser storage. CLI persistence lives only in the operating-system credential store.
- Normal web sign-out clears the browser session. Normal CLI sign-out deletes the local Firebase refresh token and in-memory ID token.
- Firebase signature verification alone does not check revocation. v1 accepts at most the remaining ID-token lifetime after a Firebase account is disabled or its refresh tokens are revoked.
- Group access changes remain immediate because every request checks current membership and ban data. Kicking or banning a User does not require Firebase token revocation.
- A later `sign out everywhere` capability may revoke all Firebase refresh tokens for a User. Per-device server-side sessions are deliberately outside v1.

## Current deployment fit

The live project inspection on 2026-07-15 confirmed that `identitytoolkit.googleapis.com` and `securetoken.googleapis.com` are already enabled for `openjob-dev`.

The current Worker already has the Firebase project ID, keeps its service-account private key in Cloudflare secrets, and accesses Firestore only from the server. Keep Firestore's direct-client rules at deny-all. ID-token verification uses public signing certificates, so ordinary API authentication does not need another secret or a broader service-account scope.

Setup still required before implementation:

1. Register a Firebase Web App and commit only its public Firebase configuration.
2. Enable Google and no other Firebase sign-in provider.
3. Add `openjob.dev` to Firebase authorized domains and configure the OAuth consent screen.
4. Create a Google OAuth client of type Desktop for the CLI. Ship its public client ID; do not ship a client secret.
5. Use a Firebase client API key restricted to `identitytoolkit.googleapis.com` and `securetoken.googleapis.com`. The key is public project identification, not authorization.

Firebase documents its client API keys as public by design and recommends API restrictions:

- [Learn about using and managing API keys for Firebase](https://firebase.google.com/docs/projects/api-keys)

The current `/api/tasks` route is unauthenticated and operates on a global collection. This ticket does not retrofit it. The later shared API and migration work must place token verification before all User and Group data access.

## Rejected alternatives

- **Firebase session cookies for web:** good for a traditional server-rendered site, but they create a second credential type, cookie/CSRF handling, and a separate refresh shape while the current app is a client-rendered API consumer. Firebase ID tokens keep both clients equal and simpler.
- **Hosted OpenJob CLI handoff with one-time codes:** would require temporary code storage, PKCE validation, custom token minting, cleanup, and replay protection. Google's supported desktop flow already provides the browser handoff.
- **Opaque personal API tokens:** require OpenJob to build token hashing, lookup, rotation, revocation, device naming, and recovery. Firebase already owns this session lifecycle.
- **Raw Google tokens at the OpenJob API:** would force the API to support two issuers and keep web and CLI identity behavior from drifting. Convert Google credentials to Firebase first.
- **Device authorization or copy/paste codes:** unnecessary for a desktop CLI that can open a browser and listen on loopback; Google's old out-of-band flow is no longer supported.

## Build acceptance checks

- The same Google account produces the same Firebase `uid` and OpenJob User in web and CLI.
- Google is the only enabled provider, and the API rejects a valid Firebase token whose sign-in provider is not `google.com`.
- Tests reject bad signature, unknown `kid`, wrong issuer, wrong audience, expired token, future `iat`/`auth_time`, and empty subject.
- CLI login verifies PKCE and `state`, binds only to loopback, and never prints or logs tokens.
- A CLI restart can refresh without opening the browser; CLI sign-out removes its stored credential.
- A valid token for a kicked, banned, or non-Member User is still denied immediately by current Group authorization.
- No service-account key, OAuth code, ID token, or refresh token enters Git, logs, URLs, analytics, or Firestore.
