import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createTestFirebaseAuthority } from "./support/firebase-id-tokens.mjs";
import {
  createFakeFirestore,
  createPrivateKey,
} from "./support/fake-firestore.mjs";
import { createOpenApiResponseValidator } from "./support/openapi-response.mjs";
import { createV1TestHarness } from "./support/v1-harness.mjs";

test("the black-box Group journey persists through the Firestore adapter", async (t) => {
  const now = "2026-07-15T12:00:00.000Z";
  const authority = await createTestFirebaseAuthority({ now });
  const firestore = createFakeFirestore();
  const privateKey = await createPrivateKey();
  const assertContract = await createOpenApiResponseValidator();
  const userIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const groupIds = [
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  ];
  const config = {
    projectId: "openjob-dev",
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey,
  };
  const harness = createV1TestHarness({
    initialNow: now,
    createWorker(controls) {
      const users = createFirestoreUserStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID: () => userIds.shift(),
      });
      const groups = createFirestoreGroupStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID: () => groupIds.shift(),
      });
      const verifyIdToken = createFirebaseIdTokenVerifier({
        fetchImplementation: authority.fetch,
        now: () => Date.parse(controls.clock.now()),
        projectId: "openjob-dev",
      });
      const identityApi = createV1IdentityApi({ groups, users, verifyIdToken });
      const groupsApi = createV1GroupsApi({ groups, users, verifyIdToken });
      return {
        fetch(request) {
          return new URL(request.url).pathname.startsWith("/api/v1/groups")
            ? groupsApi.fetch(request)
            : identityApi.fetch(request);
        },
      };
    },
  });
  t.after(() => harness.close());
  const shaneHeaders = {
    authorization: `Bearer ${await authority.issue({ uid: "firebase_shane" })}`,
  };
  const eliHeaders = {
    authorization: `Bearer ${await authority.issue({ uid: "firebase_eli" })}`,
  };

  for (const headers of [shaneHeaders, eliHeaders]) {
    const creation = await harness.request({
      body: { confirmation: "create" },
      headers,
      method: "POST",
      path: "/api/v1/me",
    });
    assert.equal(creation.status, 201);
  }

  const createdResponse = await harness.request({
    body: { name: "Acme Operations" },
    headers: shaneHeaders,
    method: "POST",
    path: "/api/v1/groups",
  });
  assert.equal(createdResponse.status, 201);
  await assertContract(createdResponse, "/api/v1/groups", "post");
  const created = (await createdResponse.json()).data;
  assert.deepEqual(created, {
    groupId: "grp_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",
    name: "Acme Operations",
    role: "admin",
    createdAt: now,
  });

  await harness.restart();
  const persisted = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: `/api/v1/groups/${created.groupId}`,
  });
  await assertContract(persisted, "/api/v1/groups/{groupId}", "get");
  assert.deepEqual(await persisted.json(), { data: created });

  const inaccessibleList = await harness.request({
    headers: eliHeaders,
    method: "GET",
    path: "/api/v1/groups",
  });
  await assertContract(inaccessibleList, "/api/v1/groups", "get");
  assert.deepEqual(await inaccessibleList.json(), {
    data: [],
    nextCursor: null,
  });
  const invalidCursor = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: "/api/v1/groups?cursor=not-issued-by-this-collection",
  });
  assert.equal(invalidCursor.status, 400);
  await assertContract(invalidCursor, "/api/v1/groups", "get");
  const invalidCursorError = (await invalidCursor.json()).error;
  assert.equal(invalidCursorError.code, "invalid_request");
  assert.deepEqual(Object.keys(invalidCursorError.fields), ["cursor"]);
  const inaccessibleRead = await harness.request({
    headers: eliHeaders,
    method: "GET",
    path: `/api/v1/groups/${created.groupId}`,
  });
  assert.equal(inaccessibleRead.status, 404);
  await assertContract(
    inaccessibleRead,
    "/api/v1/groups/{groupId}",
    "get",
  );

  const overlongId = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: `/api/v1/groups/grp_${"a".repeat(1_501)}`,
  });
  assert.equal(overlongId.status, 404);
  await assertContract(overlongId, "/api/v1/groups/{groupId}", "get");
  assert.equal((await overlongId.json()).error.code, "group_not_found");

  firestore.throttleNextRequest();
  const throttled = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: "/api/v1/groups",
  });
  assert.equal(throttled.status, 429);
  await assertContract(throttled, "/api/v1/groups", "get");
  assert.equal((await throttled.json()).error.code, "rate_limited");

  firestore.throttleNextRequest();
  const throttledCurrentUser = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: "/api/v1/me",
  });
  assert.equal(throttledCurrentUser.status, 429);
  await assertContract(throttledCurrentUser, "/api/v1/me", "get");
  assert.equal(
    (await throttledCurrentUser.json()).error.code,
    "rate_limited",
  );

  const renamedResponse = await harness.request({
    body: { name: "Acme Field Operations" },
    headers: shaneHeaders,
    method: "PATCH",
    path: `/api/v1/groups/${created.groupId}`,
  });
  assert.equal(renamedResponse.status, 200);
  await assertContract(
    renamedResponse,
    "/api/v1/groups/{groupId}",
    "patch",
  );
  const renamed = (await renamedResponse.json()).data;
  assert.deepEqual(renamed, { ...created, name: "Acme Field Operations" });

  await harness.restart();
  const currentUser = await harness.request({
    headers: shaneHeaders,
    method: "GET",
    path: "/api/v1/me",
  });
  assert.deepEqual((await currentUser.json()).data.groups, [renamed]);
});
