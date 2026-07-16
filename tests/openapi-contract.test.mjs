import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { validateOpenApiContract } from "../scripts/validate-openapi.mjs";

const contractUrl = new URL("../openapi/openapi.yaml", import.meta.url);

const expectedOperations = [
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
  "patch /api/v1/groups/{groupId} renameGroup",
  "patch /api/v1/groups/{groupId}/tasks/{taskId} updateGroupTask",
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
  "put /api/v1/groups/{groupId}/tasks/{taskId}/state setGroupTaskState",
  "put /api/v1/me/username claimUsername",
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
  assert.equal(Object.keys(contract.paths).length, 20);
  assert.deepEqual(
    actualOperations
      .map(({ method, path, operation }) => `${method} ${path} ${operation.operationId}`)
      .sort(),
    expectedOperations,
  );
  assert.deepEqual(contract.security, [{ firebaseBearer: [] }]);
  assert.equal(contract.components.securitySchemes.firebaseBearer.scheme, "bearer");

  for (const { method, path, operation } of actualOperations) {
    const location = `${method.toUpperCase()} ${path}`;
    assert.match(operation.operationId, /^[a-z][A-Za-z0-9]+$/, location);
    assert.match(operation["x-openjob-authorization"], /^(authenticated|member|admin)$/, location);
    assert.equal(typeof operation["x-openjob-retryable"], "boolean", location);

    for (const status of ["401", "429", "500"]) {
      assert.ok(operation.responses[status], `${location} declares ${status}`);
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

test("release metadata identifies the hosted backend as v0.0.5", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const packageLock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  );

  assert.equal(contract.info.version, "0.0.5");
  assert.equal(packageJson.version, "0.0.5");
  assert.equal(packageLock.version, "0.0.5");
  assert.equal(packageLock.packages[""].version, "0.0.5");
});

test("shared v1 representations lock identity, pagination, errors, dates, and assignees", async () => {
  const contract = await validateOpenApiContract(contractUrl);
  const { parameters, schemas, securitySchemes } = contract.components;

  assert.match(securitySchemes.firebaseBearer.description, /Google sign-in\s+provider/);
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
  assert.deepEqual(
    schemas.Assignee.oneOf.map(({ properties }) => properties.state.const).sort(),
    ["assigned", "unassigned"],
  );
  assert.deepEqual(schemas.AssignedAssignee.required, ["state", "userId", "username"]);
  assert.deepEqual(schemas.UnassignedAssignee.required, ["state"]);

  const requiredConflictCodes = [
    "assignee_not_member",
    "confirmation_mismatch",
    "last_admin",
    "open_tasks_assigned",
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
    ["status", "assignee", "cursor", "limit"],
  );
  assert.equal(taskList.parameters[0].schema.default, "open");
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
  const expectedConflictCodes = new Map([
    ["banGroupUser", ["ban_not_allowed", "last_admin", "self_removal"]],
    ["claimUsername", ["username_immutable", "username_taken"]],
    ["createGroupTask", ["assignee_not_member"]],
    ["demoteGroupMember", ["last_admin", "member_role_conflict"]],
    ["endGroup", ["confirmation_mismatch", "members_remain"]],
    ["joinGroupWithInviteLink", ["username_required"]],
    ["kickGroupMember", ["last_admin", "self_removal"]],
    ["leaveGroup", ["last_admin", "open_tasks_assigned"]],
    ["promoteGroupMember", ["member_role_conflict"]],
    ["updateGroupTask", ["assignee_not_member", "task_done"]],
  ]);
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
