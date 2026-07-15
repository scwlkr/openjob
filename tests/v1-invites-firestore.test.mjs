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

const INITIAL_NOW = "2026-07-15T12:00:00.000Z";
const TEN_DAYS = 10 * 24 * 60 * 60 * 1000;

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function inviteRoutesForGroup(firestore, groupId) {
  return [...firestore.documents.values()].filter(
    (document) =>
      document.name.includes("/documents/v1InviteRoutes/") &&
      document.fields?.groupId?.stringValue === groupId,
  );
}

async function createInviteHarness(names) {
  const authority = await createTestFirebaseAuthority({ now: INITIAL_NOW });
  const firestore = createFakeFirestore();
  const privateKey = await createPrivateKey();
  const userIds = Array.from({ length: names.length }, (_, index) => uuid(index + 1));
  const groupIds = Array.from({ length: 40 }, (_, index) => uuid(index + 501));
  const nowSeconds = Math.floor(Date.parse(INITIAL_NOW) / 1000);
  const tokens = new Map(
    await Promise.all(
      names.map(async (name) => [
        name,
        await authority.issue({
          claims: { exp: nowSeconds + TEN_DAYS / 1000 },
          uid: `firebase_${name}`,
        }),
      ]),
    ),
  );
  const config = {
    projectId: "openjob-dev",
    clientEmail: "worker@openjob-dev.iam.gserviceaccount.com",
    privateKey,
  };
  const harness = createV1TestHarness({
    initialNow: INITIAL_NOW,
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
        requestId: () => "req_invites_test",
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

  return {
    firestore,
    harness,
    async request(name, options) {
      const token = tokens.get(name);
      return harness.request({
        ...options,
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
    },
  };
}

async function claimUsername(request, name) {
  const response = await request(name, {
    body: { username: name },
    method: "PUT",
    path: "/api/v1/me/username",
  });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

async function createGroup(request, name = "Acme Operations") {
  const response = await request("shane", {
    body: { name },
    method: "POST",
    path: "/api/v1/groups",
  });
  assert.equal(response.status, 201);
  return (await response.json()).data;
}

test("Invite Links admit a confirmed User, rotate safely, and expose the current roster", async (t) => {
  const { firestore, harness, request } = await createInviteHarness([
    "shane",
    "eli",
    "newuser",
    "pending",
  ]);
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();
  const createdBeforeUsername = await request("newuser", {
    body: { name: "Onboarding Group" },
    method: "POST",
    path: "/api/v1/groups",
  });
  assert.equal(createdBeforeUsername.status, 201);
  const onboardingGroup = (await createdBeforeUsername.json()).data;
  const rosterBeforeUsername = await request("newuser", {
    method: "GET",
    path: `/api/v1/groups/${onboardingGroup.groupId}/members`,
  });
  assert.equal(rosterBeforeUsername.status, 200);
  await assertContract(
    rosterBeforeUsername,
    "/api/v1/groups/{groupId}/members",
    "get",
  );
  assert.equal((await rosterBeforeUsername.json()).data[0].username, null);
  await claimUsername(request, "newuser");
  const rosterAfterUsername = await request("newuser", {
    method: "GET",
    path: `/api/v1/groups/${onboardingGroup.groupId}/members`,
  });
  assert.equal((await rosterAfterUsername.json()).data[0].username, "newuser");
  const shane = await claimUsername(request, "shane");
  const eli = await claimUsername(request, "eli");
  const group = await createGroup(request);
  const invitePath = `/api/v1/groups/${group.groupId}/invite-link`;

  const retrieved = await request("shane", {
    method: "GET",
    path: invitePath,
  });
  assert.equal(retrieved.status, 200);
  await assertContract(
    retrieved,
    "/api/v1/groups/{groupId}/invite-link",
    "get",
  );
  const firstInvite = (await retrieved.json()).data;
  assert.equal(inviteRoutesForGroup(firestore, group.groupId).length, 1);
  assert.deepEqual(
    {
      issuedAt: firstInvite.issuedAt,
      expiresAt: firstInvite.expiresAt,
      remainingJoins: firstInvite.remainingJoins,
      url: firstInvite.url,
    },
    {
      issuedAt: INITIAL_NOW,
      expiresAt: "2026-07-22T12:00:00.000Z",
      remainingJoins: 25,
      url: `https://openjob.dev/invites/${firstInvite.token}`,
    },
  );

  const forbidden = await request("eli", { method: "GET", path: invitePath });
  assert.equal(forbidden.status, 404);
  await assertContract(
    forbidden,
    "/api/v1/groups/{groupId}/invite-link",
    "get",
  );

  const inspectPath = `/api/v1/invites/${firstInvite.token}`;
  const unauthenticated = await request(null, {
    method: "GET",
    path: inspectPath,
  });
  assert.equal(unauthenticated.status, 401);
  const inspected = await request("eli", { method: "GET", path: inspectPath });
  assert.equal(inspected.status, 200);
  await assertContract(inspected, "/api/v1/invites/{token}", "get");
  assert.deepEqual(await inspected.json(), {
    data: { groupName: "Acme Operations" },
  });

  const usernameRequired = await request("pending", {
    method: "POST",
    path: `${inspectPath}/actions/join`,
  });
  assert.equal(usernameRequired.status, 409);
  assert.equal((await usernameRequired.json()).error.code, "username_required");
  const newUserResponse = await request("newuser", {
    method: "GET",
    path: "/api/v1/me",
  });
  const newUser = (await newUserResponse.json()).data;
  const banDocument =
    `projects/openjob-dev/databases/(default)/documents/` +
    `v1Groups/${group.groupId}/bans/${newUser.userId}`;
  firestore.documents.set(banDocument, {
    name: banDocument,
    fields: {
      userId: { stringValue: newUser.userId },
      username: { stringValue: "newuser" },
      bannedAt: { timestampValue: INITIAL_NOW },
    },
    updateTime: "2026-07-15T12:00:00.999998Z",
  });
  const membershipDenied = await request("newuser", {
    method: "POST",
    path: `${inspectPath}/actions/join`,
  });
  assert.equal(membershipDenied.status, 403);
  await assertContract(
    membershipDenied,
    "/api/v1/invites/{token}/actions/join",
    "post",
  );
  assert.equal((await membershipDenied.json()).error.code, "membership_denied");

  const joinedResponses = await Promise.all(
    Array.from({ length: 5 }, () =>
      request("eli", {
        method: "POST",
        path: `${inspectPath}/actions/join`,
      }),
    ),
  );
  assert.equal(joinedResponses.every(({ status }) => status === 200), true);
  for (const joined of joinedResponses) {
    await assertContract(joined, "/api/v1/invites/{token}/actions/join", "post");
    assert.deepEqual((await joined.json()).data, { ...group, role: "member" });
  }
  const afterIdempotentJoin = await request("shane", {
    method: "GET",
    path: invitePath,
  });
  assert.equal((await afterIdempotentJoin.json()).data.remainingJoins, 24);
  const memberCannotRetrieveInvite = await request("eli", {
    method: "GET",
    path: invitePath,
  });
  assert.equal(memberCannotRetrieveInvite.status, 403);
  assert.equal(
    (await memberCannotRetrieveInvite.json()).error.code,
    "admin_required",
  );

  const rosterPath = `/api/v1/groups/${group.groupId}/members`;
  const firstRosterPage = await request("eli", {
    method: "GET",
    path: `${rosterPath}?limit=1`,
  });
  assert.equal(firstRosterPage.status, 200);
  await assertContract(
    firstRosterPage,
    "/api/v1/groups/{groupId}/members",
    "get",
  );
  const firstPage = await firstRosterPage.json();
  assert.equal(firstPage.data.length, 1);
  assert.equal(typeof firstPage.nextCursor, "string");
  const secondRosterPage = await request("eli", {
    method: "GET",
    path: `${rosterPath}?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
  });
  const members = [...firstPage.data, ...(await secondRosterPage.json()).data];
  assert.deepEqual(
    members.map(({ userId, username, role }) => ({ userId, username, role })),
    [
      { userId: shane.userId, username: "shane", role: "admin" },
      { userId: eli.userId, username: "eli", role: "member" },
    ],
  );

  const memberDocument = [...firestore.documents.keys()].find((path) =>
    path.endsWith(`/v1Groups/${group.groupId}/members/${eli.userId}`),
  );
  const accessDocument = [...firestore.documents.keys()].find((path) =>
    path.endsWith(`/v1GroupAccess/${eli.userId}/groups/${group.groupId}`),
  );
  assert.ok(memberDocument);
  assert.ok(accessDocument);
  firestore.documents.delete(memberDocument);
  firestore.documents.delete(accessDocument);

  const rejoined = await request("eli", {
    method: "POST",
    path: `${inspectPath}/actions/join`,
  });
  assert.equal(rejoined.status, 200);
  assert.equal((await rejoined.json()).data.role, "member");
  const afterRejoin = await request("shane", { method: "GET", path: invitePath });
  assert.equal((await afterRejoin.json()).data.remainingJoins, 23);

  const rotated = await request("shane", {
    method: "POST",
    path: `${invitePath}/actions/rotate`,
  });
  assert.equal(rotated.status, 200);
  await assertContract(
    rotated,
    "/api/v1/groups/{groupId}/invite-link/actions/rotate",
    "post",
  );
  const secondInvite = (await rotated.json()).data;
  assert.notEqual(secondInvite.token, firstInvite.token);
  assert.equal(secondInvite.remainingJoins, 25);
  assert.equal(inviteRoutesForGroup(firestore, group.groupId).length, 1);
  const inviteStatePath = [...firestore.documents.keys()].find((path) =>
    path.endsWith(`/v1Groups/${group.groupId}/invite/current`),
  );
  assert.ok(inviteStatePath);
  const stateUpdateTimeBeforeExpiry =
    firestore.documents.get(inviteStatePath).updateTime;

  const invalidRotated = await request("eli", {
    method: "GET",
    path: inspectPath,
  });
  const invalidUnknown = await request("eli", {
    method: "GET",
    path: "/api/v1/invites/ivt_unknown",
  });
  assert.equal(invalidRotated.status, 404);
  const invalidUnknownBody = await invalidUnknown.json();
  assert.deepEqual(await invalidRotated.json(), invalidUnknownBody);

  harness.advance(7 * 24 * 60 * 60 * 1000);
  const automaticallyRotated = await request("shane", {
    method: "GET",
    path: invitePath,
  });
  assert.equal(automaticallyRotated.status, 200);
  const thirdInvite = (await automaticallyRotated.json()).data;
  assert.notEqual(thirdInvite.token, secondInvite.token);
  assert.equal(thirdInvite.issuedAt, "2026-07-22T12:00:00.000Z");
  assert.equal(
    firestore.documents.get(inviteStatePath).updateTime,
    stateUpdateTimeBeforeExpiry,
  );
  assert.equal(inviteRoutesForGroup(firestore, group.groupId).length, 1);
  const invalidExpired = await request("eli", {
    method: "GET",
    path: `/api/v1/invites/${secondInvite.token}`,
  });
  assert.equal(invalidExpired.status, 404);
  assert.deepEqual(await invalidExpired.json(), invalidUnknownBody);

  const groupDocument = [...firestore.documents.keys()].find((path) =>
    path.endsWith(`/v1Groups/${group.groupId}`),
  );
  assert.ok(groupDocument);
  firestore.documents.delete(groupDocument);
  const invalidEndedGroup = await request("eli", {
    method: "GET",
    path: `/api/v1/invites/${thirdInvite.token}`,
  });
  assert.equal(invalidEndedGroup.status, 404);
  assert.deepEqual(await invalidEndedGroup.json(), invalidUnknownBody);
});

test("concurrent joins consume at most 25 uses without partial membership", async (t) => {
  const joiners = Array.from({ length: 26 }, (_, index) => `user${index + 1}`);
  const { harness, request } = await createInviteHarness(["shane", ...joiners]);
  t.after(() => harness.close());
  await claimUsername(request, "shane");
  await Promise.all(joiners.map((name) => claimUsername(request, name)));
  const group = await createGroup(request, "Concurrency Group");
  const invitePath = `/api/v1/groups/${group.groupId}/invite-link`;
  const inviteResponse = await request("shane", {
    method: "GET",
    path: invitePath,
  });
  const firstInvite = (await inviteResponse.json()).data;

  const joins = await Promise.all(
    joiners.map((name) =>
      request(name, {
        method: "POST",
        path: `/api/v1/invites/${firstInvite.token}/actions/join`,
      }),
    ),
  );
  assert.equal(joins.filter(({ status }) => status === 200).length, 25);
  assert.equal(joins.filter(({ status }) => status === 404).length, 1);

  const replacementResponse = await request("shane", {
    method: "GET",
    path: invitePath,
  });
  assert.equal(replacementResponse.status, 200);
  const replacement = (await replacementResponse.json()).data;
  assert.notEqual(replacement.token, firstInvite.token);
  assert.equal(replacement.remainingJoins, 25);

  const oldLink = await request("shane", {
    method: "GET",
    path: `/api/v1/invites/${firstInvite.token}`,
  });
  assert.equal(oldLink.status, 404);

  const roster = await request("shane", {
    method: "GET",
    path: `/api/v1/groups/${group.groupId}/members`,
  });
  assert.equal(roster.status, 200);
  assert.equal((await roster.json()).data.length, 26);
});
