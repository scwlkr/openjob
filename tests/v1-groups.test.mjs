import assert from "node:assert/strict";
import test from "node:test";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createOpenApiResponseValidator } from "./support/openapi-response.mjs";
import { createV1TestHarness } from "./support/v1-harness.mjs";

function createMemoryGroupStore(controls, additionalMemberRole) {
  let nextGroup = 1;

  async function groupFor(userId, groupId) {
    const group = await controls.state.get(["groups", groupId]);
    const member = await controls.state.get([
      "groups",
      groupId,
      "members",
      userId,
    ]);
    return group && member ? { ...group, role: member.role } : null;
  }

  return Object.freeze({
    async create(user, name) {
      return controls.state.transaction(async (state) => {
        const { userId } = user;
        const groupId = `grp_${String(nextGroup).padStart(4, "0")}`;
        nextGroup += 1;
        const group = {
          groupId,
          name,
          createdAt: controls.clock.now(),
        };
        await state.put(["groups", groupId], group);
        await state.put(["groups", groupId, "members", userId], {
          role: "admin",
        });
        await state.put(["group-access", userId, groupId], true);
        if (additionalMemberRole) {
          await state.put(["groups", groupId, "members", "user_eli"], {
            role: additionalMemberRole,
          });
          await state.put(["group-access", "user_eli", groupId], true);
        }
        return { ...group, role: "admin" };
      });
    },

    async get(userId, groupId) {
      return groupFor(userId, groupId);
    },

    async list(userId, { cursor, limit }) {
      const records = await controls.state.list(["group-access", userId]);
      const start = cursor === null ? 0 : Number(cursor.slice("cur_".length));
      const page = records.slice(start, start + limit);
      const groups = await Promise.all(
        page.map(({ key }) =>
          groupFor(userId, decodeURIComponent(key.split("/").at(-1))),
        ),
      );
      const next = start + page.length;
      return {
        groups,
        nextCursor: next < records.length ? `cur_${next}` : null,
      };
    },

    async rename(userId, groupId, name) {
      return controls.state.transaction(async (state) => {
        const group = await state.get(["groups", groupId]);
        const member = await state.get([
          "groups",
          groupId,
          "members",
          userId,
        ]);
        if (!group || !member) return { kind: "not_found" };
        if (member.role !== "admin") return { kind: "forbidden" };
        const renamed = { ...group, name };
        await state.put(["groups", groupId], renamed);
        return { kind: "renamed", group: { ...renamed, role: "admin" } };
      });
    },
  });
}

function createGroupsHarness({ additionalMemberRole } = {}) {
  return createV1TestHarness({
    createWorker(controls) {
      const users = {
        async getOrCreate(firebaseUid) {
          return {
            userId: firebaseUid.replace("firebase_", "user_"),
            username: firebaseUid.replace("firebase_", ""),
          };
        },
        async claimUsername() {
          throw new Error("Username claims are outside this test seam.");
        },
      };
      const groups = createMemoryGroupStore(controls, additionalMemberRole);
      const verifyIdToken = async (request) => {
        const identity = controls.identities.authenticate(request);
        return identity ? { uid: identity.claims.sub } : null;
      };
      const identityApi = createV1IdentityApi({
        groups,
        users,
        verifyIdToken,
      });
      const groupsApi = createV1GroupsApi({
        groups,
        requestId: () => "req_groups_test",
        users,
        verifyIdToken,
      });
      return {
        fetch(request) {
          return new URL(request.url).pathname.startsWith("/api/v1/groups")
            ? groupsApi.fetch(request)
            : identityApi.fetch(request);
        },
      };
    },
  });
}

test("an authenticated User creates, discovers, reads, and renames a private Group", async (t) => {
  const harness = createGroupsHarness();
  t.after(() => harness.close());

  const createdResponse = await harness.request({
    as: "shane",
    body: { name: "  Acme Operations  " },
    method: "POST",
    path: "/api/v1/groups",
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).data;
  assert.deepEqual(created, {
    groupId: "grp_0001",
    name: "Acme Operations",
    role: "admin",
    createdAt: "2026-07-15T12:00:00.000Z",
  });

  const listed = await harness.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/groups",
  });
  assert.deepEqual(await listed.json(), { data: [created], nextCursor: null });

  const read = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups/${created.groupId}`,
  });
  assert.deepEqual(await read.json(), { data: created });

  const renamedResponse = await harness.request({
    as: "shane",
    body: { name: "Acme Field Operations" },
    method: "PATCH",
    path: `/api/v1/groups/${created.groupId}`,
  });
  assert.equal(renamedResponse.status, 200);
  const renamed = (await renamedResponse.json()).data;
  assert.deepEqual(renamed, {
    ...created,
    name: "Acme Field Operations",
  });

  await harness.restart();
  const currentUser = await harness.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/me",
  });
  assert.deepEqual((await currentUser.json()).data.groups, [renamed]);
});

test("Group collection pagination follows limit and opaque continuation cursors", async (t) => {
  const harness = createGroupsHarness();
  t.after(() => harness.close());

  for (const name of ["Alpha", "Bravo", "Charlie"]) {
    const response = await harness.request({
      as: "shane",
      body: { name },
      method: "POST",
      path: "/api/v1/groups",
    });
    assert.equal(response.status, 201);
  }

  const firstResponse = await harness.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/groups?limit=2",
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.deepEqual(
    first.data.map(({ groupId }) => groupId),
    ["grp_0001", "grp_0002"],
  );
  assert.equal(typeof first.nextCursor, "string");

  const secondResponse = await harness.request({
    as: "shane",
    method: "GET",
    path: `/api/v1/groups?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
  });
  assert.deepEqual(await secondResponse.json(), {
    data: [
      {
        groupId: "grp_0003",
        name: "Charlie",
        role: "admin",
        createdAt: "2026-07-15T12:00:00.000Z",
      },
    ],
    nextCursor: null,
  });
});

test("Group collection rejects invalid pagination fields", async (t) => {
  const harness = createGroupsHarness();
  t.after(() => harness.close());

  for (const [query, field] of [
    ["limit=0", "limit"],
    ["limit=501", "limit"],
    ["limit=1.5", "limit"],
    ["limit=abc", "limit"],
    ["limit=1&limit=2", "limit"],
    ["cursor=", "cursor"],
    ["cursor=cur_1&cursor=cur_2", "cursor"],
  ]) {
    const response = await harness.request({
      as: "shane",
      method: "GET",
      path: `/api/v1/groups?${query}`,
    });
    assert.equal(response.status, 400, query);
    const error = (await response.json()).error;
    assert.equal(error.code, "invalid_request", query);
    assert.deepEqual(Object.keys(error.fields), [field], query);
  }
});

test("Group privacy is resolved before Admin rename validation", async (t) => {
  const visibleHarness = createGroupsHarness({
    additionalMemberRole: "member",
  });
  const concealedHarness = createGroupsHarness();
  t.after(async () =>
    Promise.all([visibleHarness.close(), concealedHarness.close()]),
  );

  const createdResponse = await visibleHarness.request({
    as: "shane",
    body: { name: "Private Operations" },
    method: "POST",
    path: "/api/v1/groups",
  });
  const groupId = (await createdResponse.json()).data.groupId;

  const memberRead = await visibleHarness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${groupId}`,
  });
  assert.equal(memberRead.status, 200);
  assert.equal((await memberRead.json()).data.role, "member");

  const memberRename = await visibleHarness.request({
    as: "eli",
    body: {},
    method: "PATCH",
    path: `/api/v1/groups/${groupId}`,
  });
  assert.equal(memberRename.status, 403);
  assert.equal((await memberRename.json()).error.code, "admin_required");

  const inaccessible = await concealedHarness.request({
    as: "eli",
    body: {},
    method: "PATCH",
    path: `/api/v1/groups/${groupId}`,
  });
  const unknown = await concealedHarness.request({
    as: "eli",
    body: {},
    method: "PATCH",
    path: "/api/v1/groups/grp_unknown",
  });
  assert.equal(inaccessible.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await inaccessible.json(), await unknown.json());

  const unauthenticated = await visibleHarness.request({
    method: "GET",
    path: `/api/v1/groups/${groupId}`,
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(
    (await unauthenticated.json()).error.code,
    "authentication_required",
  );
});

test("malformed and path-shaped Group IDs remain concealed", async (t) => {
  const harness = createGroupsHarness();
  t.after(() => harness.close());

  let expected;
  for (const groupId of [
    "grp_unknown",
    "%ZZ",
    "%E0%A4%A",
    "grp_safe%2Fmembers",
    "grp_safe%3Fcursor",
    "grp_safe%23fragment",
  ]) {
    const response = await harness.request({
      as: "shane",
      method: "GET",
      path: `/api/v1/groups/${groupId}`,
    });
    assert.equal(response.status, 404, groupId);
    const body = await response.json();
    assert.equal(body.error.code, "group_not_found", groupId);
    expected ??= body;
    assert.deepEqual(body, expected, groupId);
  }
});

test("GET /me follows every Group page", async (t) => {
  const harness = createGroupsHarness();
  t.after(() => harness.close());

  const responses = await Promise.all(
    Array.from({ length: 501 }, (_, index) =>
      harness.request({
        as: "shane",
        body: { name: `Group ${index + 1}` },
        method: "POST",
        path: "/api/v1/groups",
      }),
    ),
  );
  assert.equal(responses.every(({ status }) => status === 201), true);

  const currentUser = await harness.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/me",
  });
  assert.equal(currentUser.status, 200);
  const groups = (await currentUser.json()).data.groups;
  assert.equal(groups.length, 501);
  assert.equal(new Set(groups.map(({ groupId }) => groupId)).size, 501);
});

test("Group Names are trimmed, bounded Unicode labels and remain non-unique", async (t) => {
  const harness = createGroupsHarness();
  t.after(() => harness.close());

  for (const body of [
    undefined,
    {},
    { name: null },
    { name: "" },
    { name: "   " },
    { name: "a".repeat(81) },
    { name: "Line\nBreak" },
    { name: "Control\u0000Character" },
    { name: "Line\u2028Separator" },
    { name: "Valid", ignored: true },
  ]) {
    const response = await harness.request({
      as: "shane",
      body,
      method: "POST",
      path: "/api/v1/groups",
    });
    assert.equal(response.status, 400, JSON.stringify(body));
    const error = (await response.json()).error;
    assert.equal(error.code, "invalid_request");
    assert.deepEqual(Object.keys(error.fields), ["name"]);
  }

  const unicodeName = "🧭".repeat(80);
  const firstResponse = await harness.request({
    as: "shane",
    body: { name: `  ${unicodeName}  ` },
    method: "POST",
    path: "/api/v1/groups",
  });
  assert.equal(firstResponse.status, 201);
  const first = (await firstResponse.json()).data;
  assert.equal(first.name, unicodeName);

  const duplicateResponse = await harness.request({
    as: "shane",
    body: { name: unicodeName },
    method: "POST",
    path: "/api/v1/groups",
  });
  assert.equal(duplicateResponse.status, 201);
  const duplicate = (await duplicateResponse.json()).data;
  assert.equal(duplicate.name, unicodeName);
  assert.notEqual(duplicate.groupId, first.groupId);
});

test("representative Group responses validate against OpenAPI", async (t) => {
  const harness = createGroupsHarness({ additionalMemberRole: "member" });
  t.after(() => harness.close());
  const assertContract = await createOpenApiResponseValidator();

  const created = await harness.request({
    as: "shane",
    body: { name: "Contract Group" },
    method: "POST",
    path: "/api/v1/groups",
  });
  await assertContract(created, "/api/v1/groups", "post");
  const groupId = (await created.json()).data.groupId;

  const listed = await harness.request({
    as: "shane",
    method: "GET",
    path: "/api/v1/groups?limit=1",
  });
  await assertContract(listed, "/api/v1/groups", "get");

  const read = await harness.request({
    as: "eli",
    method: "GET",
    path: `/api/v1/groups/${groupId}`,
  });
  await assertContract(read, "/api/v1/groups/{groupId}", "get");

  const renamed = await harness.request({
    as: "shane",
    body: { name: "Renamed Contract Group" },
    method: "PATCH",
    path: `/api/v1/groups/${groupId}`,
  });
  await assertContract(renamed, "/api/v1/groups/{groupId}", "patch");

  const invalid = await harness.request({
    as: "shane",
    body: { name: "" },
    method: "POST",
    path: "/api/v1/groups",
  });
  await assertContract(invalid, "/api/v1/groups", "post");

  const unauthenticated = await harness.request({
    method: "GET",
    path: "/api/v1/groups",
  });
  await assertContract(unauthenticated, "/api/v1/groups", "get");

  const forbidden = await harness.request({
    as: "eli",
    body: { name: "Members Cannot Rename" },
    method: "PATCH",
    path: `/api/v1/groups/${groupId}`,
  });
  await assertContract(forbidden, "/api/v1/groups/{groupId}", "patch");

  const concealed = await harness.request({
    as: "eli",
    method: "GET",
    path: "/api/v1/groups/grp_unknown",
  });
  await assertContract(concealed, "/api/v1/groups/{groupId}", "get");
});
