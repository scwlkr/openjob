import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreTaskStore } from "../db/v1-tasks.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { runV1AcceptanceScenario } from "../scripts/v1-acceptance-scenario.mjs";
import { validateOpenApiContract } from "../scripts/validate-openapi.mjs";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
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

test("the complete hosted backend passes one clean two-identity black-box gate", async (t) => {
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
      const verifyIdToken = createFirebaseIdTokenVerifier({
        fetchImplementation: authority.fetch,
        now: () => Date.parse(controls.clock.now()),
        projectId: "openjob-dev",
      });
      const identityApi = createV1IdentityApi({ groups, users, verifyIdToken });
      const groupsApi = createV1GroupsApi({ groups, users, verifyIdToken });
      const tasksApi = createV1TasksApi({ tasks, users, verifyIdToken });
      return {
        fetch(request) {
          const pathname = new URL(request.url).pathname;
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
  const secretMaterial = [...tokens.values(), privateKey];
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
    for (const secret of secretMaterial) {
      assert.equal(body.includes(secret), false, `${key} response exposed secret material`);
    }
  }

  for (const method of Object.keys(originalConsole)) {
    console[method] = (...arguments_) => logs.push(formatLogArguments(arguments_));
  }
  let result;
  try {
    result = await runV1AcceptanceScenario({
      checkpoint: () => harness.restart(),
      proposedUsernames: { initialAdmin: "shane", memberUser: "eli" },
      request,
      validate,
    });
  } finally {
    Object.assign(console, originalConsole);
  }

  assert.equal(result.operationCount, 25);
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
});
