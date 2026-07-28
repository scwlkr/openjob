# Owner + QA Two fixture

Issue #35 owns one stable two-User Preview fixture. Its Owner role maps to the
existing Google-backed `@scwlkr` User; there is no dedicated Google test
account or `@qa-one` User. Permanent `@qa-two` uses one internal
password principal in an isolated Preview Identity Platform tenant.
`config/qa-fixture.json` is the non-secret fixture contract. The reset uses
Firestore operator credentials but adds no privileged product endpoint or
special authorization behavior. QA Two's password is not a product Sign-in
Method or Google/Apple acceptance evidence.

The reset currently targets only preview (`openjob-nonprod`) because
destructive automation remains non-production-only. Fixture
`openjob-owner-qa-two-v2` restores the disposable Group
`OpenJob Owner + QA Two Preview (Disposable)`, makes `@scwlkr` Admin and
`@qa-two` Member, writes the exact seven-Task matrix, and clears only QA Two's
fixture Notification Subscriptions. It preserves every `@scwlkr` non-QA Group
and every `@scwlkr` notification registration. QA Two remains isolated: any
unexpected non-QA membership or identity mismatch aborts the reset before
writing. A User, Group, fixture, or installation identity mismatch also fails
closed.

## Routine testing lanes

Use two persistent Preview sessions for routine multi-User testing:

- Keep the physical phone signed in as Google-backed `@scwlkr`.
- Keep the simulator or emulator signed in as Preview-only `@qa-two`.
- Install app updates without clearing app state. Reset the fixture data rather
  than signing out, revoking access, or switching Google or Apple accounts.
- Enter real Google or Apple provider UI only when authentication, provider
  configuration, or signing changes, and once on the exact release candidate.

Real-provider checkpoints remain manual acceptance work on the required
platforms. The persistent `@qa-two` session speeds up ordinary multi-User
testing but never counts as Google or Apple evidence.

## Access

Keep credentials, MFA/recovery material, Firebase UIDs, and stable OpenJob User
IDs in the owner-controlled 1Password vault. Keep Firebase operator credentials
and the exact QA Two UID allowlist in approved service secret stores. Never put
those values in Git, shell history, command arguments, screenshots, issue
comments, or diagnostics.

The three canonical vault items are `OpenJob Preview Owner Binding`,
`OpenJob QA Two Preview Password`, and the
`OpenJob Preview QA Fixture Operator` document. The owner binding contains the
nonproduction stable OpenJob User ID plus a reference to the existing Google
account; it never duplicates the Google password. The operator is a dedicated
`openjob-nonprod` service account with only `roles/datastore.user`; its JSON
key stays in the document. A short-lived parent process captures
`op document get` in memory, maps only `client_email` and `private_key` into
the reset child's environment, and discards them when the child exits. If a
tool requires a file, create one mode `0600` and remove it in a `finally`
cleanup. Never use shell command substitution for the document. The permanent
OpenJob User ID must already exist in the QA Two vault item before the
target-fixed provisioner runs:

```sh
OPENJOB_QA_TWO_EMAIL='op://Personal/OpenJob QA Two Preview Password/username' \
OPENJOB_QA_TWO_PASSWORD='op://Personal/OpenJob QA Two Preview Password/password' \
OPENJOB_QA_TWO_FIREBASE_UID='op://Personal/OpenJob QA Two Preview Password/Firebase UID' \
OPENJOB_QA_TWO_USER_ID='op://Personal/OpenJob QA Two Preview Password/OpenJob User ID' \
  op run -- npm run qa:user:provision
```

The provisioner never calls public signup or `POST /api/v1/me`. It
target-confirms the nonproduction project and isolated tenant, performs an
admin-only exact UID/email lookup or creation, signs in with the tenant
password, and then uses ordinary `/api/v1/me` verification and Username
routes. Its output contains only safe status fields, never the stable User ID.
Any account, tenant, provider, Username, or stable-ID mismatch stops without
rewriting identity ownership. A missing OpenJob User requires a reviewed
fixture migration; the product and provisioner cannot self-register QA Two.

For device and PWA acceptance:

1. Sign the existing `@scwlkr` User in through Google when real Google proof is
   required.
2. Enter QA Two's vault-backed email and password in the visible
   **Preview QA sign-in** form. Development and Production clients do not
   contain this form.
3. Confirm `/api/v1/me` returns the separately recorded stable User ID and
   immutable Username on each platform.
4. Confirm QA Two lists only the disposable QA Group. `@scwlkr` may retain
   ordinary non-QA memberships; fixture operations must remain scoped to the
   disposable QA Group.
5. Never link QA Two's internal password identity. The API and clients reject
   that transition.

The maintainer CLI permits only `production` and `preview-owner`. Preview uses
a Preview-specific public Google Desktop OAuth application client, a Preview
Worker-held client secret, and separate macOS Keychain and config namespaces.
It never accepts a runtime API or provider endpoint override. Record the
existing nonproduction User ID and account reference in
`OpenJob Preview Owner Binding`, then invoke the CLI without exposing that
value:

```sh
OPENJOB_PREVIEW_OWNER_EXPECTED_USER_ID='op://Personal/OpenJob Preview Owner Binding/OpenJob User ID' \
  op run -- openjob --profile preview-owner auth login
```

Use that unresolved `op://` wrapper for every later Preview CLI invocation too;
do not export the resolved User ID into a long-lived shell:

```sh
OPENJOB_PREVIEW_OWNER_EXPECTED_USER_ID='op://Personal/OpenJob Preview Owner Binding/OpenJob User ID' \
  op run -- openjob --profile preview-owner group list
```

The CLI writes the candidate refresh credential only after `/api/v1/me`
matches `@scwlkr` and that 1Password-bound User ID exactly. A mismatch leaves
the existing Preview credential unchanged. The profile's Keychain account
contains only a short SHA-256-derived suffix, never the raw User ID.

Issue #34 establishes native trust, #36 supplies the native clients, and #37
owns product authentication acceptance. The internal QA password path removes
the need for any dedicated Google test account or a second consumer-provider
account from this two-User fixture, but #37 must remain open until real
returning Google and Apple credentials plus its physical-device and
accessibility criteria are proven.

## Reset

Load these bindings from the approved secret-store session without printing
their values:

- `FIREBASE_PROJECT_ID=openjob-nonprod`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `OPENJOB_QA_OWNER_USER_ID`
- `OPENJOB_QA_TWO_USER_ID`

The launcher must capture the operator document and the two binding items
inside one short-lived process, map their fields to the environment names
above, invoke the reset as its child, and discard every resolved value on
exit. Do not place the resolved JSON, private key, User IDs, or email in shell
arguments, history, terminal output, or a long-lived exported environment.

Then run the exact target-confirmed command:

```sh
npm run qa:fixture:reset -- \
  --environment preview \
  --confirm openjob-owner-qa-two-v2:openjob-nonprod:grp_9f5d28b6c10e4a7db3f924681c7e50aa
```

The command performs every preflight read and its literal write plan in one
Firestore transaction. A clean second run returns `"changed":false` and commits
the read-only transaction with zero document writes, preventing a concurrent
mutation from being mistaken for a no-op. It never creates User or provider
identity records, deletes collections, changes `@scwlkr` non-QA Groups or
notification registrations, repairs QA Two's non-QA access, or accepts User IDs
on the command line.

After reset, use the same preview `/api/v1` origin in native, PWA, API harness,
and the allowlisted `preview-owner` CLI profile:

```text
https://openjob-preview.walkerworlddiscord.workers.dev/api/v1
```

Verify both `/me` responses, both Group lists, the seven-Task matrix, and one
state change observed in each direction.

The fixture anchors date-only due dates to `America/Chicago`. Keep acceptance
devices on that calendar time zone when proving the today/overdue matrix near a
date boundary.

## Recovery

If reset blocks, preserve the state and resolve the named mismatch:

- Owner provider access: use `OpenJob Preview Owner Binding` to locate the
  existing Google account's provider-owned recovery path, then verify `/me`
  still returns the recorded `@scwlkr` User ID. Do not copy the Google password
  into the binding item.
- QA Two password access: generate a new high-entropy password in 1Password,
  update the exact tenant User through the Identity Platform admin surface,
  revoke its refresh tokens, clear saved Preview sessions, and rerun the
  provisioner with the recorded stable User ID.
- Wrong User or Username: stop and repair the explicit linking path owned by
  #37. Do not edit Firestore identity records or substitute another User ID.
- QA Two non-QA Group access or an unexpected disposable-Group Member: inspect
  and remove it through ordinary `/api/v1` governance after confirming intent;
  rerun reset. Existing `@scwlkr` non-QA memberships are expected and must not
  be removed.
- Fixture or Group reservation mismatch: do not overwrite it. Reconcile the
  recorded fixture identity and repository manifest first.
- Missing fixture documents or unexpected QA Two Notification Subscription
  state: rerun the reset; those narrow partial states are recoverable.

## Rotation

Rotate the owner's Google credentials only through the provider-owned account
and keep only its account reference and nonproduction OpenJob User ID in
`OpenJob Preview Owner Binding`. Rotate QA Two's tenant password in Identity
Platform and 1Password without changing its Firebase UID or OpenJob User.
Revoke QA Two refresh tokens, clear saved Preview sessions, and prove the old
refresh credential fails before signing in again. Re-run Preview web, iOS, and
Android sign-ins and compare `/me` to the recorded stable IDs.

Rotate the Firebase operator key in its provider and approved secret store,
revoke the previous key, run `npm run secret:check`, then perform one
target-confirmed reset. User IDs and fixture IDs are not rotated to work around
an identity mismatch; changing either requires a reviewed fixture migration.

## Evidence

Record only:

- commit SHA and preview build identifiers;
- date, platform, authentication method used, and pass/fail;
- separate real-provider evidence from internal QA password evidence;
- confirmation that `/me` matched the separately recorded stable IDs and
  immutable Usernames, without copying credentials or provider payloads;
- reset result (`changed`, Task count, write count) and second-run no-op;
- native, PWA, API, CLI, and release-journey results;
- bidirectional Task IDs and observed final states.

Do not attach tokens, assertions, emails, provider payloads, Push endpoints or
keys, MFA/recovery material, service credentials, screenshots of provider
flows, or raw terminal environment output. Run `npm run secret:check` before
posting concise evidence to issue #35.
