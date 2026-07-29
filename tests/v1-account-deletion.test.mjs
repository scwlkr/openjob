import assert from "node:assert/strict";
import test from "node:test";
import {
  createV1AccountDeletionApi,
  createV1AccountDeletionHandler,
} from "../server/v1-account-deletion.ts";
import { AccountDeletionReauthenticationRequiredError } from "../server/account-deletion-providers.ts";
import { createOpenApiResponseValidator } from "./support/openapi-response.mjs";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const USER = { userId: "user_delete", username: "delete-me" };
const STATUS_TOKEN =
  "v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const PREPARED_STATUS_TOKEN =
  "v1.EEEEEEEEEEEEEEEE.FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
const TAMPERED_STATUS_TOKEN =
  "v1.CCCCCCCCCCCCCCCC.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
const GOOGLE = {
  authenticatedAt: NOW - 30_000,
  expiresAt: NOW + 30 * 60_000,
  provider: "google",
  providerSubject: "google-subject",
  uid: "firebase_delete_google",
};
const APPLE_WEB = {
  authenticatedAt: NOW - 30_000,
  expiresAt: NOW + 30 * 60_000,
  provider: "apple",
  providerSubject: "apple-subject",
  uid: "firebase_delete_apple",
};

function deletionRequest(
  credentials,
  statusToken = PREPARED_STATUS_TOKEN,
  url = "https://openjob.test/api/v1/me/deletion",
) {
  return new Request(url, {
    body: JSON.stringify({ confirmation: "delete", credentials }),
    headers: {
      "content-type": "application/json",
      ...(statusToken
        ? { "x-openjob-deletion-status": statusToken }
        : {}),
    },
    method: "POST",
  });
}

function statusRequest(statusToken, url = "https://openjob.test/api/v1/me/deletion") {
  return new Request(url, {
    ...(statusToken
      ? { headers: { authorization: `Bearer ${statusToken}` } }
      : {}),
  });
}

function statusTokenRequest(credential) {
  return new Request("https://openjob.test/api/v1/me/deletion", {
    ...(credential
      ? {
          body: JSON.stringify({ credential }),
          headers: { "content-type": "application/json" },
        }
      : {}),
    method: "PUT",
  });
}

function refreshRequest(
  credential,
  statusToken = STATUS_TOKEN,
) {
  return new Request("https://openjob.test/api/v1/me/deletion", {
    body: JSON.stringify({ credential }),
    headers: {
      authorization: `Bearer ${statusToken}`,
      "content-type": "application/json",
    },
    method: "PATCH",
  });
}

function googleProof(overrides = {}) {
  return {
    credentialToken: "fresh-google-token",
    provider: "google",
    revocation: {
      idToken: "fresh-google-provider-id-token",
      kind: "access_token",
      value: "google-access-token",
    },
    ...overrides,
  };
}

function appleWebProof(overrides = {}) {
  return {
    credentialToken: "fresh-apple-token",
    provider: "apple",
    revocation: {
      clientId: "dev.openjob.auth",
      kind: "access_token",
      value: "apple-access-token",
    },
    ...overrides,
  };
}

function appleNativeProof(overrides = {}) {
  return {
    credentialToken: "fresh-apple-token",
    provider: "apple",
    revocation: {
      clientId: "dev.openjob.app",
      idToken: "fresh-apple-provider-id-token",
      kind: "authorization_code",
      value: "fresh-apple-authorization-code",
    },
    ...overrides,
  };
}

function createHarness({
  deleteForAccountResult = true,
  deletionPending: initiallyDeletionPending = false,
  failAuthorization = false,
  firebaseDeletionFailures = 0,
  failNotifications = false,
  finalized = false,
  identity = GOOGLE,
  providerMismatch = false,
  requireReauthentication = false,
} = {}) {
  const calls = [];
  let deletionPending = initiallyDeletionPending;
  let pendingJob = null;
  let currentNow = NOW;
  let finalizeOnRecovery = false;
  let finalizedState = finalized;
  let userAbsent = false;
  let rejectRecoveryReopen = false;
  let failStatusRead = false;
  let statusLookup = {
    deadline: "2026-08-04T12:00:00.000Z",
    kind: "pending",
    reauthenticationProviders: [],
    requestedAt: "2026-07-28T12:00:00.000Z",
  };
  const api = createV1AccountDeletionApi({
    groups: {
      async listForDeletion() {
        calls.push("list-groups");
        return {
          groups: [{ groupId: "grp_delete", name: "Delete", role: "admin" }],
          nextCursor: null,
        };
      },
      async removeUserForDeletion(userId, groupId) {
        calls.push(`remove-group:${userId}:${groupId}`);
        return { kind: "ended" };
      },
      async removeDetachedUserData(userId) {
        calls.push(`remove-detached:${userId}`);
        return 0;
      },
    },
    jobs: {
      assertReady() {
        calls.push("job-ready");
      },
      async claim(userId, leaseUntil) {
        if (!pendingJob || pendingJob.processing) return false;
        pendingJob.processing = true;
        pendingJob.processingLeaseUntil = leaseUntil;
        calls.push(`claim:${userId}`);
        return true;
      },
      async reopenCredential(
        _userId,
        replacement,
        leaseUntil,
      ) {
        if (rejectRecoveryReopen) {
          rejectRecoveryReopen = false;
          return null;
        }
        if (finalizeOnRecovery) {
          finalizeOnRecovery = false;
          deletionPending = false;
          finalizedState = true;
          userAbsent = true;
          pendingJob = null;
          return null;
        }
        if (!pendingJob) return null;
        const index = pendingJob.credentials.findIndex((credential) =>
          credential.provider === replacement.provider &&
          credential.firebaseUid === replacement.firebaseUid
        );
        if (index < 0) return null;
        pendingJob.credentials[index] = replacement;
        pendingJob.completedSteps = pendingJob.completedSteps.filter((step) =>
          step !== `firebase-sessions:${replacement.provider}` &&
          step !== `provider-attempted:${replacement.provider}` &&
          step !== `provider:${replacement.provider}`
        );
        pendingJob.processing = true;
        pendingJob.processingLeaseUntil = leaseUntil;
        pendingJob.reauthenticationProviders = [...new Set([
          ...pendingJob.reauthenticationProviders,
          replacement.provider,
        ])].sort();
        calls.push(`reopen-credential:${replacement.provider}`);
        return {
          ...pendingJob,
          completedSteps: [...pendingJob.completedSteps],
          credentials: pendingJob.credentials.map((credential) => ({
            ...credential,
          })),
          reauthenticationProviders: [
            ...pendingJob.reauthenticationProviders,
          ],
        };
      },
      async listPending() {
        return pendingJob ? [pendingJob] : [];
      },
      async completeProvider(_userId, expected, expectedLeaseUntil) {
        if (!pendingJob) return false;
        if (pendingJob.processingLeaseUntil !== expectedLeaseUntil) return false;
        const index = pendingJob.credentials.findIndex((credential) =>
          JSON.stringify(credential) === JSON.stringify(expected)
        );
        if (index < 0) return false;
        pendingJob.credentials[index] = {
          firebaseUid: expected.firebaseUid,
          provider: expected.provider,
          providerSubject: expected.providerSubject,
        };
        pendingJob.completedSteps = [...new Set([
          ...pendingJob.completedSteps,
          `provider:${expected.provider}`,
        ])];
        pendingJob.reauthenticationProviders =
          pendingJob.reauthenticationProviders.filter(
            (provider) => provider !== expected.provider,
          );
        calls.push(`checkpoint:provider:${expected.provider}`);
        return true;
      },
      async markCompletedStep(_userId, step, expectedLeaseUntil) {
        if (pendingJob?.processingLeaseUntil !== expectedLeaseUntil) {
          throw new Error("stale checkpoint lease");
        }
        pendingJob.completedSteps = [...new Set([
          ...pendingJob.completedSteps,
          step,
        ])];
        calls.push(`checkpoint:${step}`);
      },
      async markEscalated(_userId, escalatedAt) {
        if (!pendingJob || pendingJob.escalatedAt) return false;
        pendingJob.escalatedAt = escalatedAt;
        calls.push("mark-escalated");
        return true;
      },
      async markReauthenticationRequired(
        _userId,
        expected,
        expectedLeaseUntil,
      ) {
        if (!pendingJob) return false;
        if (pendingJob.processingLeaseUntil !== expectedLeaseUntil) return false;
        pendingJob.reauthenticationProviders = [...new Set([
          ...pendingJob.reauthenticationProviders,
          expected.provider,
        ])].sort();
        calls.push(`reauthentication:${expected.provider}`);
        return true;
      },
      async isFinalized(userId) {
        calls.push(`is-finalized:${userId}`);
        return finalizedState;
      },
      async prepareStatusToken(userId) {
        calls.push(`prepare-status:${userId}`);
        return deletionPending
          ? pendingJob
            ? {
                deadline: pendingJob.deadline,
                kind: "pending",
                reauthenticationProviders:
                  pendingJob.reauthenticationProviders,
                requestedAt: pendingJob.startedAt,
                statusToken: STATUS_TOKEN,
              }
            : { kind: "unavailable" }
          : {
              kind: "prepared",
              statusToken: PREPARED_STATUS_TOKEN,
              submissionExpiresAt: "2026-07-28T12:05:00.000Z",
            };
      },
      async readStatus(statusToken) {
        calls.push("read-status");
        if (failStatusRead) throw new Error("database unavailable");
        return [STATUS_TOKEN, PREPARED_STATUS_TOKEN].includes(statusToken)
          ? statusLookup
          : { kind: "invalid" };
      },
      async readRefreshTarget(statusToken, provider) {
        if (
          ![STATUS_TOKEN, PREPARED_STATUS_TOKEN].includes(statusToken) ||
          !pendingJob
        ) {
          return { kind: "invalid" };
        }
        if (!pendingJob.reauthenticationProviders.includes(provider)) {
          return { kind: "not_required" };
        }
        const credential = pendingJob.credentials.find((candidate) =>
          candidate.provider === provider
        );
        return credential
          ? { credential, job: pendingJob, kind: "target" }
          : { kind: "unavailable" };
      },
      async replaceCredential(
        _userId,
        expected,
        replacement,
        expectedLeaseUntil,
        clear = false,
      ) {
        if (!pendingJob) return false;
        if (pendingJob.processingLeaseUntil !== expectedLeaseUntil) return false;
        const index = pendingJob.credentials.findIndex((credential) =>
          JSON.stringify(credential) === JSON.stringify(expected)
        );
        if (index < 0) return false;
        pendingJob.credentials[index] = replacement;
        if (clear) {
          pendingJob.reauthenticationProviders =
            pendingJob.reauthenticationProviders.filter(
              (provider) => provider !== expected.provider,
            );
        }
        calls.push(`replace-credential:${expected.provider}`);
        return true;
      },
      async start(userId, credentials, statusToken) {
        calls.push("start");
        if (statusToken !== PREPARED_STATUS_TOKEN) {
          return { kind: "invalid" };
        }
        if (providerMismatch) return { kind: "provider_mismatch" };
        pendingJob ??= {
          credentials,
          completedSteps: [],
          deadline: "2026-08-04T12:00:00.000Z",
          intentId: "intent_test",
          reauthenticationProviders: [],
          requestId: "del_test",
          startedAt: "2026-07-28T12:00:00.000Z",
          submissionExpiresAt: "2026-07-28T12:05:00.000Z",
          userId,
        };
        deletionPending = true;
        return {
          job: { ...pendingJob, statusToken },
          kind: "started",
        };
      },
      async validatePending() {
        return true;
      },
      async release(userId, expectedLeaseUntil) {
        if (pendingJob?.processingLeaseUntil === expectedLeaseUntil) {
          pendingJob.processing = false;
        }
        calls.push(`release:${userId}`);
      },
    },
    notifications: {
      async removeAllForUser(userId) {
        calls.push(`remove-notifications:${userId}`);
        if (failNotifications) throw new Error("database unavailable");
        return 1;
      },
    },
    now: () => currentNow,
    providers: {
      assertReady() {
        calls.push("provider-ready");
      },
      async deleteFirebaseUser(uid) {
        calls.push(`delete-firebase:${uid}`);
        if (firebaseDeletionFailures > 0) {
          firebaseDeletionFailures -= 1;
          throw new Error("Firebase unavailable");
        }
      },
      async prepareAuthorization(credential) {
        calls.push(`prepare-provider:${credential.firebaseUid}`);
        return credential;
      },
      async revokeAuthorization({ firebaseUid }) {
        calls.push(`revoke-provider:${firebaseUid}`);
        if (requireReauthentication) {
          throw new AccountDeletionReauthenticationRequiredError("google");
        }
        if (failAuthorization) throw new Error("provider unavailable");
      },
      async revokeFirebaseSessions(uid) {
        calls.push(`revoke-sessions:${uid}`);
      },
    },
    requestId: () => "req_delete",
    reportEscalation(...arguments_) {
      calls.push(`escalate-arguments:${arguments_.length}`);
    },
    users: {
      async deleteForAccount(job, uids) {
        const userId = job.userId;
        calls.push(`delete-user:${userId}:${uids.join(",")}`);
        if (deleteForAccountResult) deletionPending = false;
        return deleteForAccountResult;
      },
      async listSignInMethods() {
        calls.push("list-sign-in-methods");
        return [identity.provider];
      },
      async resolve(candidate) {
        return !userAbsent && candidate.uid === identity.uid
          ? { ...USER, ...(deletionPending ? { deletionPending: true } : {}) }
          : null;
      },
    },
    verifyCredentialToken: async (token) => {
      calls.push("verify-credential");
      return token === (identity.provider === "google"
        ? "fresh-google-token"
        : "fresh-apple-token")
        ? identity
        : null;
    },
    verifyIdToken: async () => identity,
  });
  return {
    api,
    calls,
    allowAuthorization() {
      failAuthorization = false;
      requireReauthentication = false;
    },
    allowNotifications() {
      failNotifications = false;
    },
    advanceTo(value) {
      currentNow = Date.parse(value);
    },
    failStatusRead() {
      failStatusRead = true;
    },
    failProviderAuthorization() {
      failAuthorization = true;
      requireReauthentication = false;
    },
    finalizeBeforeRecoveryStore() {
      finalizeOnRecovery = true;
    },
    rejectNextRecoveryReopen() {
      rejectRecoveryReopen = true;
    },
    setStatusLookup(value) {
      statusLookup = value;
    },
    pendingJob() {
      return pendingJob;
    },
  };
}

test("account deletion requires exact fresh proof for every linked method", async () => {
  const { api, calls } = createHarness();
  for (const body of [
    [],
    [googleProof({ credentialToken: "stale" })],
    [googleProof(), googleProof()],
  ]) {
    const response = await api.fetch(deletionRequest(body));
    assert.ok(response.status === 400 || response.status === 401);
  }
  assert.equal(calls.includes("start"), false);
});

test("account deletion rejects a provider set that changed during fresh proof", async () => {
  const { api, calls } = createHarness({ providerMismatch: true });
  const response = await api.fetch(deletionRequest([googleProof()]));

  assert.equal(response.status, 401);
  assert.equal(
    (await response.json()).error.code,
    "fresh_authentication_required",
  );
  assert.deepEqual(calls, [
    "job-ready",
    "provider-ready",
    "list-sign-in-methods",
    "verify-credential",
    "start",
  ]);
});

test("account deletion revokes access before atomically applying data policy and identity cleanup", async () => {
  const { api, calls } = createHarness();
  const response = await api.fetch(deletionRequest([googleProof()]));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await (await createOpenApiResponseValidator())(
    response,
    "/api/v1/me/deletion",
    "post",
  );
  assert.equal((await response.json()).data.status, "completed");
  assert.deepEqual(calls, [
    "job-ready",
    "provider-ready",
    "list-sign-in-methods",
    "verify-credential",
    "start",
    "claim:user_delete",
    "revoke-sessions:firebase_delete_google",
    "checkpoint:firebase-sessions:google",
    "checkpoint:provider-attempted:google",
    "prepare-provider:firebase_delete_google",
    "revoke-provider:firebase_delete_google",
    "checkpoint:provider:google",
    "list-groups",
    "remove-group:user_delete:grp_delete",
    "remove-detached:user_delete",
    "remove-notifications:user_delete",
    "delete-firebase:firebase_delete_google",
    "delete-user:user_delete:firebase_delete_google",
  ]);
});

test("an interrupted cleanup resumes without reusing one-time provider proof", async () => {
  const harness = createHarness({ failNotifications: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  const callsBeforeBlockedPost = harness.calls.length;
  const proofCallsBeforeBlockedPost = harness.calls.filter((call) =>
    call === "list-sign-in-methods" || call === "verify-credential" ||
    call === "start"
  ).length;
  const blocked = await harness.api.fetch(deletionRequest([googleProof()]));
  assert.equal(blocked.status, 410);
  assert.equal((await blocked.json()).error.code, "account_deletion_pending");
  assert.deepEqual(
    harness.calls.slice(callsBeforeBlockedPost),
    ["job-ready", "prepare-status:user_delete"],
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === "list-sign-in-methods" || call === "verify-credential" ||
      call === "start"
    ).length,
    proofCallsBeforeBlockedPost,
  );
  harness.allowNotifications();
  assert.deepEqual(await harness.api.retryPending(), {
    completed: 1,
    escalated: 0,
    pending: 0,
  });
  assert.equal(
    harness.calls.filter((call) =>
      call === "revoke-provider:firebase_delete_google"
    ).length,
    1,
  );
});

test("a one-sided deletion-pending User fails closed before provider proof work", async () => {
  const harness = createHarness({ deletionPending: true });
  const response = await harness.api.fetch(deletionRequest([googleProof()]));
  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).error.code,
    "account_deletion_unavailable",
  );
  assert.deepEqual(harness.calls, [
    "job-ready",
    "prepare-status:user_delete",
  ]);
});

test("concurrent deletion requests share one leased cleanup", async () => {
  const harness = createHarness();
  const responses = await Promise.all([
    harness.api.fetch(deletionRequest([googleProof()])),
    harness.api.fetch(deletionRequest([googleProof()])),
  ]);
  assert.deepEqual(
    responses.map(({ status }) => status).sort(),
    [200, 202],
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === "revoke-provider:firebase_delete_google"
    ).length,
    1,
  );
});

test("provider interruption stays pending, proof-bound PUT recovers its receipt, and retry completes", async () => {
  const harness = createHarness({ failAuthorization: true });
  const first = await harness.api.fetch(deletionRequest([googleProof()]));
  assert.equal(first.status, 202);
  assert.equal(first.headers.get("cache-control"), "no-store");
  await (await createOpenApiResponseValidator())(
    first,
    "/api/v1/me/deletion",
    "post",
  );
  assert.deepEqual(await first.json(), {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: PREPARED_STATUS_TOKEN,
    },
  });
  assert.equal(
    harness.calls.some((call) => call.startsWith("delete-user:")),
    false,
  );

  const missingProof = await harness.api.fetch(statusTokenRequest());
  assert.equal(missingProof.status, 401);
  await (await createOpenApiResponseValidator())(
    missingProof.clone(),
    "/api/v1/me/deletion",
    "put",
  );
  assert.equal(
    (await missingProof.json()).error.code,
    "fresh_authentication_required",
  );

  harness.allowAuthorization();
  const recovered = await harness.api.fetch(statusTokenRequest(googleProof()));
  assert.equal(recovered.status, 202);
  assert.deepEqual(await recovered.json(), {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
      statusToken: STATUS_TOKEN,
    },
  });
  assert.deepEqual(await harness.api.retryPending(), {
    completed: 1,
    escalated: 0,
    pending: 0,
  });
  assert.equal(harness.calls.filter((call) => call === "start").length, 1);
  assert.equal(
    harness.calls.filter(
      (call) => call === "delete-user:user_delete:firebase_delete_google",
    ).length,
    1,
  );
  assert.deepEqual(harness.pendingJob().credentials, [{
    firebaseUid: GOOGLE.uid,
    provider: "google",
    providerSubject: GOOGLE.providerSubject,
  }]);
});

test("lost-receipt sign-in reopens and revokes completed Firebase and provider checkpoints before finalization", async () => {
  const harness = createHarness({ failNotifications: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  assert.deepEqual(harness.pendingJob().completedSteps, [
    "firebase-sessions:google",
    "provider-attempted:google",
    "provider:google",
  ]);

  harness.allowNotifications();
  const recovered = await harness.api.fetch(statusTokenRequest(googleProof({
    revocation: {
      idToken: "fresh-google-provider-id-token",
      kind: "access_token",
      value: "second-google-access-token",
    },
  })));
  assert.equal(recovered.status, 202);
  assert.equal((await recovered.json()).data.status, "pending");
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-sessions:${GOOGLE.uid}`
    ).length,
    2,
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-provider:${GOOGLE.uid}`
    ).length,
    2,
  );
  assert.deepEqual(harness.pendingJob().completedSteps, [
    "firebase-sessions:google",
    "provider-attempted:google",
    "provider:google",
  ]);
  assert.deepEqual(harness.pendingJob().reauthenticationProviders, []);
});

test("a crash after recovery proof storage stays fail-closed and a fresh retry is idempotent", async () => {
  const harness = createHarness({ failNotifications: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.failProviderAuthorization();
  const interrupted = await harness.api.fetch(
    statusTokenRequest(googleProof()),
  );
  assert.equal(interrupted.status, 202);
  assert.deepEqual(harness.pendingJob().reauthenticationProviders, ["google"]);
  assert.equal(
    harness.pendingJob().completedSteps.includes("provider:google"),
    false,
  );

  harness.allowAuthorization();
  const retried = await harness.api.fetch(statusTokenRequest(googleProof()));
  assert.equal(retried.status, 202);
  assert.deepEqual(harness.pendingJob().reauthenticationProviders, []);
  assert.equal(
    harness.pendingJob().completedSteps.filter((step) =>
      step === "provider:google"
    ).length,
    1,
  );
});

test("recovery revokes the new grant and reports completion when finalization wins the race", async () => {
  const harness = createHarness({ failNotifications: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.finalizeBeforeRecoveryStore();
  const response = await harness.api.fetch(statusTokenRequest(googleProof()));
  assert.equal(response.status, 200);
  await (await createOpenApiResponseValidator())(
    response.clone(),
    "/api/v1/me/deletion",
    "put",
  );
  assert.equal((await response.json()).data.status, "completed");
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-sessions:${GOOGLE.uid}`
    ).length,
    2,
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-provider:${GOOGLE.uid}`
    ).length,
    2,
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === `delete-firebase:${GOOGLE.uid}`
    ).length,
    1,
  );
});

test("direct Google recovery deletes the recreated Firebase identity before provider work and retries the same proof", async () => {
  const harness = createHarness({ failNotifications: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.finalizeBeforeRecoveryStore();
  harness.failProviderAuthorization();

  const firstCall = harness.calls.length;
  const interrupted = await harness.api.fetch(statusTokenRequest(googleProof()));
  assert.equal(interrupted.status, 503);
  const interruptedCalls = harness.calls.slice(firstCall);
  assert.ok(
    interruptedCalls.indexOf(`delete-firebase:${GOOGLE.uid}`) <
      interruptedCalls.indexOf(`revoke-provider:${GOOGLE.uid}`),
  );

  harness.allowAuthorization();
  const retryCall = harness.calls.length;
  const completed = await harness.api.fetch(statusTokenRequest(googleProof()));
  assert.equal(completed.status, 200);
  const retryCalls = harness.calls.slice(retryCall);
  assert.ok(
    retryCalls.indexOf(`delete-firebase:${GOOGLE.uid}`) <
      retryCalls.indexOf(`revoke-provider:${GOOGLE.uid}`),
  );
});

test("direct native Apple recovery deletes the recreated Firebase identity before provider work", async () => {
  const harness = createHarness({
    failNotifications: true,
    identity: APPLE_WEB,
  });
  assert.equal(
    (await harness.api.fetch(deletionRequest([appleNativeProof()]))).status,
    202,
  );
  harness.finalizeBeforeRecoveryStore();
  harness.failProviderAuthorization();

  const firstCall = harness.calls.length;
  const interrupted = await harness.api.fetch(
    statusTokenRequest(appleNativeProof()),
  );
  assert.equal(interrupted.status, 503);
  const interruptedCalls = harness.calls.slice(firstCall);
  assert.ok(
    interruptedCalls.indexOf(`delete-firebase:${APPLE_WEB.uid}`) <
      interruptedCalls.indexOf(`revoke-provider:${APPLE_WEB.uid}`),
  );

  harness.allowAuthorization();
  const completed = await harness.api.fetch(
    statusTokenRequest(appleNativeProof()),
  );
  assert.equal(completed.status, 200);
});

test("direct web Apple recovery safely repeats revocation before retrying Firebase deletion", async () => {
  const harness = createHarness({
    failNotifications: true,
    firebaseDeletionFailures: 1,
    identity: APPLE_WEB,
  });
  assert.equal(
    (await harness.api.fetch(deletionRequest([appleWebProof()]))).status,
    202,
  );
  harness.finalizeBeforeRecoveryStore();

  const firstCall = harness.calls.length;
  const interrupted = await harness.api.fetch(
    statusTokenRequest(appleWebProof()),
  );
  assert.equal(interrupted.status, 503);
  const interruptedCalls = harness.calls.slice(firstCall);
  assert.ok(
    interruptedCalls.indexOf(`revoke-provider:${APPLE_WEB.uid}`) <
      interruptedCalls.indexOf(`delete-firebase:${APPLE_WEB.uid}`),
  );

  const retryCall = harness.calls.length;
  const completed = await harness.api.fetch(statusTokenRequest(appleWebProof()));
  assert.equal(completed.status, 200);
  const retryCalls = harness.calls.slice(retryCall);
  assert.ok(
    retryCalls.indexOf(`revoke-provider:${APPLE_WEB.uid}`) <
      retryCalls.indexOf(`delete-firebase:${APPLE_WEB.uid}`),
  );
});

test("an active recovery lease loser directly revokes its fresh proof before returning the durable pending receipt", async () => {
  const harness = createHarness({ failNotifications: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.allowAuthorization();
  harness.rejectNextRecoveryReopen();
  const response = await harness.api.fetch(statusTokenRequest(googleProof({
    revocation: {
      idToken: "fresh-google-provider-id-token",
      kind: "access_token",
      value: "lease-loser-access-token",
    },
  })));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).data.statusToken, STATUS_TOKEN);
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-sessions:${GOOGLE.uid}`
    ).length,
    2,
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-provider:${GOOGLE.uid}`
    ).length,
    2,
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === `delete-firebase:${GOOGLE.uid}`
    ).length,
    1,
  );
});

test("PATCH contention directly revokes accepted fresh proof instead of dropping it", async () => {
  const harness = createHarness({ requireReauthentication: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.allowAuthorization();
  harness.rejectNextRecoveryReopen();
  const response = await harness.api.fetch(refreshRequest(
    googleProof(),
    PREPARED_STATUS_TOKEN,
  ));
  assert.equal(response.status, 202);
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-sessions:${GOOGLE.uid}`
    ).length,
    2,
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-provider:${GOOGLE.uid}`
    ).length,
    2,
  );
});

test("pending deletion accepts only exact capability-bound fresh provider proof and resumes without access", async () => {
  const harness = createHarness({ requireReauthentication: true });
  const first = await harness.api.fetch(deletionRequest([googleProof()]));
  assert.equal(first.status, 202);
  assert.deepEqual((await first.json()).data.reauthenticationProviders, [
    "google",
  ]);
  assert.deepEqual(
    harness.calls.filter((call) => call.startsWith("revoke-sessions:")),
    [`revoke-sessions:${GOOGLE.uid}`],
  );

  const rejected = await harness.api.fetch(refreshRequest(
    googleProof({ credentialToken: "different-firebase-user" }),
    PREPARED_STATUS_TOKEN,
  ));
  assert.equal(rejected.status, 401);
  assert.equal(
    (await rejected.json()).error.code,
    "fresh_authentication_required",
  );

  harness.allowAuthorization();
  const completed = await harness.api.fetch(refreshRequest(
    googleProof(),
    PREPARED_STATUS_TOKEN,
  ));
  assert.equal(completed.status, 200);
  await (await createOpenApiResponseValidator())(
    completed,
    "/api/v1/me/deletion",
    "patch",
  );
  assert.equal((await completed.json()).data.status, "completed");
  assert.equal(
    harness.calls.filter((call) => call.startsWith("revoke-sessions:")).length,
    2,
  );
});

test("provider failure after fresh proof still revokes the replacement Firebase session", async () => {
  const harness = createHarness({ requireReauthentication: true });
  const first = await harness.api.fetch(deletionRequest([googleProof()]));
  assert.equal(first.status, 202);
  const beforeRefresh = harness.calls.length;
  harness.failProviderAuthorization();

  const pending = await harness.api.fetch(refreshRequest(
    googleProof(),
    PREPARED_STATUS_TOKEN,
  ));

  assert.equal(pending.status, 202);
  assert.deepEqual((await pending.json()).data.reauthenticationProviders, [
    "google",
  ]);
  assert.deepEqual(
    harness.calls.slice(beforeRefresh).filter((call) =>
      call.startsWith("revoke-sessions:") ||
      call.startsWith("prepare-provider:") ||
      call.startsWith("revoke-provider:")
    ),
    [
      `revoke-sessions:${GOOGLE.uid}`,
      `prepare-provider:${GOOGLE.uid}`,
      `revoke-provider:${GOOGLE.uid}`,
    ],
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === `revoke-sessions:${GOOGLE.uid}`
    ).length,
    2,
  );
});

test("operator retry requires the exact User and deletion request pair", async () => {
  const harness = createHarness({ failAuthorization: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.allowAuthorization();
  assert.deepEqual(await harness.api.retryPending({
    requestId: "del_test",
    userId: "user_other",
  }), { completed: 0, escalated: 0, pending: 0 });
  assert.deepEqual(await harness.api.retryPending({
    requestId: "del_other",
    userId: "user_delete",
  }), { completed: 0, escalated: 0, pending: 0 });
  assert.deepEqual(await harness.api.retryPending({
    requestId: "del_test",
    userId: "user_delete",
  }), { completed: 1, escalated: 0, pending: 0 });
});

test("missing provider cleanup configuration fails before access is removed", async () => {
  const api = createV1AccountDeletionApi({
    groups: {},
    jobs: {
      assertReady() {},
      async claim() {
        throw new Error("must not claim");
      },
      async listPending() {
        return [];
      },
      async markCompletedStep() {
        throw new Error("must not checkpoint");
      },
      async markEscalated() {
        return false;
      },
      async start() {
        throw new Error("must not start");
      },
      async release() {
        throw new Error("must not release");
      },
    },
    notifications: {},
    now: () => NOW,
    providers: {
      assertReady() {
        throw new Error("not configured");
      },
    },
    users: {
      async listSignInMethods() {
        return ["google"];
      },
      async resolve(identity) {
        return identity.uid === GOOGLE.uid ? USER : null;
      },
    },
    verifyCredentialToken: async () => GOOGLE,
    verifyIdToken: async () => GOOGLE,
  });
  const response = await api.fetch(deletionRequest([googleProof()]));
  assert.equal(response.status, 503);
  await (await createOpenApiResponseValidator())(
    response,
    "/api/v1/me/deletion",
    "post",
  );
  assert.equal((await response.json()).error.code, "account_deletion_unavailable");
});

test("automatic retry completes pending work before the deadline", async () => {
  const harness = createHarness({ failAuthorization: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.allowAuthorization();
  assert.deepEqual(await harness.api.retryPending(), {
    completed: 1,
    escalated: 0,
    pending: 0,
  });
});

test("the seven-day deadline escalates once without falsely completing", async () => {
  const harness = createHarness({ failAuthorization: true });
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  harness.advanceTo("2026-08-04T12:00:00.001Z");
  assert.deepEqual(await harness.api.retryPending(), {
    completed: 0,
    escalated: 1,
    pending: 1,
  });
  assert.deepEqual(await harness.api.retryPending(), {
    completed: 0,
    escalated: 0,
    pending: 1,
  });
  assert.equal(
    harness.calls.filter((call) => call === "escalate-arguments:0").length,
    1,
  );
  harness.allowAuthorization();
  assert.deepEqual(await harness.api.retryPending(), {
    completed: 0,
    escalated: 0,
    pending: 1,
  });
  assert.deepEqual(await harness.api.retryPending({
    requestId: "del_test",
    userId: "user_delete",
  }), {
    completed: 1,
    escalated: 0,
    pending: 0,
  });
});

test("authenticated PUT prepares a durable five-minute receipt and GET reports its freshness", async () => {
  const harness = createHarness();
  const minted = await harness.api.fetch(statusTokenRequest());
  assert.equal(minted.status, 200);
  assert.equal(minted.headers.get("cache-control"), "no-store");
  await (await createOpenApiResponseValidator())(
    minted,
    "/api/v1/me/deletion",
    "put",
  );
  assert.deepEqual(await minted.json(), {
    data: {
      status: "not_started",
      statusToken: PREPARED_STATUS_TOKEN,
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    },
  });
  assert.deepEqual(harness.calls, [
    "job-ready",
    "prepare-status:user_delete",
  ]);

  harness.setStatusLookup({
    kind: "not_started",
    submissionExpired: false,
    submissionExpiresAt: "2026-07-28T12:05:00.000Z",
  });
  const status = await harness.api.fetch(statusRequest(PREPARED_STATUS_TOKEN));
  assert.equal(status.status, 200);
  assert.equal(status.headers.get("cache-control"), "no-store");
  await (await createOpenApiResponseValidator())(
    status,
    "/api/v1/me/deletion",
    "get",
  );
  assert.deepEqual(await status.json(), {
    data: {
      status: "not_started",
      submissionExpired: false,
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    },
  });

  harness.setStatusLookup({
    kind: "not_started",
    submissionExpired: true,
    submissionExpiresAt: "2026-07-28T12:05:00.000Z",
  });
  const expired = await harness.api.fetch(
    statusRequest(PREPARED_STATUS_TOKEN),
  );
  assert.equal(expired.status, 200);
  assert.deepEqual(await expired.json(), {
    data: {
      status: "not_started",
      submissionExpired: true,
      submissionExpiresAt: "2026-07-28T12:05:00.000Z",
    },
  });
});

test("PUT distinguishes an absent optional recovery body from any malformed body", async () => {
  for (const body of ["{", JSON.stringify({ credential: {} })]) {
    const harness = createHarness();
    const response = await harness.api.fetch(new Request(
      "https://openjob.test/api/v1/me/deletion",
      {
        body,
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    ));
    assert.equal(response.status, 400);
    await (await createOpenApiResponseValidator())(
      response.clone(),
      "/api/v1/me/deletion",
      "put",
    );
    assert.equal((await response.json()).error.code, "invalid_request");
    assert.equal(harness.calls.includes("prepare-status:user_delete"), false);
  }

  const pending = createHarness({ failAuthorization: true });
  assert.equal(
    (await pending.api.fetch(deletionRequest([googleProof()]))).status,
    202,
  );
  const malformed = await pending.api.fetch(new Request(
    "https://openjob.test/api/v1/me/deletion",
    {
      body: JSON.stringify({ credential: {} }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    },
  ));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "invalid_request");
});

test("PUT rejects query parameters with its declared validation response", async () => {
  const harness = createHarness();
  const response = await harness.api.fetch(new Request(
    "https://openjob.test/api/v1/me/deletion?unexpected=true",
    { method: "PUT" },
  ));
  assert.equal(response.status, 400);
  await (await createOpenApiResponseValidator())(
    response,
    "/api/v1/me/deletion",
    "put",
  );
  assert.equal((await response.json()).error.code, "invalid_request");
  assert.equal(harness.calls.includes("prepare-status:user_delete"), false);
});

test("POST requires and echoes the exact prepared receipt", async () => {
  const prepared = createHarness({ failAuthorization: true });
  const response = await prepared.api.fetch(
    deletionRequest([googleProof()], PREPARED_STATUS_TOKEN),
  );
  assert.equal(response.status, 202);
  assert.equal((await response.json()).data.statusToken, PREPARED_STATUS_TOKEN);
  assert.equal(prepared.calls.includes("start"), true);

  const missing = createHarness({ failAuthorization: true });
  const missingResponse = await missing.api.fetch(
    deletionRequest([googleProof()], null),
  );
  assert.equal(missingResponse.status, 400);
  assert.equal((await missingResponse.json()).error.code, "invalid_request");
  assert.equal(missing.calls.includes("list-sign-in-methods"), false);
  assert.equal(missing.calls.includes("verify-credential"), false);
  assert.equal(missing.calls.includes("start"), false);
});

test("a present invalid or leaked prepared receipt cannot start deletion", async () => {
  for (const request of [
    deletionRequest([googleProof()], TAMPERED_STATUS_TOKEN),
    deletionRequest([googleProof()], "not-a-receipt"),
    deletionRequest(
      [googleProof()],
      undefined,
      `https://openjob.test/api/v1/me/deletion?statusToken=${STATUS_TOKEN}`,
    ),
  ]) {
    const harness = createHarness();
    const response = await harness.api.fetch(request);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  }
});

test("cleanup reports pending for an orphan job and completes only when both records are absent", async () => {
  const inconsistent = createHarness({ deleteForAccountResult: false });
  const pending = await inconsistent.api.fetch(
    deletionRequest([googleProof()]),
  );
  assert.equal(pending.status, 202);
  assert.equal((await pending.json()).data.status, "pending");
  assert.equal(
    inconsistent.calls.includes("is-finalized:user_delete"),
    true,
  );

  const idempotent = createHarness({
    deleteForAccountResult: false,
    finalized: true,
  });
  const completed = await idempotent.api.fetch(
    deletionRequest([googleProof()]),
  );
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).data.status, "completed");
});

test("an opaque bearer receipt reports pending without returning the capability", async () => {
  const harness = createHarness();
  const response = await harness.api.fetch(statusRequest(STATUS_TOKEN));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await (await createOpenApiResponseValidator())(
    response,
    "/api/v1/me/deletion",
    "get",
  );
  assert.deepEqual(await response.json(), {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      reauthenticationProviders: [],
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  });
});

test("a valid receipt reports completion without a server tombstone timestamp", async () => {
  const harness = createHarness();
  harness.setStatusLookup({ kind: "completed" });
  const response = await harness.api.fetch(statusRequest(STATUS_TOKEN));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await (await createOpenApiResponseValidator())(
    response,
    "/api/v1/me/deletion",
    "get",
  );
  assert.deepEqual(await response.json(), { data: { status: "completed" } });
});

test("missing, malformed, tampered, and URL capabilities share one generic denial", async () => {
  const harness = createHarness();
  const requests = [
    statusRequest(null),
    statusRequest("not.a.receipt"),
    statusRequest("v1.A.B"),
    statusRequest(`v1.${"A".repeat(8_190)}.B`),
    statusRequest(TAMPERED_STATUS_TOKEN),
    statusRequest(
      STATUS_TOKEN,
      `https://openjob.test/api/v1/me/deletion?statusToken=${STATUS_TOKEN}`,
    ),
  ];
  for (const request of requests) {
    const response = await harness.api.fetch(request);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: {
        code: "authentication_required",
        message: "Authentication is required.",
        requestId: "req_delete",
      },
    });
  }
  assert.equal(
    harness.calls.filter((call) => call === "read-status").length,
    1,
  );
});

test("ambiguous or failed status storage never reports completion", async () => {
  const unavailable = createHarness();
  unavailable.setStatusLookup({ kind: "unavailable" });
  const ambiguous = await unavailable.api.fetch(
    statusRequest(STATUS_TOKEN),
  );
  assert.equal(ambiguous.status, 503);
  assert.equal(ambiguous.headers.get("cache-control"), "no-store");
  assert.equal((await ambiguous.json()).error.code, "account_deletion_unavailable");

  const failed = createHarness();
  failed.failStatusRead();
  const storageFailure = await failed.api.fetch(
    statusRequest(STATUS_TOKEN),
  );
  assert.equal(storageFailure.status, 503);
  assert.equal(storageFailure.headers.get("cache-control"), "no-store");
  assert.equal(
    (await storageFailure.json()).error.code,
    "account_deletion_unavailable",
  );
});

test("status handler failures remain non-cacheable and disclose no capability", async () => {
  const handler = createV1AccountDeletionHandler(
    () => {
      throw new Error("runtime unavailable");
    },
    () => "req_status_runtime",
  );
  const response = await handler(statusRequest(STATUS_TOKEN));
  assert.equal(response.status, 500);
  assert.equal(response.headers.get("cache-control"), "no-store");
  await (await createOpenApiResponseValidator())(
    response,
    "/api/v1/me/deletion",
    "get",
  );
  const body = await response.text();
  assert.equal(body.includes(STATUS_TOKEN), false);
});
