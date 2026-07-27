# Release Candidate coordinator

`release:candidate` owns one durable, machine-readable record for an immutable
OpenJob Release Candidate. The record contains no credentials, authentication
material, personal data, Task content, or Group content. It may be copied to a
different session or machine and resumed with the same repository revision.

This workflow does not authorize a real cloud build, upload, submission, store
promotion, or public release. Issue #46 uses fake executors only. A future #41
operator must separately choose an executor, review every preview, and pass the
exact `confirmationToken` for each external action.

## Prepare and inspect

First run the complete Verification Mode from a clean default branch and keep
its stdout as the input record. Gate logs stay on stderr.

```sh
npm run verify -- release-candidate --base v0.3.3 \
  > .openjob/release-candidate-verification.json

npm run release:candidate -- prepare \
  --record .openjob/release-candidates/0.3.4.json \
  --verification-result .openjob/release-candidate-verification.json \
  --environment production

npm run release:candidate -- inspect \
  --record .openjob/release-candidates/0.3.4.json
```

Preparation fetches `origin`, then fails closed unless the current branch is
the clean, synchronized default branch. Root, lockfile, CLI, native, and OpenAPI
versions must agree. The identity freezes the commit, dependency locks, native
identities and EAS profile, permission and signing metadata, tool/runtime
versions, and Release Privacy Inventory fingerprint. Repeating `prepare` for
the same identity leaves the record byte-for-byte unchanged.

Keep the record in a durable encrypted or access-controlled project artifact
store when handing it to another machine. Do not edit it. Compare the
`recordFingerprint` returned by `handoff` after transfer.

## Preview and execute

Every mutating external step is two-phase. The first command is a preview and
does not call the executor. Review its candidate, platform, artifact, and
reason. Then repeat the command with the exact returned token:

```sh
npm run release:candidate -- execute \
  --record .openjob/release-candidates/0.3.4.json \
  --action build --platform ios --executor /secure/path/executor.mjs

npm run release:candidate -- execute \
  --record .openjob/release-candidates/0.3.4.json \
  --action build --platform ios --executor /secure/path/executor.mjs \
  --confirm '<confirmationToken>'
```

Repeat for Android, then preview and confirm submission of each recorded
Candidate Artifact:

```sh
npm run release:candidate -- execute \
  --record .openjob/release-candidates/0.3.4.json \
  --action submit --platform ios --executor /secure/path/executor.mjs

npm run release:candidate -- execute \
  --record .openjob/release-candidates/0.3.4.json \
  --action submit --platform android --executor /secure/path/executor.mjs
```

The coordinator writes the stable request key before calling the executor.
Successful builds and submissions are never requested again. Apple and Google
progress independently, while source or declared release-input drift
invalidates the candidate before another external action.

After an uncertain EAS failure, the coordinator sends `resume-build` with the
original request key. The executor must reconcile or continue that request; it
must not create another build. Only the first attempt receives action `build`.

## Status and resume

Status polling is read-only at the provider boundary and needs no confirmation:

```sh
npm run release:candidate -- status \
  --record .openjob/release-candidates/0.3.4.json \
  --platform ios --executor /secure/path/executor.mjs
```

`resume` selects only the earliest failed or incomplete platform step. A build,
submission, or evidence retry previews the same confirmation token; store
status polling runs directly. Successful earlier state and the other platform
remain unchanged.

```sh
npm run release:candidate -- resume \
  --record .openjob/release-candidates/0.3.4.json \
  --platform ios --executor /secure/path/executor.mjs
```

Authentication renewal, rate limits, service recovery, store metadata
correction, review delay, and submission-only retry reuse an unchanged
Candidate Artifact. A source, lock, native configuration, signing, permission,
or privacy-inventory change requires a new record path and identity.

## #41 evidence and coequal promotion

After each exact internal-store artifact is available, preview and confirm its
physical proof. Then collect the single #41 result and privacy reconciliation:

```sh
npm run release:candidate -- execute \
  --record .openjob/release-candidates/0.3.4.json \
  --action physical-proof --platform ios --executor /secure/path/executor.mjs

npm run release:candidate -- execute \
  --record .openjob/release-candidates/0.3.4.json \
  --action release-proof --platform all --executor /secure/path/executor.mjs
```

#41 is the sole live Release Proof gate. Missing platform proof, a stale input,
artifact mismatch, unresolved privacy discrepancy, or unapproved limitation
blocks both platforms. Promotion has one combined preview and cannot select a
single platform:

```sh
npm run release:candidate -- execute \
  --record .openjob/release-candidates/0.3.4.json \
  --action promote --platform all --executor /secure/path/executor.mjs
```

## Invalidate and hand off

Use a short non-secret reason when an operator deliberately retires a record.
Invalidation never erases a successful artifact or evidence entry.

```sh
npm run release:candidate -- invalidate \
  --record .openjob/release-candidates/0.3.4.json \
  --reason 'production signing identity rotated'

npm run release:candidate -- handoff \
  --record .openjob/release-candidates/0.3.4.json
```

`handoff` returns the record fingerprint and every remaining blocker. #41
consumes this same record; it does not reconstruct state from issue prose or
provider dashboards.

## Executor JSON protocol

`--executor` names a Node.js module outside the candidate record. The
coordinator sends one JSON request on stdin and accepts one JSON response on
stdout. Credentials stay in the executor process or its provider-native secure
store. They must never appear in either JSON document.

Requests identify `action`, `platform`, the stable `requestKey`, the frozen
candidate identity, and only the recorded artifact/store fields needed by that
step. Responses use `schemaVersion: 1` and either `status: "succeeded"` with the
provider IDs, build number, checksum, matching identity, and safe evidence
references, or `status: "failed"` with a non-secret error code and
`classification` of `resumable` or `terminal`.

Build executors return the EAS build ID, artifact ID, SHA-256 checksum, platform
build/version number, source revision, input fingerprint, and release version.
Apple/Google submission and status executors return submission/store build IDs
and independent processing/availability states. Evidence executors return only
short HTTPS, `local://`, or `executor://` references. The combined promotion
executor must return matching results for both iOS and Android.
