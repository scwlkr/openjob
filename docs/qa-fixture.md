# Two-User QA fixture

Issue #35 owns the permanent ordinary Test Users `@qa-one` and `@qa-two`.
`config/qa-fixture.json` is the non-secret preview fixture contract. The reset
uses Firestore operator credentials but adds no privileged product endpoint or
special authorization behavior. `@qa-one` uses real Google sign-in. `@qa-two`
uses one internal password principal in an isolated Preview Identity Platform
tenant; it is not a product Sign-in Method or Google/Apple acceptance evidence.

The reset currently targets only preview (`openjob-nonprod`) because
destructive automation remains non-production-only. It restores the disposable
Group `OpenJob QA Preview (Disposable)`, makes `@qa-one` Admin and `@qa-two`
Member, writes the exact seven-Task matrix, and removes only those Users'
Notification Subscriptions. It aborts before writing if either User has access
to another Group or if a User, Group, fixture, or installation identity does
not match.

## Access

Keep credentials, MFA/recovery material, Firebase UIDs, and stable OpenJob User
IDs in the owner-controlled 1Password vault. Keep Firebase operator credentials
and the exact QA Two UID allowlist in approved service secret stores. Never put
those values in Git, shell history, command arguments, screenshots, issue
comments, or diagnostics.

The two canonical vault items are `OpenJob QA One Google` and
`OpenJob QA Two Preview Password`. Provision QA Two only with the target-fixed
operator command. On the first run, omit the optional User-ID assertion:

```sh
OPENJOB_QA_TWO_EMAIL='op://Personal/OpenJob QA Two Preview Password/username' \
OPENJOB_QA_TWO_PASSWORD='op://Personal/OpenJob QA Two Preview Password/password' \
OPENJOB_QA_TWO_FIREBASE_UID='op://Personal/OpenJob QA Two Preview Password/Firebase UID' \
  op run -- npm run qa:user:provision
```

Store the returned `openJobUserId` in the item's `OpenJob User ID` field.
Subsequent runs must bind that value too:

```sh
OPENJOB_QA_TWO_EMAIL='op://Personal/OpenJob QA Two Preview Password/username' \
OPENJOB_QA_TWO_PASSWORD='op://Personal/OpenJob QA Two Preview Password/password' \
OPENJOB_QA_TWO_FIREBASE_UID='op://Personal/OpenJob QA Two Preview Password/Firebase UID' \
OPENJOB_QA_TWO_USER_ID='op://Personal/OpenJob QA Two Preview Password/OpenJob User ID' \
  op run -- npm run qa:user:provision
```

The provisioner never calls public signup. It target-confirms the nonproduction
project and isolated tenant, performs an admin-only exact UID/email lookup or
creation, signs in with the tenant password, and then uses only ordinary
`/api/v1/me` creation and Username routes. Any account, tenant, provider,
Username, or stable-ID mismatch stops without rewriting identity ownership.

For device and PWA acceptance:

1. Sign `@qa-one` in through Google.
2. Enter QA Two's vault-backed email and password in the visible
   **Preview QA sign-in** form. Development and Production clients do not
   contain this form.
3. Confirm `/api/v1/me` returns the separately recorded stable User ID and
   immutable Username on each platform.
4. Confirm both Users list only the disposable QA Group.
5. Never link QA Two's internal password identity. The API and clients reject
   that transition.

The maintainer CLI permits only `production` and `preview-qa-one`. Preview uses
a dedicated public Google Desktop OAuth client, a Preview Worker-held client
secret, and separate macOS Keychain and config namespaces. It never accepts a
runtime API or provider endpoint override. Add an `OpenJob User ID` field to the
`OpenJob QA One Google` 1Password item after ordinary User creation, then invoke
the CLI without exposing that value:

```sh
OPENJOB_PREVIEW_QA_EXPECTED_USER_ID='op://Personal/OpenJob QA One Google/OpenJob User ID' \
  op run -- openjob --profile preview-qa-one auth login
```

Use that unresolved `op://` wrapper for every later Preview CLI invocation too;
do not export the resolved User ID into a long-lived shell:

```sh
OPENJOB_PREVIEW_QA_EXPECTED_USER_ID='op://Personal/OpenJob QA One Google/OpenJob User ID' \
  op run -- openjob --profile preview-qa-one group list
```

The CLI writes the candidate refresh credential only after `/api/v1/me`
matches `@qa-one` and that 1Password-bound User ID exactly. A mismatch leaves
the existing Preview credential unchanged. The profile's Keychain account
contains only a short SHA-256-derived suffix, never the raw User ID.

Issue #34 establishes native trust, #36 supplies the native clients, and #37
owns product authentication acceptance. The internal QA password path removes
the need for a second consumer-provider account from this two-User fixture, but
#37 must remain open until real returning Google and Apple credentials plus its
physical-device and accessibility criteria are proven.

## Reset

Load these bindings from the approved secret-store session without printing
their values:

- `FIREBASE_PROJECT_ID=openjob-nonprod`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `OPENJOB_QA_ONE_USER_ID`
- `OPENJOB_QA_TWO_USER_ID`

Then run the exact target-confirmed command:

```sh
npm run qa:fixture:reset -- \
  --environment preview \
  --confirm openjob-two-user-qa-v1:openjob-nonprod:grp_9f5d28b6c10e4a7db3f924681c7e50aa
```

The command performs every preflight read and its literal write plan in one
Firestore transaction. A clean second run returns `"changed":false` and commits
the read-only transaction with zero document writes, preventing a concurrent
mutation from being mistaken for a no-op. It never creates User or provider
identity records, deletes collections, repairs non-QA access, or accepts User
IDs on the command line.

After reset, use the same preview `/api/v1` origin in native, PWA, API harness,
and the allowlisted `preview-qa-one` CLI profile:

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

- QA One provider access: recover the Google identity through its 1Password item
  and provider recovery flow, then verify `/me` still returns the recorded User
  ID.
- QA Two password access: generate a new high-entropy password in 1Password,
  update the exact tenant User through the Identity Platform admin surface,
  revoke its refresh tokens, clear saved Preview sessions, and rerun the
  provisioner with the recorded stable User ID.
- Wrong User or Username: stop and repair the explicit linking path owned by
  #37. Do not edit Firestore identity records or substitute another User ID.
- Non-QA Group access or an unexpected Group Member: inspect and remove it
  through ordinary `/api/v1` governance after confirming intent; rerun reset.
- Fixture or Group reservation mismatch: do not overwrite it. Reconcile the
  recorded fixture identity and repository manifest first.
- Missing fixture documents or one-sided Notification Subscription state:
  rerun the reset; those narrow partial states are recoverable.

## Rotation

Rotate QA One provider credentials and QA Two's tenant password in their
respective systems and 1Password without changing either Firebase UID or
OpenJob User. Revoke QA Two refresh tokens, clear saved Preview sessions, and
prove the old refresh credential fails before signing in again. Re-run Preview
web, iOS, and Android sign-ins and compare `/me` to the recorded stable IDs.

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
