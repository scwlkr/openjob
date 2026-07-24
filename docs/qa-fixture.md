# Two-User QA fixture

Issue #35 owns the permanent ordinary Test Users `@qa-one` and `@qa-two`.
`config/qa-fixture.json` is the non-secret preview fixture contract. The reset
uses Firestore operator credentials but adds no privileged product endpoint or
special User behavior.

The reset currently targets only preview (`openjob-nonprod`) because
destructive automation remains non-production-only. It restores the disposable
Group `OpenJob QA Preview (Disposable)`, makes `@qa-one` Admin and `@qa-two`
Member, writes the exact seven-Task matrix, and removes only those Users'
Notification Subscriptions. It aborts before writing if either User has access
to another Group or if a User, Group, fixture, or installation identity does
not match.

## Access

Keep each provider credential, MFA method, recovery material, and the recorded
stable OpenJob User ID in the owner-controlled 1Password vault. Keep the
Firebase operator credential in an approved service secret store. Never put
those values in Git, shell history, command arguments, screenshots, issue
comments, or diagnostics.

After #34, #36, and #37 are complete:

1. Use the dedicated Google identity for `@qa-one` and dedicated Apple identity
   for `@qa-two`. Neither identity may be used for company work.
2. Complete each real provider flow in both iOS and Android preview builds.
3. Claim the immutable Usernames through ordinary `/api/v1/me/username`.
4. Confirm ordinary `/api/v1/me` returns the same recorded User ID and Username
   on both platforms. Stop on any mismatch; never create, merge, or rewrite an
   identity to make the fixture pass.
5. Confirm both Users list only the disposable QA Group before running release
   acceptance.

The repository now contains Google and Apple authentication, explicit
provider-linking, and a deployed isolated preview API. Issue #35 must remain
open until #34's provider/account gates are complete and real provider sign-in
is proven on physical iOS and Android preview builds. Issue #37 must remain open
until its corresponding real-provider and physical-device proof is complete.

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
and CLI (`OPENJOB_API_URL`):

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

- Provider access: recover the dedicated provider identity through its
  1Password item and provider recovery flow, then verify `/me` still returns
  the recorded User ID.
- Wrong User or Username: stop and repair the explicit linking path owned by
  #37. Do not edit Firestore identity records or substitute another User ID.
- Non-QA Group access or an unexpected Group Member: inspect and remove it
  through ordinary `/api/v1` governance after confirming intent; rerun reset.
- Fixture or Group reservation mismatch: do not overwrite it. Reconcile the
  recorded fixture identity and repository manifest first.
- Missing fixture documents or one-sided Notification Subscription state:
  rerun the reset; those narrow partial states are recoverable.

## Rotation

Rotate provider passwords, MFA, and recovery material in the provider and
1Password without changing the OpenJob User. Re-run the four preview sign-ins
and compare `/me` to the recorded stable IDs after rotation.

Rotate the Firebase operator key in its provider and approved secret store,
revoke the previous key, run `npm run secret:check`, then perform one
target-confirmed reset. User IDs and fixture IDs are not rotated to work around
an identity mismatch; changing either requires a reviewed fixture migration.

## Evidence

Record only:

- commit SHA and preview build identifiers;
- date, platform, provider used, and pass/fail for each real sign-in;
- confirmation that `/me` matched the separately recorded stable IDs and
  immutable Usernames, without copying credentials or provider payloads;
- reset result (`changed`, Task count, write count) and second-run no-op;
- native, PWA, API, CLI, and release-journey results;
- bidirectional Task IDs and observed final states.

Do not attach tokens, assertions, emails, provider payloads, Push endpoints or
keys, MFA/recovery material, service credentials, screenshots of provider
flows, or raw terminal environment output. Run `npm run secret:check` before
posting concise evidence to issue #35.
