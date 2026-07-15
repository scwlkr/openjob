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

const NOW = "2026-07-15T12:00:00.000Z";

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createGovernanceHarness(names) {
  const authority = await createTestFirebaseAuthority({ now: NOW });
  const firestore = createFakeFirestore();
  const privateKey = await createPrivateKey();
  const userIds = names.map((_, index) => uuid(index + 1));
  const groupIds = Array.from({ length: 30 }, (_, index) => uuid(index + 501));
  const tokens = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        await authority.issue({ uid: `firebase_${name}` }),
      ]),
    ),
  );
  const config = {
    projectId: "openjob-dev",
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey,
  };
  const harness = createV1TestHarness({
    initialNow: NOW,
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
      const groupsApi = createV1GroupsApi({
        groups,
        requestId: () => "req_governance_test",
        users,
        verifyIdToken,
      });
      return {
        fetch(request) {
          const pathname = new URL(request.url).pathname;
          return pathname.startsWith("/api/v1/groups") ||
            pathname.startsWith("/api/v1/invites")
            ? groupsApi.fetch(request)
            : identityApi.fetch(request);
        },
      };
    },
  });

  async function request(name, options) {
    const token = tokens.get(name);
    return harness.request({
      ...options,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
  }

  async function claim(name) {
    const response = await request(name, {
      body: { username: name },
      method: "PUT",
      path: "/api/v1/me/username",
    });
    assert.equal(response.status, 200);
    return (await response.json()).data;
  }

  async function createGroup(name = "Governance Team") {
    const response = await request("shane", {
      body: { name },
      method: "POST",
      path: "/api/v1/groups",
    });
    assert.equal(response.status, 201);
    return (await response.json()).data;
  }

  async function join(name, groupId) {
    const inviteResponse = await request("shane", {
      method: "GET",
      path: `/api/v1/groups/${groupId}/invite-link`,
    });
    assert.equal(inviteResponse.status, 200);
    const invite = (await inviteResponse.json()).data;
    const response = await request(name, {
      method: "POST",
      path: `/api/v1/invites/${invite.token}/actions/join`,
    });
    assert.equal(response.status, 200);
  }

  return { claim, createGroup, firestore, harness, join, request };
}

test("an Admin promotes only a current Member through the stable API contract", async (t) => {
  const { claim, createGroup, harness, join, request } =
    await createGovernanceHarness(["shane", "eli", "maya"]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const shane = await claim("shane");
  const eli = await claim("eli");
  const maya = await claim("maya");
  const group = await createGroup();
  await join("eli", group.groupId);
  const promotePath = (userId) =>
    `/api/v1/groups/${group.groupId}/members/${userId}/actions/promote`;

  const memberAttempt = await request("eli", {
    method: "POST",
    path: promotePath(eli.userId),
  });
  assert.equal(memberAttempt.status, 403);
  await assertContract(
    memberAttempt,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.equal((await memberAttempt.json()).error.code, "admin_required");

  const promoted = await request("shane", {
    method: "POST",
    path: promotePath(eli.userId),
  });
  assert.equal(promoted.status, 200);
  await assertContract(
    promoted,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.deepEqual((await promoted.json()).data, {
    userId: eli.userId,
    username: "eli",
    role: "admin",
    joinedAt: NOW,
  });

  const repeated = await request("eli", {
    method: "POST",
    path: promotePath(shane.userId),
  });
  assert.equal(repeated.status, 409);
  await assertContract(
    repeated,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.equal((await repeated.json()).error.code, "member_role_conflict");

  const outsideMember = await request("shane", {
    method: "POST",
    path: promotePath(maya.userId),
  });
  assert.equal(outsideMember.status, 404);
  await assertContract(
    outsideMember,
    "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    "post",
  );
  assert.equal((await outsideMember.json()).error.code, "member_not_found");
});
