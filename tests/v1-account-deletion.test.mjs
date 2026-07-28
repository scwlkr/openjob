import assert from "node:assert/strict";
import test from "node:test";
import { createV1AccountDeletionApi } from "../server/v1-account-deletion.ts";
import { createOpenApiResponseValidator } from "./support/openapi-response.mjs";

const NOW = Date.parse("2026-07-28T12:00:00.000Z");
const USER = { userId: "user_delete", username: "delete-me" };
const GOOGLE = {
  authenticatedAt: NOW - 30_000,
  provider: "google",
  uid: "firebase_delete_google",
};

function deletionRequest(credentials) {
  return new Request("https://openjob.test/api/v1/me/deletion", {
    body: JSON.stringify({ confirmation: "delete", credentials }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function googleProof(overrides = {}) {
  return {
    credentialToken: "fresh-google-token",
    provider: "google",
    revocation: { kind: "access_token", value: "google-access-token" },
    ...overrides,
  };
}

function createHarness({
  failAuthorization = false,
  failNotifications = false,
} = {}) {
  const calls = [];
  let pendingJob = null;
  let currentNow = NOW;
  const api = createV1AccountDeletionApi({
    groups: {
      async list() {
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
      async claim(userId) {
        if (!pendingJob || pendingJob.processing) return false;
        pendingJob.processing = true;
        calls.push(`claim:${userId}`);
        return true;
      },
      async listPending() {
        return pendingJob ? [pendingJob] : [];
      },
      async markCompletedStep(_userId, step) {
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
      async start(userId, credentials) {
        calls.push("start");
        pendingJob ??= {
          credentials,
          completedSteps: [],
          deadline: "2026-08-04T12:00:00.000Z",
          requestId: "del_test",
          startedAt: "2026-07-28T12:00:00.000Z",
          userId,
        };
        return pendingJob;
      },
      async release(userId) {
        if (pendingJob) pendingJob.processing = false;
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
      },
      async revokeAuthorization({ firebaseUid }) {
        calls.push(`revoke-provider:${firebaseUid}`);
        if (failAuthorization) throw new Error("provider unavailable");
      },
      async revokeFirebaseSessions(uid) {
        calls.push(`revoke-sessions:${uid}`);
      },
    },
    requestId: () => "req_delete",
    reportEscalation(requestId) {
      calls.push(`escalate:${requestId}`);
    },
    users: {
      async deleteForAccount(userId, uids) {
        calls.push(`delete-user:${userId}:${uids.join(",")}`);
        return true;
      },
      async listSignInMethods() {
        return ["google"];
      },
      async resolve(identity) {
        return identity.uid === GOOGLE.uid ? USER : null;
      },
    },
    verifyCredentialToken: async (token) =>
      token === "fresh-google-token" ? GOOGLE : null,
    verifyIdToken: async () => GOOGLE,
  });
  return {
    api,
    calls,
    allowAuthorization() {
      failAuthorization = false;
    },
    allowNotifications() {
      failNotifications = false;
    },
    advanceTo(value) {
      currentNow = Date.parse(value);
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

test("account deletion revokes access before atomically applying data policy and identity cleanup", async () => {
  const { api, calls } = createHarness();
  const response = await api.fetch(deletionRequest([googleProof()]));
  assert.equal(response.status, 200);
  await (await createOpenApiResponseValidator())(
    response,
    "/api/v1/me/deletion",
    "post",
  );
  assert.equal((await response.json()).data.status, "completed");
  assert.deepEqual(calls, [
    "job-ready",
    "provider-ready",
    "start",
    "claim:user_delete",
    "revoke-sessions:firebase_delete_google",
    "revoke-provider:firebase_delete_google",
    "checkpoint:provider:google:firebase_delete_google",
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
  harness.allowNotifications();
  assert.equal(
    (await harness.api.fetch(deletionRequest([googleProof()]))).status,
    200,
  );
  assert.equal(
    harness.calls.filter((call) =>
      call === "revoke-provider:firebase_delete_google"
    ).length,
    1,
  );
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

test("provider interruption stays pending and an idempotent retry completes the same job", async () => {
  const harness = createHarness({ failAuthorization: true });
  const first = await harness.api.fetch(deletionRequest([googleProof()]));
  assert.equal(first.status, 202);
  await (await createOpenApiResponseValidator())(
    first,
    "/api/v1/me/deletion",
    "post",
  );
  assert.deepEqual(await first.json(), {
    data: {
      deadline: "2026-08-04T12:00:00.000Z",
      requestedAt: "2026-07-28T12:00:00.000Z",
      status: "pending",
    },
  });
  assert.equal(
    harness.calls.some((call) => call.startsWith("delete-user:")),
    false,
  );

  harness.allowAuthorization();
  const retry = await harness.api.fetch(deletionRequest([googleProof()]));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).data.status, "completed");
  assert.equal(harness.calls.filter((call) => call === "start").length, 2);
  assert.equal(
    harness.calls.filter(
      (call) => call === "delete-user:user_delete:firebase_delete_google",
    ).length,
    1,
  );
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
    harness.calls.filter((call) => call === "escalate:del_test").length,
    1,
  );
});
