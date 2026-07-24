import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreTaskStore } from "../db/v1-tasks.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import {
  createQaFixtureStore,
  resetQaFixture,
} from "../scripts/reset-qa-fixture.mjs";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { createV1IdentityApi } from "../server/v1-identity.ts";
import { createV1TasksApi } from "../server/v1-tasks.ts";
import { createTestFirebaseAuthority } from "./support/firebase-id-tokens.mjs";
import {
  createFakeFirestore,
  createPrivateKey,
} from "./support/fake-firestore.mjs";
import { createV1TestHarness } from "./support/v1-harness.mjs";

const NOW = "2026-07-23T12:00:00.000Z";
const PROJECT_ID = "openjob-nonprod";
const DATABASE =
  `projects/${PROJECT_ID}/databases/(default)/documents`;
const GROUP_ID = "grp_9f5d28b6c10e4a7db3f924681c7e50aa";
const QA_PASSWORD_TENANT_ID = "OpenJob-QA-Two-mvz9m";
const QA_USERS = {
  qaOne: {
    firebaseUid: "firebase_qa_one",
    provider: "google",
    userId: "user_qa_one_stable",
    username: "qa-one",
  },
  qaTwo: {
    firebaseUid: "firebase_qa_two",
    provider: "qa-password",
    userId: "user_qa_two_stable",
    username: "qa-two",
  },
};

function document(path, fields) {
  return {
    name: `${DATABASE}/${path}`,
    fields,
    updateTime: "2026-07-23T00:00:00.000001Z",
  };
}

async function sha256Key(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("base64url");
}

async function seedQaIdentities(firestore) {
  for (const user of Object.values(QA_USERS)) {
    const methodId = await sha256Key(
      `${user.provider}\0${user.firebaseUid}`,
    );
    const ownership = {
      linkedAt: { timestampValue: "2026-07-23T00:00:00.000Z" },
      methodId: { stringValue: methodId },
      provider: { stringValue: user.provider },
      userId: { stringValue: user.userId },
    };
    firestore.documents.set(
      `${DATABASE}/v1SignInMethods/${methodId}`,
      document(`v1SignInMethods/${methodId}`, ownership),
    );
    firestore.documents.set(
      `${DATABASE}/v1UserSignInMethods/${user.userId}/providers/${user.provider}`,
      document(
        `v1UserSignInMethods/${user.userId}/providers/${user.provider}`,
        ownership,
      ),
    );
    firestore.documents.set(
      `${DATABASE}/v1UserDirectory/${user.userId}`,
      document(`v1UserDirectory/${user.userId}`, {
        userId: { stringValue: user.userId },
        username: { stringValue: user.username },
      }),
    );
    firestore.documents.set(
      `${DATABASE}/v1Usernames/${user.username}`,
      document(`v1Usernames/${user.username}`, {
        userId: { stringValue: user.userId },
        claimedAt: { timestampValue: "2026-07-23T00:00:00.000Z" },
      }),
    );
  }
}

test("ordinary QA Users share the reset fixture and observe API changes in both directions", async (t) => {
  const authority = await createTestFirebaseAuthority({
    now: NOW,
    projectId: PROJECT_ID,
  });
  const firestore = createFakeFirestore({ projectId: PROJECT_ID });
  const privateKey = await createPrivateKey();
  const config = {
    projectId: PROJECT_ID,
    clientEmail: "worker@openjob-nonprod.iam.gserviceaccount.com",
    privateKey,
  };
  await seedQaIdentities(firestore);
  await resetQaFixture({
    confirmation:
      `openjob-two-user-qa-v1:openjob-nonprod:${GROUP_ID}`,
    environment: "preview",
    now: () => Date.parse(NOW),
    qaOneUserId: QA_USERS.qaOne.userId,
    qaTwoUserId: QA_USERS.qaTwo.userId,
    store: createQaFixtureStore(config, firestore.fetch),
  });

  const privateGroupId = "grp_non_qa_private";
  firestore.documents.set(
    `${DATABASE}/v1Groups/${privateGroupId}`,
    document(`v1Groups/${privateGroupId}`, {
      groupId: { stringValue: privateGroupId },
      name: { stringValue: "Private non-QA Group" },
      createdAt: { timestampValue: NOW },
      stateRevision: { integerValue: "0" },
    }),
  );

  const harness = createV1TestHarness({
    initialNow: NOW,
    createWorker(controls) {
      const users = createFirestoreUserStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
        randomUUID() {
          throw new Error("The QA journey must not create another User.");
        },
      });
      const groups = createFirestoreGroupStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
      });
      const tasks = createFirestoreTaskStore(config, firestore.fetch, {
        now: () => Date.parse(controls.clock.now()),
      });
      const verifyIdToken = createFirebaseIdTokenVerifier({
        fetchImplementation: authority.fetch,
        now: () => Date.parse(controls.clock.now()),
        projectId: PROJECT_ID,
        qaPassword: {
          tenantId: QA_PASSWORD_TENANT_ID,
          uid: QA_USERS.qaTwo.firebaseUid,
        },
      });
      const identityApi = createV1IdentityApi({ groups, users, verifyIdToken });
      const groupsApi = createV1GroupsApi({ groups, users, verifyIdToken });
      const tasksApi = createV1TasksApi({ tasks, users, verifyIdToken });
      return {
        fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname.includes("/tasks")) return tasksApi.fetch(request);
          if (pathname.startsWith("/api/v1/groups")) {
            return groupsApi.fetch(request);
          }
          return identityApi.fetch(request);
        },
      };
    },
  });
  t.after(() => harness.close());

  const headers = Object.fromEntries(
    await Promise.all(
      Object.entries(QA_USERS).map(async ([key, user]) => [
        key,
        {
          authorization:
            `Bearer ${await authority.issue({
              uid: user.firebaseUid,
              claims: {
                firebase: user.provider === "qa-password"
                  ? {
                    sign_in_provider: "password",
                    tenant: QA_PASSWORD_TENANT_ID,
                  }
                  : { sign_in_provider: "google.com" },
              },
            })}`,
        },
      ]),
    ),
  );
  async function request(actor, options) {
    return harness.request({ ...options, headers: headers[actor] });
  }

  for (const [actor, expected] of Object.entries(QA_USERS)) {
    const me = await request(actor, {
      method: "GET",
      path: "/api/v1/me",
    });
    assert.equal(me.status, 200);
    const identity = (await me.json()).data;
    assert.equal(identity.userId, expected.userId);
    assert.equal(identity.username, expected.username);
    assert.deepEqual(
      identity.groups.map(({ groupId }) => groupId),
      [GROUP_ID],
    );

    const groups = await request(actor, {
      method: "GET",
      path: "/api/v1/groups",
    });
    assert.equal(groups.status, 200);
    assert.deepEqual(
      (await groups.json()).data.map(({ groupId }) => groupId),
      [GROUP_ID],
    );

    const privateRead = await request(actor, {
      method: "GET",
      path: `/api/v1/groups/${privateGroupId}`,
    });
    assert.equal(privateRead.status, 404);
    const privateMutation = await request(actor, {
      body: { name: "Compromised" },
      method: "PATCH",
      path: `/api/v1/groups/${privateGroupId}`,
    });
    assert.equal(privateMutation.status, 404);
  }

  const changes = [
    {
      actor: "qaOne",
      observer: "qaTwo",
      taskId: "task_qa_two_open_normal_today",
    },
    {
      actor: "qaTwo",
      observer: "qaOne",
      taskId: "task_qa_one_open_high_overdue",
    },
  ];
  for (const change of changes) {
    const completed = await request(change.actor, {
      body: { state: "done" },
      method: "PUT",
      path: `/api/v1/groups/${GROUP_ID}/tasks/${change.taskId}/state`,
    });
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).data.state, "done");

    const observed = await request(change.observer, {
      method: "GET",
      path: `/api/v1/groups/${GROUP_ID}/tasks/${change.taskId}`,
    });
    assert.equal(observed.status, 200);
    assert.equal((await observed.json()).data.state, "done");
  }
});
