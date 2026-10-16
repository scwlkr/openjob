import { createFirestoreAgentGrantStore } from "../db/agent-grants.ts";
import { createV1AgentGrantsApi } from "../server/v1-agent-grants.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createFirestoreGroupStore } from "../db/groups.ts";
import { createFirestoreAccountDeletionJobStore } from "../db/account-deletions.ts";
import { createFirestoreNotificationSubscriptionStore } from "../db/notification-subscriptions.ts";
import { createFirestoreTaskStore } from "../db/v1-tasks.ts";
import { createFirestorePersonalWorkspaceStore } from "../db/personal-workspace.ts";
import { createV1PersonalWorkspaceApi } from "../server/v1-personal-workspace.ts";
import { createV1PersonalAgentGrantsApi } from "../server/v1-personal-agent-grants.ts";
import { createV1ProviderPreviewApi } from "../server/v1-provider-preview.ts";
import { createFirestoreUserStore } from "../db/users.ts";
import { runV1AcceptanceScenario } from "../scripts/v1-acceptance-scenario.mjs";
import { validateOpenApiContract } from "../scripts/validate-openapi.mjs";
import { createFirebaseIdTokenVerifier } from "../server/firebase-id-token.ts";
import { createV1GroupsApi } from "../server/v1-groups.ts";
import { AccountDeletionReauthenticationRequiredError } from "../server/account-deletion-providers.ts";
import { createV1AccountDeletionApi } from "../server/v1-account-deletion.ts";
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
import { createMockProviderConnectionHarness } from "./support/mock-provider-connections.mjs";

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

  const identities = ["initialAdmin", "memberUser", "deletionUser"];
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
  let deletionProviderAttempts = 0;
  let retryAccountDeletions;
  let providerConnectionHarness;
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
      const accountDeletionJobs = createFirestoreAccountDeletionJobStore(
        config,
        Buffer.alloc(32, 9).toString("base64url"),
        firestore.fetch,
        { now: () => Date.parse(controls.clock.now()) },
      );
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
      const agentGrants = createFirestoreAgentGrantStore(config, firestore.fetch, { now: () => Date.parse(controls.clock.now()) });
      const agentGrantsApi = createV1AgentGrantsApi({ grants: agentGrants, users, verifyIdToken, now: () => Date.parse(controls.clock.now()) });
      const groupsApi = createV1GroupsApi({ groups, users, verifyIdToken });
      const personalWorkspaces = createFirestorePersonalWorkspaceStore(config, firestore.fetch);
      const personalWorkspaceApi = createV1PersonalWorkspaceApi({ workspace: personalWorkspaces, users, verifyIdToken });
      const personalAgentGrantsApi = createV1PersonalAgentGrantsApi({ workspace: personalWorkspaces, users, verifyIdToken });
      const mockProviders = new Map();
      const ownedMock = owner => {
        if (!mockProviders.has(owner)) mockProviders.set(owner, createMockProviderConnectionHarness({ owners: { alex: owner },
          isOwnerActive: async ownerId => { const user = await users.getById(ownerId); return !!user && !user.deletionPending; },
          now: () => Date.parse(controls.clock.now()),
        }));
        return mockProviders.get(owner);
      };
      providerConnectionHarness = ownedMock;
      const providerPreviewApi = createV1ProviderPreviewApi({ users, verifyIdToken, connections: {
        listAccounts: async owner => (await ownedMock(owner)).reader.listAccounts(owner),
        listMessages: async input => (await ownedMock(input.ownerId)).reader.listMessages(input),
      } });
      const tasksApi = createV1TasksApi({ agents: agentGrants, tasks, users, verifyIdToken });
      const notificationSubscriptionsApi = createV1NotificationSubscriptionsApi({
        subscriptions: notificationSubscriptions,
        users,
        verifyIdToken,
      });
      const accountDeletionApi = createV1AccountDeletionApi({
        agentGrants,
        personalWorkspaces,
        groups,
        jobs: accountDeletionJobs,
        notifications: notificationSubscriptions,
        now: () => Date.parse(controls.clock.now()),
        providers: {
          assertReady() {},
          async deleteFirebaseUser() {},
          async prepareAuthorization(credential) {
            return credential;
          },
          async revokeAuthorization() {
            deletionProviderAttempts += 1;
            if (deletionProviderAttempts === 1) {
              throw new AccountDeletionReauthenticationRequiredError(
                "google",
              );
            }
            if (deletionProviderAttempts === 2) {
              throw new Error("injected account-deletion provider retry");
            }
          },
          async revokeFirebaseSessions() {},
        },
        users,
        verifyCredentialToken: verifyIdToken.verifyToken,
        verifyIdToken,
      });
      retryAccountDeletions = () => accountDeletionApi.retryPending();
      return {
        fetch(request) {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/api/v1/workspace/provider-preview") return providerPreviewApi.fetch(request);
          if (pathname.startsWith("/api/v1/workspace/agent-grants")) return personalAgentGrantsApi.fetch(request);
          if (pathname.startsWith("/api/v1/workspace/")) return personalWorkspaceApi.fetch(request);
          if (pathname.startsWith("/api/v1/agent-grants")) return agentGrantsApi.fetch(request);
          if (pathname === "/api/v1/me/deletion") {
            return accountDeletionApi.fetch(request);
          }
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
  const deletionRevocationProof = "backend-delete-provider-proof";
  const deletionProviderIdToken = "backend-delete-provider-id-token";
  secretMaterial.push(deletionRevocationProof, deletionProviderIdToken);
  const capabilityMaterial = [
    "https://push.example.test/subscriptions/backend-acceptance-capability",
    "p256dh_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
    "auth_0123456789abcdef",
  ];
  const ephemeralCapabilityMaterial = [];
  const logs = [];
  const originalConsole = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };

  async function request({ actor, authorization, deletionStatus, ...options }) {
    const token = tokens.get(actor);
    const headers = {
      ...(authorization
        ? { authorization: `Bearer ${authorization}` }
        : actor === "invalid"
          ? { authorization: "Bearer invalid-production-smoke-token" }
          : token
            ? { authorization: `Bearer ${token}` }
            : {}),
      ...(deletionStatus
        ? { "x-openjob-deletion-status": deletionStatus }
        : {}),
    };
    return harness.request({
      ...options,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    });
  }

  async function validate(response, path, method, { allowedSecrets = [] } = {}) {
    await assertContract(response, path, method);
    const key = `${method} ${path}`;
    const categories = coverage.get(key) ?? new Set();
    categories.add(response.ok ? "success" : "error");
    coverage.set(key, categories);
    const body = await response.clone().text();
    for (const secret of [
      ...secretMaterial,
      ...capabilityMaterial,
      ...ephemeralCapabilityMaterial,
    ]) {
      if (allowedSecrets.includes(secret)) continue;
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

    const issued = await request({ actor: "initialAdmin", method: "POST", path: "/api/v1/agent-grants", body: { groupId: baselineGroup.groupId, name: "Fixture agent" } });
    assert.equal(issued.status, 201);
    const { agent, token: agentToken } = (await issued.clone().json()).data;
    ephemeralCapabilityMaterial.push(agentToken);
    await validate(issued, "/api/v1/agent-grants", "post", { allowedSecrets: [agentToken] });
    const listedGrants = await request({ actor: "initialAdmin", method: "GET", path: "/api/v1/agent-grants" });
    assert.equal(listedGrants.status, 200);
    await validate(listedGrants, "/api/v1/agent-grants", "get");
    const delegatedRead = await request({ authorization: agentToken, method: "GET", path: `/api/v1/groups/${baselineGroup.groupId}/tasks/${baselineTask.taskId}` });
    assert.equal(delegatedRead.status, 200);
    await validate(delegatedRead, "/api/v1/groups/{groupId}/tasks/{taskId}", "get");
    for (const method of ["GET", "POST"]) {
      const denied = await request({ authorization: agentToken, method, path: "/api/v1/agent-grants", ...(method === "POST" ? { body: { groupId: baselineGroup.groupId, name: "Denied" } } : {}) });
      assert.equal(denied.status, 401);
      await validate(denied, "/api/v1/agent-grants", method.toLowerCase());
    }
    const revokePath = `/api/v1/agent-grants/${agent.agentId}`;
    const revoked = await request({ actor: "initialAdmin", method: "DELETE", path: revokePath });
    assert.equal(revoked.status, 204);
    await validate(revoked, "/api/v1/agent-grants/{agentId}", "delete");
    const alreadyRevoked = await request({ actor: "initialAdmin", method: "DELETE", path: revokePath });
    assert.equal(alreadyRevoked.status, 404);
    await validate(alreadyRevoked, "/api/v1/agent-grants/{agentId}", "delete");
    const revokedRead = await request({ authorization: agentToken, method: "GET", path: `/api/v1/groups/${baselineGroup.groupId}/tasks/${baselineTask.taskId}` });
    assert.equal(revokedRead.status, 403);
    await validate(revokedRead, "/api/v1/groups/{groupId}/tasks/{taskId}", "get");

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
    // The complete backend checklist includes the owner-private application API.
    const privateCall = async (actor, input) => {
      const method = input ? "POST" : "GET";
      const path = `/api/v1/workspace/${input ? "commands" : "snapshot"}`;
      const response = await request({ actor, method, path, ...(input ? { body: input } : {}) });
      await validate(response, path, method.toLowerCase());
      return response;
    };
    assert.equal((await privateCall("invalid")).status, 401);
    assert.equal((await privateCall("invalid", { type: "task.create", title: "Denied" })).status, 401);
    const createdPrivate = await privateCall("initialAdmin", { type: "task.create", title: "Owner private planning" });
    assert.equal(createdPrivate.status, 200);
    const privateTask = (await createdPrivate.json()).data;
    for (const command of [
      { type: "task.schedule", taskId: privateTask.id, calendarId: "personal", start: "2026-07-17T10:00:00Z", end: "2026-07-17T10:30:00Z" },
      { type: "task.update", taskId: privateTask.id, title: "Persisted personal plan" },
      { type: "task.complete", taskId: privateTask.id, completed: true },
    ]) assert.equal((await privateCall("initialAdmin", command)).status, 200);
    assert.equal((await privateCall("memberUser", { type: "task.update", taskId: privateTask.id, title: "Foreign edit" })).status, 403);
    const otherWorkspace = await privateCall("memberUser");
    assert.equal(otherWorkspace.status, 200);
    assert.equal((await otherWorkspace.json()).data.tasks.length, 0);
    await harness.restart();
    const savedPrivate = await privateCall("initialAdmin");
    assert.equal(savedPrivate.status, 200);
    const privateState = (await savedPrivate.json()).data;
    assert.equal(privateState.tasks.find(task => task.id === privateTask.id).completed, true);
    assert.equal(privateState.events.find(event => event.taskId === privateTask.id).title, "Persisted personal plan");
    assert.equal(privateState.events.find(event => event.taskId === privateTask.id).start, "2026-07-17T10:00:00.000Z");
    // The authenticated Mail journey uses the same private document and strict
    // response contract, with invented records and no provider transport.
    const seedMail = await privateCall("initialAdmin", { type: "mail.examples.add" });
    assert.equal(seedMail.status, 200);
    assert.equal((await seedMail.json()).data.added, true);
    const seeded = (await (await privateCall("initialAdmin")).json()).data;
    assert.equal(seeded.accounts.length, 3); assert.equal(seeded.messages.length, 6);
    const message = seeded.messages[0];
    const linkedTask = await privateCall("initialAdmin", { type: "task.create", title: "Act on invented mail", messageId: message.id });
    assert.equal(linkedTask.status, 200);
    const mailTask = (await linkedTask.json()).data;
    assert.equal(mailTask.sourceAccountId, message.accountId);
    assert.equal((await privateCall("initialAdmin", { type: "task.schedule", taskId: mailTask.id, calendarId: "personal", start: "2026-07-18T10:00:00Z", end: "2026-07-18T10:30:00Z" })).status, 200);
    assert.equal((await privateCall("initialAdmin", { type: "task.complete", taskId: mailTask.id, completed: true })).status, 200);
    const reply = await privateCall("initialAdmin", { type: "mail.draft", messageId: message.id, body: "Invented reply saved through the API" });
    assert.equal(reply.status, 200); const draft = (await reply.json()).data;
    assert.equal(draft.accountId, message.accountId);
    const realSend = await privateCall("initialAdmin", { type: "mail.send", draftId: draft.id });
    assert.equal(realSend.status, 403); assert.equal((await realSend.json()).error.code, "sending_disabled");
    await harness.restart();
    const persistedMail = (await (await privateCall("initialAdmin")).json()).data;
    assert.equal(persistedMail.drafts.find(item => item.id === draft.id).body, "Invented reply saved through the API");
    assert.equal(persistedMail.tasks.find(item => item.id === mailTask.id).completed, true);
    assert.equal((await (await privateCall("memberUser")).json()).data.messages.length, 0);
    assert.equal((await (await privateCall("initialAdmin", { type: "mail.examples.add" })).json()).data.added, false);
    const calendarExportPath = "/api/v1/workspace/calendar-export";
    const exportedCalendar = await request({ actor: "initialAdmin", method: "GET", path: `${calendarExportPath}?calendarId=personal` });
    assert.equal(exportedCalendar.status, 200);
    await validate(exportedCalendar, calendarExportPath, "get");
    const calendarFile = (await exportedCalendar.json()).data;
    assert.equal(calendarFile.calendarId, "personal");
    assert.equal(calendarFile.filename, "openjob-calendar.ics");
    assert.equal(calendarFile.contentType, "text/calendar; charset=utf-8");
    assert.ok(calendarFile.ical.includes("SUMMARY:Persisted personal plan\r\n"));
    assert.ok(calendarFile.ical.includes("SUMMARY:Act on invented mail\r\n"));
    for (const privateReference of [privateTask.id, mailTask.id, mailTask.sourceAccountId, message.id, privateTask.ownerId, "sourceMessageId", "sourceAccountId", "taskId", "DESCRIPTION:", "URL:"]) {
      assert.equal(calendarFile.ical.includes(privateReference), false, `Calendar export exposed ${privateReference}`);
    }
    const foreignCalendar = await request({ actor: "memberUser", method: "GET", path: `${calendarExportPath}?calendarId=foreign` });
    assert.equal(foreignCalendar.status, 403);
    await validate(foreignCalendar, calendarExportPath, "get");
    const previewPath = "/api/v1/workspace/provider-preview";
    const deniedPreview = await request({ actor: "invalid", method: "GET", path: previewPath });
    assert.equal(deniedPreview.status, 401); await validate(deniedPreview, previewPath, "get");
    const previewResponse = await request({ actor: "initialAdmin", method: "GET", path: previewPath });
    assert.equal(previewResponse.status, 200); await validate(previewResponse, previewPath, "get");
    const preview = (await previewResponse.json()).data;
    assert.equal(preview.mode, "synthetic");
    assert.deepEqual(preview.connectors.map(connector => [connector.provider, connector.status, connector.consent, connector.liveExecutionEnabled]), [["gmail", "not_connected", "required", false], ["outlook", "not_connected", "required", false], ["imap", "not_connected", "required", false]]);
    assert.ok(preview.connectors[0].implementedOperations.includes("mail.read"));
    assert.ok(preview.connectors[0].unsupportedOperations.includes("mail.send"));
    assert.ok(preview.accounts.length >= 2);
    assert.ok(preview.messages.length > 0);
    const foreignPreview = await request({ actor: "memberUser", method: "GET", path: `${previewPath}?accountId=${encodeURIComponent(preview.selectedAccountId)}` });
    assert.equal(foreignPreview.status, 403); await validate(foreignPreview, previewPath, "get");
    const invalidPreviewQuery = await request({ actor: "initialAdmin", method: "GET", path: `${previewPath}?ownerId=foreign` });
    assert.equal(invalidPreviewQuery.status, 400); await validate(invalidPreviewQuery, previewPath, "get");
    const mockAccount = preview.accounts.find(account => account.mode === "mock" && account.status === "ready");
    assert.ok(mockAccount);
    const mockCall = async (actor, accountId, cursor) => {
      const query = new URLSearchParams({ accountId, ...(cursor ? { cursor } : {}) });
      const response = await request({ actor, method: "GET", path: `${previewPath}?${query}` });
      await validate(response.clone(), previewPath, "get"); return response;
    };
    const mockRead = await mockCall("initialAdmin", mockAccount.id);
    assert.equal(mockRead.status, 200); const mockPage = (await mockRead.json()).data;
    assert.equal(mockPage.mode, "mock"); assert.equal(mockPage.messages.length, 2);
    assert.equal(mockPage.messages[0].subject, "Protocol fixture: prepare the launch");
    assert.match(mockPage.messages[0].body, /wire mapper for alex/);
    const mockNext = await mockCall("initialAdmin", mockAccount.id, mockPage.nextCursor);
    assert.equal(mockNext.status, 200); assert.equal((await mockNext.json()).data.messages.length, 1);
    const mockHarness = await providerConnectionHarness(canonicalUser.userId);
    const beforeBlocked = { ...mockHarness.counters };
    assert.equal((await mockCall("memberUser", mockAccount.id)).status, 403);
    const consent = preview.accounts.find(account => account.mode === "mock" && account.status === "needs_consent");
    assert.ok(consent); const blockedConsent = await mockCall("initialAdmin", consent.id);
    assert.equal(blockedConsent.status, 200); assert.deepEqual((await blockedConsent.json()).data.messages, []);
    assert.equal(mockHarness.controls.revoke(mockAccount.id), true);
    const revokedMock = await mockCall("initialAdmin", mockAccount.id);
    assert.equal(revokedMock.status, 200); const revokedMockData = (await revokedMock.json()).data;
    assert.equal(revokedMockData.accounts.find(account => account.id === mockAccount.id).status, "revoked");
    assert.deepEqual(revokedMockData.messages, []); assert.deepEqual(mockHarness.counters, beforeBlocked);
    assert.equal(JSON.stringify(mockPage).includes("credentialRef"), false);
    assert.equal(JSON.stringify(mockPage).includes("mock_access_"), false);
    const personalGrantPath = "/api/v1/workspace/agent-grants";
    const issuedPersonal = await request({ actor: "initialAdmin", method: "POST", path: personalGrantPath, body: { name: "Personal planner", scopes: ["tasks:read", "tasks:write", "calendar:read", "calendar:write"], resourceIds: ["tasks:personal", "calendar:personal"] } });
    assert.equal(issuedPersonal.status, 201);
    const { agent: personalGrant, token: personalToken } = (await issuedPersonal.clone().json()).data;
    ephemeralCapabilityMaterial.push(personalToken);
    const personalAgentPreview = await request({ authorization: personalToken, method: "GET", path: previewPath });
    assert.equal(personalAgentPreview.status, 401); await validate(personalAgentPreview, previewPath, "get");
    await validate(issuedPersonal, personalGrantPath, "post", { allowedSecrets: [personalToken] });
    const personalList = await request({ actor: "initialAdmin", method: "GET", path: personalGrantPath });
    assert.equal(personalList.status, 200); await validate(personalList, personalGrantPath, "get");
    for (const method of ["GET", "POST"]) {
      const deniedAdmin = await request({ authorization: personalToken, method, path: personalGrantPath, ...(method === "POST" ? { body: { name: "Denied", scopes: ["tasks:read"], resourceIds: ["tasks:personal"] } } : {}) });
      assert.equal(deniedAdmin.status, 401); await validate(deniedAdmin, personalGrantPath, method.toLowerCase());
    }
    const personalAgentEdit = await request({ authorization: personalToken, method: "POST", path: "/api/v1/workspace/commands", body: { type: "task.update", taskId: privateTask.id, title: "Personal agent revision" } });
    assert.equal(personalAgentEdit.status, 200); await validate(personalAgentEdit, "/api/v1/workspace/commands", "post");
    const grantResource = `${personalGrantPath}/${personalGrant.id}`;
    const foreignRevoke = await request({ actor: "memberUser", method: "DELETE", path: grantResource });
    assert.equal(foreignRevoke.status, 404); await validate(foreignRevoke, `${personalGrantPath}/{agentId}`, "delete");
    const personalRevoke = await request({ actor: "initialAdmin", method: "DELETE", path: grantResource });
    assert.equal(personalRevoke.status, 204); await validate(personalRevoke, `${personalGrantPath}/{agentId}`, "delete");
    const revokedPersonal = await request({ authorization: personalToken, method: "GET", path: "/api/v1/workspace/snapshot" });
    assert.equal(revokedPersonal.status, 401); await validate(revokedPersonal, "/api/v1/workspace/snapshot", "get");
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

    const deletionUserResponse = await request({
      actor: "deletionUser",
      body: { confirmation: "create" },
      method: "POST",
      path: "/api/v1/me",
    });
    assert.equal(deletionUserResponse.status, 201);
    const invalidDeletion = await request({
      actor: "deletionUser",
      body: { confirmation: "delete", credentials: [] },
      method: "POST",
      path: "/api/v1/me/deletion",
    });
    assert.equal(invalidDeletion.status, 400);
    await validate(invalidDeletion, "/api/v1/me/deletion", "post");
    const missingDeletionPreparation = await request({
      method: "PUT",
      path: "/api/v1/me/deletion",
    });
    assert.equal(missingDeletionPreparation.status, 401);
    await validate(
      missingDeletionPreparation,
      "/api/v1/me/deletion",
      "put",
    );
    const missingDeletionStatus = await request({
      method: "GET",
      path: "/api/v1/me/deletion",
    });
    assert.equal(missingDeletionStatus.status, 401);
    await validate(missingDeletionStatus, "/api/v1/me/deletion", "get");

    const deletionWorkspace = await privateCall("deletionUser", { type: "task.create", title: "Remove private account data" });
    assert.equal(deletionWorkspace.status, 200);
    const deletionWorkspaceOwner = (await deletionWorkspace.json()).data.ownerId;
    const deletionWorkspacePath = `${database}/v1PersonalWorkspaces/${deletionWorkspaceOwner}`;
    assert.ok(firestore.documents.has(deletionWorkspacePath));
    const preparedDeletion = await request({
      actor: "deletionUser",
      method: "PUT",
      path: "/api/v1/me/deletion",
    });
    assert.equal(preparedDeletion.status, 200);
    const preparedDeletionBody = await preparedDeletion.clone().json();
    const statusToken = preparedDeletionBody.data.statusToken;
    assert.match(statusToken, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    assert.deepEqual(preparedDeletionBody.data, {
      status: "not_started",
      statusToken,
      submissionExpiresAt: "2026-07-16T12:05:00.000Z",
    });
    await validate(preparedDeletion, "/api/v1/me/deletion", "put", {
      allowedSecrets: [statusToken],
    });
    ephemeralCapabilityMaterial.push(statusToken);

    const notStartedStatus = await request({
      authorization: statusToken,
      method: "GET",
      path: "/api/v1/me/deletion",
    });
    assert.equal(notStartedStatus.status, 200);
    assert.deepEqual((await notStartedStatus.clone().json()).data, {
      status: "not_started",
      submissionExpired: false,
      submissionExpiresAt: "2026-07-16T12:05:00.000Z",
    });
    await validate(notStartedStatus, "/api/v1/me/deletion", "get");

    harness.advance(5 * 60_000);
    const expiredNotStartedStatus = await request({
      authorization: statusToken,
      method: "GET",
      path: "/api/v1/me/deletion",
    });
    assert.equal(expiredNotStartedStatus.status, 200);
    assert.deepEqual((await expiredNotStartedStatus.clone().json()).data, {
      status: "not_started",
      submissionExpired: true,
      submissionExpiresAt: "2026-07-16T12:05:00.000Z",
    });
    await validate(
      expiredNotStartedStatus,
      "/api/v1/me/deletion",
      "get",
    );

    const refreshedDeletionNow = Date.parse("2026-07-16T12:05:00.000Z") / 1000;
    const refreshedDeletionToken = await authority.issue({
      claims: {
        auth_time: refreshedDeletionNow,
        exp: refreshedDeletionNow + 3600,
        iat: refreshedDeletionNow,
      },
      uid: "firebase_deletionUser",
    });
    tokens.set("deletionUser", refreshedDeletionToken);
    secretMaterial.push(refreshedDeletionToken);

    const canceledSubmission = await request({
      actor: "deletionUser",
      body: {
        confirmation: "delete",
        credentials: [{
          credentialToken: tokens.get("deletionUser"),
          provider: "google",
          revocation: {
            idToken: deletionProviderIdToken,
            kind: "access_token",
            value: deletionRevocationProof,
          },
        }],
      },
      deletionStatus: statusToken,
      method: "POST",
      path: "/api/v1/me/deletion",
    });
    assert.equal(
      canceledSubmission.status,
      400,
      JSON.stringify(await canceledSubmission.clone().json()),
    );
    await validate(canceledSubmission, "/api/v1/me/deletion", "post");

    const invalidPreparationQuery = await request({
      actor: "deletionUser",
      method: "PUT",
      path: "/api/v1/me/deletion?unexpected=true",
    });
    assert.equal(invalidPreparationQuery.status, 400);
    await validate(
      invalidPreparationQuery,
      "/api/v1/me/deletion",
      "put",
    );

    const replacementPreparation = await request({
      actor: "deletionUser",
      method: "PUT",
      path: "/api/v1/me/deletion",
    });
    assert.equal(replacementPreparation.status, 200);
    const replacementBody = await replacementPreparation.clone().json();
    const replacementStatusToken = replacementBody.data.statusToken;
    assert.notEqual(replacementStatusToken, statusToken);
    ephemeralCapabilityMaterial.push(replacementStatusToken);
    await validate(replacementPreparation, "/api/v1/me/deletion", "put", {
      allowedSecrets: [replacementStatusToken],
    });

    const pendingDeletion = await request({
      actor: "deletionUser",
      body: {
        confirmation: "delete",
        credentials: [{
          credentialToken: tokens.get("deletionUser"),
          provider: "google",
          revocation: {
            idToken: deletionProviderIdToken,
            kind: "access_token",
            value: deletionRevocationProof,
          },
        }],
      },
      deletionStatus: replacementStatusToken,
      method: "POST",
      path: "/api/v1/me/deletion",
    });
    assert.equal(pendingDeletion.status, 202);
    const pendingDeletionBody = await pendingDeletion.clone().json();
    assert.equal(
      pendingDeletionBody.data.statusToken,
      replacementStatusToken,
    );
    await validate(pendingDeletion, "/api/v1/me/deletion", "post", {
      allowedSecrets: [replacementStatusToken],
    });

    const pendingStatus = await request({
      authorization: replacementStatusToken,
      method: "GET",
      path: "/api/v1/me/deletion",
    });
    assert.equal(pendingStatus.status, 200);
    assert.equal((await pendingStatus.clone().json()).data.status, "pending");
    await validate(pendingStatus, "/api/v1/me/deletion", "get");

    const missingRefreshStatus = await request({
      body: {
        credential: {
          credentialToken: tokens.get("deletionUser"),
          provider: "google",
          revocation: {
            idToken: deletionProviderIdToken,
            kind: "access_token",
            value: deletionRevocationProof,
          },
        },
      },
      method: "PATCH",
      path: "/api/v1/me/deletion",
    });
    assert.equal(missingRefreshStatus.status, 401);
    await validate(missingRefreshStatus, "/api/v1/me/deletion", "patch");

    const refreshedDeletion = await request({
      authorization: replacementStatusToken,
      body: {
        credential: {
          credentialToken: tokens.get("deletionUser"),
          provider: "google",
          revocation: {
            idToken: deletionProviderIdToken,
            kind: "access_token",
            value: deletionRevocationProof,
          },
        },
      },
      method: "PATCH",
      path: "/api/v1/me/deletion",
    });
    assert.equal(
      refreshedDeletion.status,
      202,
      await refreshedDeletion.clone().text(),
    );
    await validate(refreshedDeletion, "/api/v1/me/deletion", "patch", {
      allowedSecrets: [replacementStatusToken],
    });

    const recoveredPending = await request({
      actor: "deletionUser",
      body: {
        credential: {
          credentialToken: tokens.get("deletionUser"),
          provider: "google",
          revocation: {
            idToken: deletionProviderIdToken,
            kind: "access_token",
            value: deletionRevocationProof,
          },
        },
      },
      method: "PUT",
      path: "/api/v1/me/deletion",
    });
    assert.equal(recoveredPending.status, 202);
    const recoveredPendingBody = await recoveredPending.clone().json();
    const recoveredStatusToken = recoveredPendingBody.data.statusToken;
    assert.equal(recoveredPendingBody.data.status, "pending");
    assert.equal(
      Object.hasOwn(recoveredPendingBody.data, "submissionExpiresAt"),
      false,
    );
    ephemeralCapabilityMaterial.push(recoveredStatusToken);
    await validate(recoveredPending, "/api/v1/me/deletion", "put", {
      allowedSecrets: [recoveredStatusToken],
    });

    assert.deepEqual(await retryAccountDeletions(), {
      completed: 1,
      escalated: 0,
      pending: 0,
    });
    const completedStatus = await request({
      authorization: recoveredStatusToken,
      method: "GET",
      path: "/api/v1/me/deletion",
    });
    assert.equal(completedStatus.status, 200);
    assert.deepEqual((await completedStatus.clone().json()).data, {
      status: "completed",
    });
    await validate(completedStatus, "/api/v1/me/deletion", "get");
    assert.equal(firestore.documents.has(deletionWorkspacePath), false, "account deletion removes the private workspace");
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
  for (const capability of ephemeralCapabilityMaterial) {
    assert.equal(persistedState.includes(capability), false, "status capability was persisted");
    assert.equal(loggedState.includes(capability), false, "logs exposed status capability");
  }
});
