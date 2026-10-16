import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { validateOpenApiContract } from "../scripts/validate-openapi.mjs";
import { createProviderPreview, createProviderResourceRef } from "../shared/provider-preview.ts";

const contractUrl = new URL("../openapi/openapi.yaml", import.meta.url);
const EXPECTED_RELEASE_VERSION = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
).version;

const expectedOperations = [
  "get /api/v1/agent-grants listAgentGrants",
  "post /api/v1/agent-grants createAgentGrant",
  "delete /api/v1/agent-grants/{agentId} revokeAgentGrant",
  "delete /api/v1/groups/{groupId}/tasks/{taskId} deleteGroupTask",
  "get /api/v1/groups listGroups",
  "get /api/v1/groups/{groupId} getGroup",
  "get /api/v1/groups/{groupId}/bans listGroupBans",
  "get /api/v1/groups/{groupId}/invite-link getGroupInviteLink",
  "get /api/v1/groups/{groupId}/members listGroupMembers",
  "get /api/v1/groups/{groupId}/tasks listGroupTasks",
  "get /api/v1/groups/{groupId}/tasks/{taskId} getGroupTask",
  "get /api/v1/invites/{token} inspectInviteLink",
  "get /api/v1/me getMe",
  "get /api/v1/me/deletion getAccountDeletionStatus",
  "get /api/v1/me/notification-subscriptions/{installationId} getNotificationSubscription",
  "get /api/v1/me/sign-in-methods listSignInMethods",
  "get /api/v1/workspace/snapshot getPersonalWorkspace",
  "get /api/v1/workspace/provider-preview getProviderPreview",
  "get /api/v1/workspace/agent-grants listPersonalAgentGrants",
  "post /api/v1/workspace/agent-grants createPersonalAgentGrant",
  "delete /api/v1/workspace/agent-grants/{agentId} revokePersonalAgentGrant",
  "patch /api/v1/groups/{groupId} renameGroup",
  "patch /api/v1/groups/{groupId}/tasks/{taskId} updateGroupTask",
  "patch /api/v1/me/deletion refreshAccountDeletionProvider",
  "patch /api/v1/me/notification-subscriptions/{installationId} setNotificationSubscriptionState",
  "post /api/v1/groups createGroup",
  "post /api/v1/groups/{groupId}/actions/end endGroup",
  "post /api/v1/groups/{groupId}/actions/leave leaveGroup",
  "post /api/v1/groups/{groupId}/bans/actions/ban banGroupUser",
  "post /api/v1/groups/{groupId}/bans/{userId}/actions/unban unbanGroupUser",
  "post /api/v1/groups/{groupId}/invite-link/actions/rotate rotateGroupInviteLink",
  "post /api/v1/groups/{groupId}/members/{userId}/actions/demote demoteGroupMember",
  "post /api/v1/groups/{groupId}/members/{userId}/actions/kick kickGroupMember",
  "post /api/v1/groups/{groupId}/members/{userId}/actions/promote promoteGroupMember",
  "post /api/v1/groups/{groupId}/tasks createGroupTask",
  "post /api/v1/invites/{token}/actions/join joinGroupWithInviteLink",
  "post /api/v1/me createCurrentUser",
  "post /api/v1/me/deletion deleteCurrentUser",
  "post /api/v1/me/sign-in-methods linkSignInMethod",
  "post /api/v1/workspace/commands commandPersonalWorkspace",
  "put /api/v1/groups/{groupId}/tasks/{taskId}/state setGroupTaskState",
  "put /api/v1/me/deletion mintAccountDeletionStatusToken",
  "put /api/v1/me/username claimUsername",
  "put /api/v1/me/notification-subscriptions/{installationId} registerNotificationSubscription",
].sort();

const httpMethods = new Set([
  "delete",
  "get",
  "head",
  "options",
  "patch",
  "post",
  "put",
  "trace",
]);

const accountDeletionPendingResponseExceptions = new Set([
  "get /api/v1/me/deletion",
  "patch /api/v1/me/deletion",
  "put /api/v1/me/deletion",
]);

function operations(contract) {
  return Object.entries(contract.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([method]) => httpMethods.has(method))
      .map(([method, operation]) => ({ method, path, operation })),
  );
}

function mediaTypeHasExample(mediaType) {
  return (
    Object.hasOwn(mediaType, "example") ||
    (mediaType.examples && Object.keys(mediaType.examples).length > 0)
  );
}

function compileSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

test("the OpenAPI contract is the complete v1 backend checklist", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const actualOperations = operations(contract);

  assert.equal(contract.openapi, "3.1.0");
  assert.equal(Object.keys(contract.paths).length, 30);
  assert.deepEqual(
    actualOperations
      .map(({ method, path, operation }) => `${method} ${path} ${operation.operationId}`)
      .sort(),
    expectedOperations,
  );
  assert.deepEqual(contract.security, [{ firebaseBearer: [] }]);
  assert.equal(contract.components.securitySchemes.firebaseBearer.scheme, "bearer");
  assert.equal(
    contract.components.securitySchemes.deletionStatusBearer.scheme,
    "bearer",
  );

  for (const { method, path, operation } of actualOperations) {
    const location = `${method.toUpperCase()} ${path}`;
    const operationKey = `${method} ${path}`;
    assert.match(operation.operationId, /^[a-z][A-Za-z0-9]+$/, location);
    assert.match(
      operation["x-openjob-authorization"],
      /^(authenticated|member|admin|capability)$/,
      location,
    );
    assert.equal(typeof operation["x-openjob-retryable"], "boolean", location);

    for (const status of ["401", "429", "500"]) {
      assert.ok(operation.responses[status], `${location} declares ${status}`);
    }
    if (!accountDeletionPendingResponseExceptions.has(operationKey)) {
      const deletionPending = operation.responses["410"];
      assert.ok(
        deletionPending,
        `${location} declares the deletion-pending access fence`,
      );
      assert.equal(
        deletionPending.content["application/json"].schema.allOf[1]
          .properties.error.properties.code.const,
        "account_deletion_pending",
        `${location} validates the deletion-pending response code`,
      );
    }

    const success = Object.entries(operation.responses).find(([status]) => /^2\d\d$/.test(status));
    assert.ok(success, `${location} declares success`);
    if (success[0] !== "204") {
      const mediaType = success[1].content?.["application/json"];
      assert.ok(mediaType?.schema, `${location} success has a JSON schema`);
      assert.ok(mediaTypeHasExample(mediaType), `${location} success has an example`);
    }

    const requestMediaType = operation.requestBody?.content?.["application/json"];
    if (requestMediaType) {
      assert.ok(requestMediaType.schema, `${location} request has a JSON schema`);
      assert.ok(mediaTypeHasExample(requestMediaType), `${location} request has an example`);
    }
  }
});

test("release metadata matches the root product version", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const cliPackageJson = JSON.parse(
    await readFile(new URL("../cli/package.json", import.meta.url), "utf8"),
  );
  const packageLock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.info.version, EXPECTED_RELEASE_VERSION);
  assert.equal(packageJson.version, EXPECTED_RELEASE_VERSION);
  assert.equal(cliPackageJson.version, EXPECTED_RELEASE_VERSION);
  assert.equal(packageLock.version, EXPECTED_RELEASE_VERSION);
  assert.equal(packageLock.packages[""].version, EXPECTED_RELEASE_VERSION);
});

test("shared v1 representations lock identity, pagination, errors, dates, and assignees", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const { parameters, schemas, securitySchemes } = contract.components;

  assert.match(
    securitySchemes.firebaseBearer.description,
    /Google and Apple\s+sign-in\s+providers/,
  );
  assert.match(
    securitySchemes.deletionStatusBearer.description,
    /never appears in a URL or log/,
  );
  const deletionStatus = contract.paths["/api/v1/me/deletion"].get;
  const deletionRefresh = contract.paths["/api/v1/me/deletion"].patch;
  const deletionPrepare = contract.paths["/api/v1/me/deletion"].put;
  const deletionStart = contract.paths["/api/v1/me/deletion"].post;
  assert.deepEqual(deletionStatus.security, [{ deletionStatusBearer: [] }]);
  assert.deepEqual(deletionRefresh.security, [{ deletionStatusBearer: [] }]);
  assert.equal(deletionStatus["x-openjob-authorization"], "capability");
  assert.equal(deletionRefresh["x-openjob-authorization"], "capability");
  assert.equal(deletionPrepare["x-openjob-authorization"], "authenticated");
  const statusBinding = deletionStart.parameters.find(
    ({ in: location, name }) =>
      location === "header" && name === "x-openjob-deletion-status",
  );
  assert.ok(statusBinding);
  assert.equal(statusBinding.required, true);
  assert.match(statusBinding.description, /exact capability returned by PUT/);
  assert.equal(
    schemas.AccountDeletionPending.required.includes("statusToken"),
    true,
  );
  assert.equal(
    schemas.AccountDeletionPending.required.includes(
      "reauthenticationProviders",
    ),
    true,
  );
  assert.equal(
    schemas.AccountDeletionStatusPending.required.includes(
      "reauthenticationProviders",
    ),
    true,
  );
  assert.equal(
    schemas.AccountDeletionPending.properties.reauthenticationProviders
      .uniqueItems,
    true,
  );
  assert.deepEqual(
    schemas.AccountDeletionPending.properties.reauthenticationProviders.items
      .enum,
    ["apple", "google"],
  );
  assert.deepEqual(
    schemas.AccountDeletionStatusNotStarted.required,
    ["status", "submissionExpired", "submissionExpiresAt"],
  );
  assert.equal(
    schemas.AccountDeletionStatusNotStarted.properties.submissionExpired.type,
    "boolean",
  );
  assert.deepEqual(Object.keys(deletionPrepare.responses).sort(), [
    "200",
    "202",
    "400",
    "401",
    "409",
    "429",
    "500",
    "503",
  ]);
  assert.deepEqual(Object.keys(deletionRefresh.responses).sort(), [
    "200",
    "202",
    "400",
    "401",
    "429",
    "500",
    "503",
  ]);
  assert.deepEqual(
    deletionRefresh.requestBody.content["application/json"].schema,
    schemas.RefreshAccountDeletionProviderInput,
  );
  assert.equal(Boolean(deletionStart.responses["410"]), true);
  assert.doesNotMatch(
    `${deletionStatus.description}\n${deletionRefresh.description}\n${deletionPrepare.description}\n${deletionStart.description}`,
    /15-minute|drain window|legacy clients/i,
  );
  assert.deepEqual(
    schemas.AccountDeletionStatus.oneOf
      .map(({ properties }) => properties.status.const)
      .sort(),
    ["completed", "not_started", "pending"],
  );
  assert.equal(
    schemas.AccountDeletionStatusToken.pattern,
    "^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
  );
  assert.match(
    schemas.AccountDeletionStatusToken.description,
    /browser localStorage/,
  );
  assert.doesNotMatch(
    schemas.AccountDeletionStatusToken.description,
    /protected local storage/,
  );
  assert.match(
    schemas.AccountDeletionStatusToken.description,
    /GET or PATCH Authorization[\s\S]*POST\s+x-openjob-deletion-status/,
  );
  const [googleRevocation, appleAccessRevocation, appleCodeRevocation] =
    schemas.AccountDeletionRevocationProof.oneOf;
  assert.deepEqual(googleRevocation.required, ["idToken", "kind", "value"]);
  assert.equal(googleRevocation.properties.idToken.writeOnly, true);
  assert.deepEqual(appleAccessRevocation.required, [
    "clientId",
    "kind",
    "value",
  ]);
  assert.deepEqual(appleCodeRevocation.required, [
    "clientId",
    "idToken",
    "kind",
    "value",
  ]);
  assert.equal(appleCodeRevocation.properties.redirectUri.writeOnly, true);
  const [googleCredential, appleCredential] =
    schemas.AccountDeletionCredentialInput.oneOf;
  assert.equal(googleCredential.properties.provider.const, "google");
  assert.deepEqual(
    googleCredential.properties.revocation,
    schemas.GoogleAccountDeletionRevocationProof,
  );
  assert.equal(appleCredential.properties.provider.const, "apple");
  assert.deepEqual(
    appleCredential.properties.revocation.oneOf,
    [
      schemas.AppleAccessTokenAccountDeletionRevocationProof,
      schemas.AppleAuthorizationCodeAccountDeletionRevocationProof,
    ],
  );
  const validateCredential = compileSchema(
    schemas.AccountDeletionCredentialInput,
  );
  assert.equal(validateCredential({
    credentialToken: "firebase-proof",
    provider: "google",
    revocation: {
      clientId: "dev.openjob.auth",
      kind: "access_token",
      value: "apple-access-token",
    },
  }), false);
  assert.equal(validateCredential({
    credentialToken: "firebase-proof",
    provider: "apple",
    revocation: {
      idToken: "google-id-token",
      kind: "access_token",
      value: "google-access-token",
    },
  }), false);
  assert.equal(contract.components.headers.NoStore.schema.const, "no-store");
  for (const responseName of [
    "AccountDeletionCompletedResponse",
    "AccountDeletionPendingResponse",
    "AccountDeletionStatusResponse",
    "AccountDeletionStatusTokenResponse",
    "AccountDeletionUnavailableResponse",
    "UnauthorizedResponse",
    "RateLimitedResponse",
    "InternalErrorResponse",
  ]) {
    assert.deepEqual(
      contract.components.responses[responseName].headers["Cache-Control"],
      contract.components.headers.NoStore,
      responseName,
    );
  }
  assert.match(
    contract.components.responses.UnauthorizedResponse.description,
    /deletion status requires its opaque\s+device-held capability/,
  );
  assert.deepEqual(
    [parameters.Limit.schema.default, parameters.Limit.schema.maximum],
    [100, 500],
  );
  assert.equal(parameters.Cursor.name, "cursor");
  for (const name of [
    "BanEnvelope",
    "CurrentUserEnvelope",
    "GroupEnvelope",
    "InviteLinkEnvelope",
    "InvitePreviewEnvelope",
    "MemberEnvelope",
    "NotificationSubscriptionEnvelope",
    "SignInMethodCollectionEnvelope",
    "TaskEnvelope",
  ]) {
    assert.deepEqual(schemas[name].required, ["data"], name);
  }
  for (const name of [
    "BanCollectionEnvelope",
    "GroupCollectionEnvelope",
    "MemberCollectionEnvelope",
    "TaskCollectionEnvelope",
  ]) {
    assert.deepEqual(schemas[name].required, ["data", "nextCursor"], name);
  }

  assert.equal(schemas.Date.format, "date");
  assert.equal(schemas.Timestamp.format, "date-time");
  assert.deepEqual(schemas.TaskPriority.enum, ["high", "normal", "low"]);
  assert.deepEqual(
    schemas.Assignee.oneOf.map(({ properties }) => properties.state.const).sort(),
    ["assigned", "deleted", "unassigned"],
  );
  assert.deepEqual(schemas.AssignedAssignee.required, ["state", "userId", "username"]);
  assert.deepEqual(schemas.UnassignedAssignee.required, ["state"]);
  assert.deepEqual(schemas.DeletedAssignee.required, ["state"]);
  assert.deepEqual(schemas.NotificationSubscription.required, ["installationId", "state"]);
  assert.equal(Object.hasOwn(schemas.NotificationSubscription.properties, "endpoint"), false);
  assert.equal(Object.hasOwn(schemas.NotificationSubscription.properties, "keys"), false);
  assert.deepEqual(schemas.SignInProvider.enum, ["apple", "google"]);
  assert.equal(
    schemas.LinkSignInMethodInput.properties.credentialToken.writeOnly,
    true,
  );
  const linkOperation =
    contract.paths["/api/v1/me/sign-in-methods"].post;
  const listSignInMethodsOperation =
    contract.paths["/api/v1/me/sign-in-methods"].get;
  assert.match(
    linkOperation.description,
    /Authorization always carries the current primary session/,
  );
  assert.match(
    linkOperation.description,
    /credentialToken always\s+carries the freshly authenticated additional provider proof/,
  );
  assert.match(
    linkOperation.description,
    /expectedTargetUserId binds the confirmation/,
  );
  assert.match(
    contract.components.responses.LinkSignInMethodConflictResponse.description,
    /link_target_changed/,
  );
  assert.ok(listSignInMethodsOperation.responses["410"]);
  assert.ok(linkOperation.responses["410"]);

  const requiredConflictCodes = [
    "assignee_not_member",
    "confirmation_mismatch",
    "fresh_authentication_required",
    "last_admin",
    "link_target_changed",
    "open_tasks_assigned",
    "sign_in_method_conflict",
    "sign_in_method_unrecognized",
    "task_done",
    "username_immutable",
    "username_taken",
  ];
  for (const code of requiredConflictCodes) {
    assert.ok(schemas.ErrorCode.enum.includes(code), `ErrorCode includes ${code}`);
  }

  const taskList = contract.paths["/api/v1/groups/{groupId}/tasks"].get;
  assert.deepEqual(
    taskList.parameters.map(({ name }) => name),
    ["status", "assignee", "cursor", "limit", "If-None-Match"],
  );
  assert.equal(taskList.parameters[0].schema.default, "open");
  assert.equal(taskList.parameters[4].in, "header");
  assert.equal(taskList.parameters[4].required, false);
  assert.equal(taskList.responses["304"].headers.ETag.required, true);
  assert.equal(
    contract.components.responses.TaskCollectionResponse.headers.ETag.required,
    true,
  );
  assert.match(taskList.description, /taskId ascending/);
  const taskItem = contract.paths["/api/v1/groups/{groupId}/tasks/{taskId}"];
  const taskState =
    contract.paths["/api/v1/groups/{groupId}/tasks/{taskId}/state"].put;
  assert.deepEqual(
    {
      get: taskItem.get["x-openjob-retryable"],
      patch: taskItem.patch["x-openjob-retryable"],
      delete: taskItem.delete["x-openjob-retryable"],
      state: taskState["x-openjob-retryable"],
    },
    { get: true, patch: false, delete: false, state: true },
  );
  assert.equal(taskItem.delete.responses["204"].content, undefined);
  assert.equal(
    contract.components.responses.InvalidInviteResponse.content["application/json"].example
      .error.code,
    "invite_not_found",
  );
  assert.equal(
    contract.components.responses.MembershipDeniedResponse.content["application/json"]
      .example.error.code,
    "membership_denied",
  );
  assert.deepEqual(
    Object.keys(
      contract.components.responses.TaskCollectionResponse.content["application/json"]
        .examples,
    ).sort(),
    ["assigned", "done", "unassigned"],
  );
});

test("contract schemas enforce normalized domain rules and status-specific errors", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const { responses, schemas } = contract.components;

  assert.equal(compileSchema(schemas.GroupName)("   "), false);
  assert.equal(
    compileSchema(schemas.Member)({
      userId: "user_onboarding",
      username: null,
      role: "admin",
      joinedAt: "2026-07-15T12:00:00Z",
    }),
    true,
  );
  assert.equal(
    compileSchema(schemas.Ban)({
      userId: "user_onboarding",
      username: null,
      bannedAt: "2026-07-15T12:00:00Z",
    }),
    true,
  );
  assert.equal(compileSchema(schemas.GroupName)("Alpha\u2028Beta"), false);
  assert.equal(compileSchema(schemas.TaskText)("\n\n"), false);
  assert.equal(Object.hasOwn(schemas.Task.properties, "updatedAt"), false);
  assert.equal(
    compileSchema(schemas.Task)({
      taskId: "task_recovery_done",
      groupId: "grp_acme_ops",
      text: "Finish recovered work",
      assignee: { state: "unassigned" },
      priority: "normal",
      dueDate: null,
      state: "done",
      createdAt: "2026-07-15T16:00:00Z",
      completedAt: "2026-07-16T10:00:00Z",
    }),
    true,
  );

  const unauthorizedSchema = responses.UnauthorizedResponse.content["application/json"].schema;
  assert.equal(
    compileSchema(unauthorizedSchema)({
      error: { code: "task_done", message: "Wrong status mapping.", requestId: "req_1" },
    }),
    false,
  );
  const signInConflictOperations = [
    "getPersonalWorkspace",
    "getProviderPreview",
    "commandPersonalWorkspace",
    "listPersonalAgentGrants",
    "createPersonalAgentGrant",
    "revokePersonalAgentGrant",
    "createAgentGrant",
    "listAgentGrants",
    "revokeAgentGrant",
    "banGroupUser",
    "claimUsername",
    "createCurrentUser",
    "createGroup",
    "createGroupTask",
    "deleteCurrentUser",
    "deleteGroupTask",
    "demoteGroupMember",
    "endGroup",
    "getGroup",
    "getGroupInviteLink",
    "getGroupTask",
    "getMe",
    "getNotificationSubscription",
    "inspectInviteLink",
    "joinGroupWithInviteLink",
    "kickGroupMember",
    "leaveGroup",
    "linkSignInMethod",
    "listGroupBans",
    "listGroupMembers",
    "listGroupTasks",
    "listGroups",
    "listSignInMethods",
    "mintAccountDeletionStatusToken",
    "promoteGroupMember",
    "registerNotificationSubscription",
    "renameGroup",
    "rotateGroupInviteLink",
    "setGroupTaskState",
    "setNotificationSubscriptionState",
    "unbanGroupUser",
    "updateGroupTask",
  ];
  const expectedConflictCodes = new Map(
    signInConflictOperations.map((operationId) => [
      operationId,
      ["sign_in_method_unrecognized"],
    ]),
  );
  const domainConflictCodes = new Map([
    ["getPersonalWorkspace", ["conflict"]],
    ["getProviderPreview", ["provider_unavailable"]],
    ["commandPersonalWorkspace", ["conflict"]],
    ["listPersonalAgentGrants", ["conflict"]],
    ["createPersonalAgentGrant", ["conflict"]],
    ["revokePersonalAgentGrant", ["conflict"]],
    ["banGroupUser", ["ban_not_allowed", "last_admin", "self_removal"]],
    ["claimUsername", ["username_immutable", "username_taken"]],
    ["createGroupTask", ["assignee_not_member"]],
    ["demoteGroupMember", ["last_admin", "member_role_conflict"]],
    ["endGroup", ["confirmation_mismatch", "members_remain"]],
    ["joinGroupWithInviteLink", ["username_required"]],
    ["kickGroupMember", ["last_admin", "self_removal"]],
    ["leaveGroup", ["last_admin", "open_tasks_assigned"]],
    ["linkSignInMethod", ["sign_in_method_conflict"]],
    ["promoteGroupMember", ["member_role_conflict"]],
    ["updateGroupTask", ["assignee_not_member", "task_done"]],
  ]);
  for (const [operationId, codes] of domainConflictCodes) {
    expectedConflictCodes.get(operationId).push(...codes);
  }
  const allConflictCodes = new Set([...expectedConflictCodes.values()].flat());
  const conflictOperations = operations(contract).filter(
    ({ operation }) => operation.responses["409"],
  );
  assert.deepEqual(
    conflictOperations.map(({ operation }) => operation.operationId).sort(),
    [...expectedConflictCodes.keys()].sort(),
  );
  for (const { operation } of conflictOperations) {
    const validate = compileSchema(
      operation.responses["409"].content["application/json"].schema,
    );
    const allowed = expectedConflictCodes.get(operation.operationId);
    for (const code of allConflictCodes) {
      assert.equal(
        validate({ error: { code, message: "Conflict.", requestId: "req_2" } }),
        allowed.includes(code),
        `${operation.operationId} maps ${code}`,
      );
    }
  }
});

test("personal workspace schemas accept only Task/Calendar commands and provider-free views", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const { schemas } = contract.components;
  const validateCommand = compileSchema(schemas.PersonalWorkspaceCommand);
  const interval = { start: "2026-07-15T15:00:00Z", end: "2026-07-15T15:30:00Z" };
  const commands = [
    { type: "task.create", title: "Review the plan" },
    { type: "task.update", taskId: "task_a", title: "Updated plan" },
    { type: "task.complete", taskId: "task_a", completed: true },
    { type: "task.schedule", taskId: "task_a", calendarId: "personal", ...interval },
    { type: "task.unschedule", taskId: "task_a" },
    { type: "task.delete", taskId: "task_a" },
    { type: "calendar.create", calendarId: "personal", title: "Focus", ...interval },
    { type: "calendar.update", eventId: "event_a", title: "Revised focus", ...interval },
    { type: "calendar.delete", eventId: "event_a" },
  ];
  assert.equal(schemas.PersonalWorkspaceCommand.oneOf.length, 9);
  for (const command of commands) {
    assert.equal(validateCommand(command), true, command.type);
    assert.equal(validateCommand({ ...command, ownerId: "foreign_user" }), false, `${command.type} cannot override owner`);
    assert.equal(validateCommand({ ...command, credential: "private" }), false, `${command.type} cannot carry credentials`);
  }
  for (const command of [
    { type: "task.create", title: "Private", messageId: "mail_a" },
    { type: "task.complete", taskId: "task_a", completed: "true" },
    { type: "task.schedule", taskId: "task_a", calendarId: "personal", start: "tomorrow", end: "later" },
    { type: "mail.send", draftId: "draft_a" },
    { type: "agent.grant", name: "Unknown agent", scopes: ["tasks:write"] },
  ]) assert.equal(validateCommand(command), false, command.type);

  const validateView = compileSchema(schemas.PersonalWorkspaceView);
  const view = {
    accounts: [], messages: [], drafts: [], sent: [], agents: [],
    tasks: [{ id: "task_a", ownerId: "user_a", title: "Review", completed: false }],
    calendars: [{ id: "personal", ownerId: "user_a", name: "Personal", color: "#2454dc" }],
    events: [{ id: "event_a", calendarId: "personal", title: "Focus", ...interval }],
    activity: [{ id: "activity_a", ownerId: "user_a", actor: "You", action: "task.create", createdAt: interval.start }],
  };
  assert.equal(validateView(view), true);
  for (const field of ["accounts", "messages", "drafts", "sent", "agents"]) {
    assert.equal(validateView({ ...view, [field]: [{ id: "private_provider_record" }] }), false, `${field} must stay empty`);
  }
  assert.equal(validateView({ ...view, tasks: [{ ...view.tasks[0], sourceMessageId: "private_mail" }] }), false);
  assert.equal(validateView({ ...view, calendars: [{ ...view.calendars[0], accountId: "provider_mailbox" }] }), false);
  assert.equal(validateView({ ...view, activity: [{ ...view.activity[0], action: "mail.send" }] }), false);
  assert.equal(validateView({ ...view, unexpectedCredentials: "private" }), false);
  assert.equal(contract.paths["/api/v1/workspace/snapshot"].get["x-openjob-retryable"], true);
  assert.equal(contract.paths["/api/v1/workspace/commands"].post["x-openjob-retryable"], false);
  const agentId = "agt_" + "a".repeat(32);
  assert.equal(validateView({ ...view, activity: [{ ...view.activity[0], actor: `Agent ${agentId}` }] }), true);
  assert.equal(validateView({ ...view, activity: [{ ...view.activity[0], actor: "Untrusted actor text" }] }), false);
  const validateGrantInput = compileSchema(schemas.PersonalAgentGrantInput);
  const grantInput = { name: "Personal planner", scopes: ["tasks:read", "tasks:write"], resourceIds: ["tasks:personal"] };
  assert.equal(validateGrantInput(grantInput), true);
  for (const invalid of [
    { ...grantInput, scopes: ["mail:read"] },
    { ...grantInput, scopes: ["tasks:read", "tasks:read"] },
    { ...grantInput, resourceIds: ["grp_private"] },
    { ...grantInput, ownerUserId: "foreign_user" },
    { ...grantInput, name: "Bad\nname" },
  ]) assert.equal(validateGrantInput(invalid), false);
  const publicGrant = { ...grantInput, id: agentId, ownerUserId: "user_a", createdAt: interval.start, expiresAt: "2026-07-16T15:00:00Z", revoked: false };
  const validateGrant = compileSchema(schemas.PersonalAgentGrant);
  assert.equal(validateGrant(publicGrant), true);
  assert.equal(validateGrant({ ...publicGrant, tokenHash: "private" }), false);
  assert.equal(validateGrant({ ...publicGrant, token: "private" }), false);
  const validateResult = compileSchema(schemas.PersonalWorkspaceCommandResult);
  assert.equal(validateResult({ id: "task_a", updated: true }), true);
  assert.equal(validateResult({ id: "task_a", updated: true, title: "Unpermitted read" }), false);
  for (const path of ["/api/v1/workspace/snapshot", "/api/v1/workspace/commands"]) {
    const operation = contract.paths[path][path.endsWith("snapshot") ? "get" : "post"];
    assert.deepEqual(operation.security, [{ firebaseBearer: [] }, { personalWorkspaceAgentBearer: [] }]);
    assert.match(operation.description, /No human credential fallback/);
  }
  assert.equal(contract.paths["/api/v1/workspace/agent-grants"].post["x-openjob-retryable"], false);
  assert.equal(contract.paths["/api/v1/workspace/agent-grants/{agentId}"].delete.responses["204"].content, undefined);
});

test("provider preview response schemas preserve opaque Unicode upstream identities in qualified references", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const validate = compileSchema(contract.paths["/api/v1/workspace/provider-preview"].get.responses["200"].content["application/json"].schema);
  const data = await createProviderPreview({ ownerId: "schema_fixture" });
  const accountId = data.selectedAccountId;
  const upstream = "漢".repeat(256);
  const reference = kind => createProviderResourceRef(accountId, kind, upstream);
  assert.ok(reference("message").length > 512);
  data.messages[0] = { ...data.messages[0], id: reference("message"), upstreamId: upstream, threadId: reference("thread"), upstreamThreadId: upstream, folderIds: [reference("folder")] };
  data.folders[0] = { ...data.folders[0], id: reference("folder"), upstreamId: upstream };
  data.calendars[0] = { ...data.calendars[0], id: reference("calendar"), upstreamId: upstream };
  data.events[0] = { ...data.events[0], id: reference("event"), upstreamId: upstream, calendarId: reference("calendar") };
  assert.equal(validate({ data }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ data: { ...data, messages: [{ ...data.messages[0], id: "x".repeat(3073) }] } }), false);
  assert.equal(validate({ data: { ...data, messages: [{ ...data.messages[0], upstreamId: upstream + "漢" }] } }), false);
});

test("validation rejects broken operations and examples", async () => {
  const source = await readFile(contractUrl, "utf8");

  const missingResponses = parse(source);
  delete missingResponses.paths["/api/v1/me"].get.responses;
  await assert.rejects(
    validateOpenApiContract(missingResponses),
    /responses|valid OpenAPI/i,
  );

  const invalidExample = parse(source);
  invalidExample.components.responses.CurrentUserResponse.content[
    "application/json"
  ].example.data.userId = 42;
  await assert.rejects(
    validateOpenApiContract(invalidExample),
    /CurrentUserResponse.*example.*userId/i,
  );

  const invalidParameterExample = parse(source);
  invalidParameterExample.components.parameters.GroupId.example = 42;
  await assert.rejects(
    validateOpenApiContract(invalidParameterExample),
    /parameters\.GroupId.*example/i,
  );
});
