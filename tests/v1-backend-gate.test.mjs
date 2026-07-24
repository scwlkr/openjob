import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreNotificationSubscriptionStore } from "../db/notification-subscriptions.ts";
import { createFirestoreTaskStore } from "../db/v1-tasks.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { runV1AcceptanceScenario } from "../scripts/v1-acceptance-scenario.mjs";
import { validateOpenApiContract } from "../scripts/validate-openapi.mjs";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createV1NotificationSubscriptionsApi } from "../server/v1-notification-subscriptions.ts";
import { createV1TasksApi } from "../server/v1-tasks.ts";
import { createTestFirebaseAuthority } from "./support/firebase-id-tokens.mjs";
import {
  createFakeFirestore,
  createPrivateKey,
} from "./support/fake-firestore.mjs";
import { createOpenApiResponseValidator } from "./support/openapi-response.mjs";
import { createV1TestHarness } from "./support/v1-harness.mjs";

const NOW = "2026-07-16T12:00:00.000Z";
const HTTP_METHODS = new Set(["delete", "get", "patch", "post", "put"]);

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function operationKeys(contract) {
  return Object.entries(contract.paths).flatMap(([path, pathItem]) =>
    Object.keys(pathItem)
      .filter((method) => HTTP_METHODS.has(method))
      .map((method) => `${method} ${path}`),
  );
}

function formatLogArguments(arguments_) {
  return arguments_
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

test("the complete hosted backend preserves existing Groups during its two-identity gate", async (t) => {
  const authority = await createTestFirebaseAuthority({ now: NOW });
  const firestore = createFakeFirestore();
  const privateKey = await createPrivateKey();
  const database = "projects/openjob-dev/databases/(default)/documents";
  const legacyTaskName = `${database}/tasks/legacy_release_sentinel`;
  const legacyTask = {
    name: legacyTaskName,
    fields: {
      description: { stringValue: "Preserve the legacy public board" },
    },
    updateTime: "2026-07-14T12:00:00.000000Z",
  };
  firestore.documents.set(legacyTaskName, structuredClone(legacyTask));

  const identities = ["initialAdmin", "memberUser"];
  const tokens = new Map(
    await Promise.all(
      identities.map(async (name) => [
        name,
        await authority.issue({ uid: `firebase_${name}` }),
      ]),
    ),
  );
  const linkCredentialToken = await authority.issue({
    claims: { firebase: { sign_in_provider: "apple.com" } },
    uid: "firebase_initialAdmin_apple",
  });
  tokens.set("linkedApple", linkCredentialToken);
  const userIds = identities.map((_, index) => uuid(index + 1));
  let nextGroupId = 501;
  let nextTaskId = 901;
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
        randomUUID: () => uuid(nextGroupId++),
      });
      const tasks = createFirestoreTaskStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID: () => uuid(nextTaskId++),
      });
      const notificationSubscriptions =
        createFirestoreNotificationSubscriptionStore(config, firestore.fetch, {
          now: () => Date.parse(controls.clock.now()),
        });
      const verifyIdToken = createFirebaseIdTokenVerifier({
        fetchImplementation: authority.fetch,
        now: () => Date.parse(controls.clock.now()),
        projectId: "openjob-dev",
      });
      const identityApi = createV1IdentityApi({
        groups,
        now: () => Date.parse(controls.clock.now()),
        users,
        verifyCredentialToken: verifyIdToken.verifyToken,
        verifyIdToken,
      });
      const groupsApi = createV1GroupsApi({ groups, users, verifyIdToken });
      const tasksApi = createV1TasksApi({ tasks, users, verifyIdToken });
      const notificationSubscriptionsApi = createV1NotificationSubscriptionsApi({
        subscriptions: notificationSubscriptions,
        users,
        verifyIdToken,
      });
      return {
        fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname.startsWith("/api/v1/me/notification-subscriptions/")) {
            return notificationSubscriptionsApi.fetch(request);
          }
          if (pathname.includes("/tasks")) return tasksApi.fetch(request);
          if (
            pathname.startsWith("/api/v1/groups") ||
            pathname.startsWith("/api/v1/invites")
          ) {
            return groupsApi.fetch(request);
          }
          return identityApi.fetch(request);
        },
      };
    },
  });
  t.after(() => harness.close());

  const assertContract = await createOpenApiResponseValidator();
  const contract = await validateOpenApiContract();
  const coverage = new Map();
  const secretMaterial = [...tokens.values(), linkCredentialToken, privateKey];
  const capabilityMaterial = [
    "https://push.example.test/subscriptions/backend-acceptance-capability",
    "p256dh_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
    "auth_0123456789abcdef",
  ];
  const logs = [];
  const originalConsole = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };

  async function request({ actor, ...options }) {
    const token = tokens.get(actor);
    return harness.request({
      ...options,
      headers:
        actor === "invalid"
          ? { authorization: "Bearer invalid-production-smoke-token" }
          : token
            ? { authorization: `Bearer ${token}` }
            : undefined,
    });
  }

  async function validate(response, path, method) {
    await assertContract(response, path, method);
    const key = `${method} ${path}`;
    const categories = coverage.get(key) ?? new Set();
    categories.add(response.ok ? "success" : "error");
    coverage.set(key, categories);
    const body = await response.clone().text();
      for (const secret of [...secretMaterial, ...capabilityMaterial]) {
      assert.equal(body.includes(secret), false, `${key} response exposed secret material`);
    }
  }

  for (const method of Object.keys(originalConsole)) {
    console[method] = (...arguments_) => logs.push(formatLogArguments(arguments_));
  }
  let result;
  let baselineGroup;
  try {
    const creationResponse = await request({
      actor: "initialAdmin",
      body: { confirmation: "create" },
      method: "POST",
      path: "/api/v1/me",
    });
    assert.equal(creationResponse.status, 201);
    const usernameResponse = await request({
      actor: "initialAdmin",
      body: { username: "shane" },
      method: "PUT",
      path: "/api/v1/me/username",
    });
    assert.equal(usernameResponse.status, 200);
    const canonicalUser = (await usernameResponse.json()).data;
    const baselineResponse = await request({
      actor: "initialAdmin",
      body: { name: "Existing production Group" },
      method: "POST",
      path: "/api/v1/groups",
    });
    assert.equal(baselineResponse.status, 201);
    baselineGroup = (await baselineResponse.json()).data;
    const baselineTaskResponse = await request({
      actor: "initialAdmin",
      body: {
        assigneeUsername: canonicalUser.username,
        text: "Preserve canonical work during identity linking",
      },
      method: "POST",
      path: `/api/v1/groups/${baselineGroup.groupId}/tasks`,
    });
    assert.equal(baselineTaskResponse.status, 201);
    const baselineTask = (await baselineTaskResponse.json()).data;

    const linkResponse = await request({
      actor: "initialAdmin",
      body: {
        confirmation: "link",
        credentialToken: linkCredentialToken,
        expectedTargetUserId: canonicalUser.userId,
      },
      method: "POST",
      path: "/api/v1/me/sign-in-methods",
    });
    assert.equal(linkResponse.status, 200);
    await validate(
      linkResponse,
      "/api/v1/me/sign-in-methods",
      "post",
    );
    const linkedUser = (await linkResponse.json()).data;
    assert.equal(linkedUser.userId, canonicalUser.userId);
    assert.equal(linkedUser.username, canonicalUser.username);
    assert.equal(
      linkedUser.groups.some(({ groupId }) => groupId === baselineGroup.groupId),
      true,
    );

    const restoredThroughApple = await request({
      actor: "linkedApple",
      method: "GET",
      path: "/api/v1/me",
    });
    assert.equal(restoredThroughApple.status, 200);
    assert.deepEqual(
      (await restoredThroughApple.json()).data,
      linkedUser,
    );
    const taskThroughApple = await request({
      actor: "linkedApple",
      method: "GET",
      path: `/api/v1/groups/${baselineGroup.groupId}/tasks/${baselineTask.taskId}`,
    });
    assert.equal(taskThroughApple.status, 200);
    assert.deepEqual((await taskThroughApple.json()).data, baselineTask);

    result = await runV1AcceptanceScenario({
      checkpoint: () => harness.restart(),
      proposedUsernames: { initialAdmin: "shane", memberUser: "eli" },
      request,
      validate,
    });
    const groupsAfter = await request({
      actor: "initialAdmin",
      method: "GET",
      path: "/api/v1/groups",
    });
    assert.equal(groupsAfter.status, 200);
    assert.equal(
      (await groupsAfter.json()).data.some(
        ({ groupId }) => groupId === baselineGroup.groupId,
      ),
      true,
    );
    await assert.rejects(
      runV1AcceptanceScenario({
        checkpoint: () => harness.restart(),
        proposedUsernames: { initialAdmin: "shane", memberUser: "eli" },
        request: async (options) => {
          if (
            options.method === "GET" &&
            /^\/api\/v1\/groups\/[^/?]+$/u.test(options.path)
          ) {
            throw new Error("injected mid-scenario failure");
          }
          return request(options);
        },
        validate,
      }),
      /injected mid-scenario failure/u,
    );
    const groupsAfterFailure = await request({
      actor: "initialAdmin",
      method: "GET",
      path: "/api/v1/groups",
    });
    assert.equal(groupsAfterFailure.status, 200);
    assert.deepEqual(
      (await groupsAfterFailure.json()).data.map(({ groupId }) => groupId),
      [baselineGroup.groupId],
    );
  } finally {
    Object.assign(console, originalConsole);
  }

  assert.equal(result.operationCount, 30);
  for (const key of operationKeys(contract)) {
    assert.deepEqual([...coverage.get(key)].sort(), ["error", "success"], key);
  }
  assert.deepEqual(firestore.documents.get(legacyTaskName), legacyTask);

  const persistedState = JSON.stringify([...firestore.documents.values()]);
  const loggedState = logs.join("\n");
  for (const secret of secretMaterial) {
    assert.equal(persistedState.includes(secret), false, "persisted state exposed secret material");
    assert.equal(loggedState.includes(secret), false, "logs exposed secret material");
  }
  for (const capability of capabilityMaterial) {
    assert.equal(persistedState.includes(capability), true, "capability was not persisted");
    assert.equal(loggedState.includes(capability), false, "logs exposed capability material");
  }
});
