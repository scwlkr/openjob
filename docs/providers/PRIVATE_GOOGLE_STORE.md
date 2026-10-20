# Disabled encrypted Google store — WLK318

`db/private-google-connections.ts` implements the existing private owner-envelope
contract using Firestore REST compare-and-swap and WebCrypto AES-256-GCM. It is
source preparation, with no default activation, credential access, collection provisioning, security-rule
change or live activation. The explicit portable opt-in and bounded file loader
are described in [portable configuration](../PORTABLE_SERVICE.md#optional-google-configuration-preparation).
Firestore is an engineering choice that reuses the working database and user fence;
it is not a request for the owner to choose another database.

Construction requires an explicitly injected REST client, nonextractable AES key
and versioned key identifier. A bounded snapshot of up to four previous key IDs/keys
can decrypt older envelopes; only the current key encrypts writes. Duplicate IDs,
unknown keys and invalid key capabilities fail closed. Operations default to disabled. Tests import fixed
invented key bytes and use fake Firestore/Google transports. No key or client
secret is generated, read or persisted for actual use.

## Behavior

The entire connection array—including addresses, grants and pending PKCE/nonce—is
encrypted. Documents expose only format version, key identifier, nonce and
ciphertext. Fresh 96-bit nonces and 128-bit authentication tags bind each envelope
to its exact database/document path, owner, format and key identifier. Copied,
corrupt, unknown-version or wrong-key envelopes fail closed. Errors never expose
plaintext or underlying storage/provider messages. AES-GCM protects confidentiality
and integrity; it does not protect against rollback by a trusted database operator.

Read and write results require an active existing User. Writes atomically include
the existing active-user history fence plus the envelope update-time/missing-document
precondition. Only definitive CAS conflicts retry the pure transformation, at most
three times. Transport failures or lost successful commit responses are returned
without replay; callers must inspect current state, never repeat a consent exchange
because a storage response was uncertain. Supplied transports must preserve this
property. A post-commit activity failure also never retries the successful write.

UTF-8 plaintext is bounded at 600,000 bytes and encoded documents at 850,000 bytes,
below Firestore's document limit, including base64 overhead. This is deliberately
stricter than the orchestration layer's character bound. Existing 50-connection
limits remain. Reconstructed store instances read persisted ciphertext with the
same injected key; tests prove persistence in a fake backing database, not a live
Firestore deployment, disk durability or production restart.

Explicit `cleanupExpiredForOwner` changes expired pending attempts to reconnect
required and removes their verifier/nonce from the current envelope through CAS.
No scheduler is installed. Disconnect already removes current grants through the
same encrypted write. `disconnectAllForOwner` atomically clears pending secrets and
current grants, preserving subject/home/connection lineage. In-flight authorization
becomes cleanup-pending and cannot promote its late result. This is local access
revocation, not Google grant revocation.

`reencryptForOwner` rewrites the latest owner envelope under the current injected
key through the same CAS and active-User fences. It preserves lifecycle state;
it does not refresh a token or contact a provider. Existing old-key-only readers
fail closed after re-encryption. A successful owner rewrite is not proof that an
old key is safe to retire globally: every retained owner/backup and concurrent
process must be accounted for before operational retirement. No implicit loader, key
creation/rotation service or automatic migration is installed.

`removeForDeletion(owner, requestId)` is a separate internal cleanup path. It
requires the exact existing User with deletionState=pending and matching request
ID, then atomically verifies that User's update time and deletes the exact envelope and retained Personal-home reference
with CAS. Existing Personal-store deletion handles the retained work itself. Active, absent, foreign and replaced deletion requests cannot authorize
cleanup. It does not decrypt and can remove corrupt/unknown-key ciphertext even
when a decryption key is missing. A successful delete with a lost response is not
replayed; a later explicit inspection can observe the envelope absent. No current
record can be recreated through normal writes while the User is pending deletion.
The existing account-deletion runtime attaches this dependency only with explicit
`GOOGLE_CONNECTIONS_CLEANUP_MODE=configured`; absent means disabled, unknown modes
fail closed. It runs before Firebase/User finalization; failure keeps deletion
pending. This source change sets no binding and launches no worker or deletion.
The portable server exposes no cleanup endpoint or new scheduler. Neither operation erases old database backups or revokes
Google's project-wide grants.

## Before activation

No live policy is silently adopted by this implementation. The concrete activation
handoff still needs approved key/client-secret delivery, private server-only database
access, key loss/rotation and backup retention procedures, plus explicit injection of the account-deletion cleanup dependency in the selected
runtime. The tested cleanup hook exists but remains unbound; ordinary access is
fenced when deletion starts. Existing pending secrets expire after ten minutes;
a later explicit cleanup invocation erases them from the current record. Backup
erasure and upstream revocation need their actual operational limits documented.

The exact approved HTTPS deployment/callback handoff and Google configuration and
mailbox consent remain separate. Basic Google name/profile sign-in does not grant
Gmail access. This source does not send mail, access a mailbox or enable providers.

Focused proof: `node --test tests/private-google-connections.test.mjs
 tests/private-google-lifecycle.test.mjs tests/google-connection-flow.test.mjs
 tests/v1-account-deletion.test.mjs` (one shell line). This covers encrypted
first-consent/refresh/fake-Mail/disconnect, instance reconstruction, corruption and
owner/database binding, CAS races, lost commit response, deletion race, expiry,
capacity, key re-encryption/retirement denial, local disconnect-all, exact pending
deletion cleanup and disabled/no-call behavior. Provider responses and keys are synthetic.

## Run the local integrated flow

`npm run test:google-local` runs a one-shot ephemeral127.0.0.1 HTTP service and
actual existing CLI subprocesses against `createPersonalApplication`, the Google
protocol flow and encrypted Firestore store. It restores an exported encrypted fake
database snapshot and reconstructs the client/store/flow before refresh/read.
It verifies synthetic callback consumption, fake Mail, disconnect, stable-home
reconnect, foreign/agent/send denial and credential-free CLI output. All resources
and authored fixture files belong to the test and close/remove on completion.
The test does not open its returned Google authorization URL or contact Google;
only the loopback HTTP service uses actual network. Its transient CLI credential
file contains invented fixture text. No existing browser/pilot session is touched.

The ordinary sandbox may disallow binding localhost; run this proof only in an
execution context authorized to bind an ephemeral loopback port. A bind failure
is not provider failure or a passing flow. No public listener is needed.

This source work is now locally integrated. Remaining activation inputs are:

1. Infrastructure owner's exact approved HTTPS origin and deployment handoff;
   register only origin + `/connections/google/callback` for the chosen existing
   Google Web client, preserving the Firebase handler.
2. Approved actual key/client-secret delivery references and private server-only
   Firestore access, with concrete backup/retention/rotation procedures. Do not
   generate keys, retrieve credentials or change rules during this proof.
3. The reviewed explicit portable configuration wires dependencies only after
   opt-in; default roots remain unconfigured. Enable the reviewed cleanup binding in the existing same-project worker and
   select the retained Personal home through its explicit mapping action. Google
   opt-in admits only its exact selected binding to the bounded Workspace pilot;
   no mapping is automatic.
4. Current Google Data Access/Verification facts, specific Gmail API/callback and
   runtime/store activation authorization, and human consent for the exact chosen
   alternate mailbox and only the disclosed read-only/offline scopes. Basic
   name/profile sign-in is insufficient. Then verify one bounded read.

Interactive callback/browser proof and actual Firebase/Firestore/Google acceptance
remain unverified. No further storage abstraction or new service is required by
this local proof. PR95's unrelated browser-export outcome does not gate Mail work.
