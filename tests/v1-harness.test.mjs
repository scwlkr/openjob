import assert from "node:assert/strict";
import test from "node:test";
import {
  LegacyTaskCollectionAccessError,
  createV1TestHarness,
} from "./support/v1-harness.mjs";

function createProbeWorker() {
  return {
    async fetch(request, controls) {
      const url = new URL(request.url);
      const identity = controls.identities.authenticate(request);

      if (url.pathname === "/api/v1/__harness/records" && request.method === "POST") {
        const input = await request.json();
        const record = {
          id: input.id,
          value: input.value,
          createdAt: controls.clock.now(),
          createdBy: identity.userId,
        };
        await controls.state.put(["groups", "test-group", "tasks", input.id], record);
        return Response.json({ data: record }, { status: 201 });
      }

      if (url.pathname === "/api/v1/__harness/records" && request.method === "GET") {
        const records = await controls.state.list([
          "groups",
          "test-group",
          "tasks",
        ]);
        return Response.json({ data: records.map(({ value }) => value) });
      }

      if (url.pathname === "/api/v1/__harness/identity") {
        return Response.json({
          data: {
            userId: identity.userId,
            firebaseUid: identity.claims.sub,
            provider: identity.claims.firebase.sign_in_provider,
          },
        });
      }

      if (url.pathname === "/api/v1/__harness/mutate-identity") {
        identity.claims.sub = "mutated-by-worker";
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/api/v1/__harness/counter" && request.method === "POST") {
        const value = await controls.state.transaction(async (transaction) => {
          const path = ["groups", "test-group", "counters", "requests"];
          const current = (await transaction.get(path)) ?? 0;
          await Promise.resolve();
          await transaction.put(path, current + 1);
          return current + 1;
        });
        return Response.json({ data: { value } });
      }

      if (url.pathname === "/api/v1/__harness/legacy-read") {
        await controls.state.get(["tasks", "legacy-task"]);
      }
      if (url.pathname === "/api/v1/__harness/legacy-write") {
        await controls.state.put(["tasks", "legacy-task"], { forbidden: true });
      }

      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    },
  };
}

test("the harness observes isolated persistence through Worker HTTP requests", async (t) => {
  const first = createV1TestHarness({ createWorker: createProbeWorker });
  const second = createV1TestHarness({ createWorker: createProbeWorker });
  t.after(async () => Promise.all([first.close(), second.close()]));

  const created = await first.request({
    as: "shane",
    method: "POST",
    path: "/api/v1/__harness/records",
    body: { id: "task-1", value: "Ship the contract" },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), {
    data: {
      id: "task-1",
      value: "Ship the contract",
      createdAt: "2026-07-15T12:00:00.000Z",
      createdBy: "user_shane",
    },
  });

  await first.restart();
  const persisted = await first.request({
    as: "eli",
    method: "GET",
    path: "/api/v1/__harness/records",
  });
  assert.deepEqual((await persisted.json()).data.map(({ id }) => id), ["task-1"]);

  const isolated = await second.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/__harness/records",
  });
  assert.deepEqual(await isolated.json(), { data: [] });
  assert.equal(Object.hasOwn(first, "state"), false);
});

test("the harness controls two Firebase-shaped identities and time", async (t) => {
  const harness = createV1TestHarness({ createWorker: createProbeWorker });
  t.after(() => harness.close());

  for (const [as, expected] of [
    ["shane", { userId: "user_shane", firebaseUid: "firebase_shane" }],
    ["eli", { userId: "user_eli", firebaseUid: "firebase_eli" }],
  ]) {
    const response = await harness.request({
      as,
      method: "GET",
      path: "/api/v1/__harness/identity",
    });
    assert.deepEqual(await response.json(), {
      data: { ...expected, provider: "google.com" },
    });
  }

  await harness.request({
    as: "shane",
    method: "POST",
    path: "/api/v1/__harness/mutate-identity",
  });
  const unchangedIdentity = await harness.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/__harness/identity",
  });
  assert.equal((await unchangedIdentity.json()).data.firebaseUid, "firebase_shane");

  harness.setNow("2026-07-20T08:30:00.000Z");
  harness.advance(90_000);
  const response = await harness.request({
    as: "eli",
    method: "POST",
    path: "/api/v1/__harness/records",
    body: { id: "task-2", value: "Controlled time" },
  });
  assert.equal((await response.json()).data.createdAt, "2026-07-20T08:31:30.000Z");
});

test("the harness exposes a second provider credential without putting it in a URL", async (t) => {
  const harness = createV1TestHarness({
    createWorker: createProbeWorker,
    identities: {
      google: {
        userId: "user_google",
        claims: {
          aud: "openjob-dev",
          auth_time: 1_784_116_800,
          exp: 1_784_120_400,
          firebase: { sign_in_provider: "google.com" },
          iat: 1_784_116_800,
          iss: "https://securetoken.google.com/openjob-dev",
          sub: "firebase_google",
          user_id: "firebase_google",
        },
      },
      apple: {
        userId: "user_apple",
        claims: {
          aud: "openjob-dev",
          auth_time: 1_784_116_800,
          exp: 1_784_120_400,
          firebase: { sign_in_provider: "apple.com" },
          iat: 1_784_116_800,
          iss: "https://securetoken.google.com/openjob-dev",
          sub: "firebase_apple",
          user_id: "firebase_apple",
        },
      },
    },
  });
  t.after(() => harness.close());

  assert.equal(harness.credentialTokenFor("apple"), "openjob-test-token:apple");
  const response = await harness.request({
    as: "apple",
    method: "GET",
    path: "/api/v1/__harness/identity",
  });
  assert.equal((await response.json()).data.provider, "apple.com");
});

test("the harness serializes state transitions used by concurrency tests", async (t) => {
  const harness = createV1TestHarness({ createWorker: createProbeWorker });
  t.after(() => harness.close());

  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      harness.request({
        as: "shane",
        method: "POST",
        path: "/api/v1/__harness/counter",
      }),
    ),
  );
  const values = await Promise.all(
    responses.map(async (response) => (await response.json()).data.value),
  );
  assert.deepEqual(values.sort((left, right) => left - right), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("the harness rejects legacy top-level Task collection reads and writes", async (t) => {
  const harness = createV1TestHarness({ createWorker: createProbeWorker });
  t.after(() => harness.close());

  for (const path of [
    "/api/v1/__harness/legacy-read",
    "/api/v1/__harness/legacy-write",
  ]) {
    await assert.rejects(
      harness.request({ as: "shane", method: "GET", path }),
      (error) =>
        error instanceof LegacyTaskCollectionAccessError &&
        error.code === "LEGACY_TASK_COLLECTION_ACCESS",
    );
  }

  await assert.rejects(
    harness.request({ as: "shane", method: "GET", path: "/api/v10/groups" }),
    /must target \/api\/v1/,
  );
});
