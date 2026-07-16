function assertStatus(response, expected, method, path) {
  if (response.status !== expected) {
    throw new Error(`${method} ${path} returned ${response.status}; expected ${expected}.`);
  }
}

async function responseData(response) {
  if (response.status === 204) return null;
  return (await response.clone().json()).data;
}

export async function runV1AcceptanceScenario({
  proposedUsernames,
  request,
  validate,
}) {
  if (typeof request !== "function" || typeof validate !== "function") {
    throw new TypeError("request and validate must be functions.");
  }
  const successfulOperations = new Set();

  async function expectSuccess({
    as,
    body,
    contractPath,
    method,
    path,
    status,
  }) {
    const response = await request({ as, body, method, path });
    assertStatus(response, status, method, path);
    await validate(response, contractPath, method.toLowerCase());
    successfulOperations.add(`${method.toLowerCase()} ${contractPath}`);
    return responseData(response);
  }

  async function expectError({
    as,
    body,
    contractPath,
    method,
    path,
    status,
  }) {
    const response = await request({ as, body, method, path });
    assertStatus(response, status, method, path);
    await validate(response, contractPath, method.toLowerCase());
    return response.clone().json();
  }

  async function claimIdentity(as, proposedUsername) {
    const current = await expectSuccess({
      as,
      contractPath: "/api/v1/me",
      method: "GET",
      path: "/api/v1/me",
      status: 200,
    });
    return expectSuccess({
      as,
      body: { username: current.username ?? proposedUsername },
      contractPath: "/api/v1/me/username",
      method: "PUT",
      path: "/api/v1/me/username",
      status: 200,
    });
  }

  const first = await claimIdentity("first", proposedUsernames.first);
  const second = await claimIdentity("second", proposedUsernames.second);
  const groupName = `OpenJob v0.0.5 acceptance ${Date.now()}`;
  const group = await expectSuccess({
    as: "first",
    body: { name: groupName },
    contractPath: "/api/v1/groups",
    method: "POST",
    path: "/api/v1/groups",
    status: 201,
  });
  const groupPath = `/api/v1/groups/${group.groupId}`;

  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups",
    method: "GET",
    path: "/api/v1/groups?limit=1",
    status: 200,
  });
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}",
    method: "GET",
    path: groupPath,
    status: 200,
  });

  const initialInvite = await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/invite-link",
    method: "GET",
    path: `${groupPath}/invite-link`,
    status: 200,
  });
  await expectSuccess({
    as: "second",
    contractPath: "/api/v1/invites/{token}",
    method: "GET",
    path: `/api/v1/invites/${initialInvite.token}`,
    status: 200,
  });
  const invite = await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/invite-link/actions/rotate",
    method: "POST",
    path: `${groupPath}/invite-link/actions/rotate`,
    status: 200,
  });
  await expectSuccess({
    as: "second",
    contractPath: "/api/v1/invites/{token}/actions/join",
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
    status: 200,
  });
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/members",
    method: "GET",
    path: `${groupPath}/members`,
    status: 200,
  });

  const tasksPath = `${groupPath}/tasks`;
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "GET",
    path: tasksPath,
    status: 200,
  });
  const task = await expectSuccess({
    as: "second",
    body: {
      text: "Prove the hosted backend",
      assigneeUsername: first.username,
      dueDate: "2026-07-31",
    },
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "POST",
    path: tasksPath,
    status: 201,
  });
  const taskPath = `${tasksPath}/${task.taskId}`;
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
    method: "GET",
    path: taskPath,
    status: 200,
  });
  await expectSuccess({
    as: "second",
    body: {
      text: "Prove and ship the hosted backend",
      assigneeUsername: second.username,
      dueDate: null,
    },
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
    method: "PATCH",
    path: taskPath,
    status: 200,
  });
  await expectSuccess({
    as: "first",
    body: { state: "done" },
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}/state",
    method: "PUT",
    path: `${taskPath}/state`,
    status: 200,
  });
  await expectSuccess({
    as: "first",
    body: { state: "open" },
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}/state",
    method: "PUT",
    path: `${taskPath}/state`,
    status: 200,
  });
  await expectSuccess({
    as: "second",
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
    method: "DELETE",
    path: taskPath,
    status: 204,
  });

  const memberPath = `${groupPath}/members/${second.userId}`;
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    method: "POST",
    path: `${memberPath}/actions/promote`,
    status: 200,
  });
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/members/{userId}/actions/demote",
    method: "POST",
    path: `${memberPath}/actions/demote`,
    status: 200,
  });
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/members/{userId}/actions/kick",
    method: "POST",
    path: `${memberPath}/actions/kick`,
    status: 204,
  });
  await expectError({
    as: "second",
    contractPath: "/api/v1/groups/{groupId}",
    method: "GET",
    path: groupPath,
    status: 404,
  });

  const bansPath = `${groupPath}/bans`;
  await expectSuccess({
    as: "first",
    body: { userId: second.userId },
    contractPath: "/api/v1/groups/{groupId}/bans/actions/ban",
    method: "POST",
    path: `${bansPath}/actions/ban`,
    status: 201,
  });
  await expectError({
    as: "second",
    contractPath: "/api/v1/invites/{token}/actions/join",
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
    status: 403,
  });
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/bans",
    method: "GET",
    path: bansPath,
    status: 200,
  });
  await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups/{groupId}/bans/{userId}/actions/unban",
    method: "POST",
    path: `${bansPath}/${second.userId}/actions/unban`,
    status: 204,
  });
  await expectSuccess({
    as: "second",
    contractPath: "/api/v1/invites/{token}/actions/join",
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
    status: 200,
  });
  await expectSuccess({
    as: "second",
    contractPath: "/api/v1/groups/{groupId}/actions/leave",
    method: "POST",
    path: `${groupPath}/actions/leave`,
    status: 204,
  });

  const renamedGroup = await expectSuccess({
    as: "first",
    body: { name: `${groupName} verified` },
    contractPath: "/api/v1/groups/{groupId}",
    method: "PATCH",
    path: groupPath,
    status: 200,
  });

  const unauthenticatedExamples = [
    ["GET", "/api/v1/me", "/api/v1/me"],
    ["PUT", "/api/v1/me/username", "/api/v1/me/username", { username: first.username }],
    ["GET", "/api/v1/groups", "/api/v1/groups"],
    ["POST", "/api/v1/groups", "/api/v1/groups", { name: "Denied" }],
    ["GET", "/api/v1/groups/{groupId}", groupPath],
    ["PATCH", "/api/v1/groups/{groupId}", groupPath, { name: renamedGroup.name }],
    ["POST", "/api/v1/groups/{groupId}/actions/leave", `${groupPath}/actions/leave`],
    ["POST", "/api/v1/groups/{groupId}/actions/end", `${groupPath}/actions/end`, { confirmationName: renamedGroup.name }],
    ["GET", "/api/v1/groups/{groupId}/members", `${groupPath}/members`],
    ["POST", "/api/v1/groups/{groupId}/members/{userId}/actions/kick", `${memberPath}/actions/kick`],
    ["POST", "/api/v1/groups/{groupId}/members/{userId}/actions/promote", `${memberPath}/actions/promote`],
    ["POST", "/api/v1/groups/{groupId}/members/{userId}/actions/demote", `${memberPath}/actions/demote`],
    ["GET", "/api/v1/groups/{groupId}/bans", bansPath],
    ["POST", "/api/v1/groups/{groupId}/bans/actions/ban", `${bansPath}/actions/ban`, { userId: second.userId }],
    ["POST", "/api/v1/groups/{groupId}/bans/{userId}/actions/unban", `${bansPath}/${second.userId}/actions/unban`],
    ["GET", "/api/v1/groups/{groupId}/invite-link", `${groupPath}/invite-link`],
    ["POST", "/api/v1/groups/{groupId}/invite-link/actions/rotate", `${groupPath}/invite-link/actions/rotate`],
    ["GET", "/api/v1/invites/{token}", `/api/v1/invites/${invite.token}`],
    ["POST", "/api/v1/invites/{token}/actions/join", `/api/v1/invites/${invite.token}/actions/join`],
    ["GET", "/api/v1/groups/{groupId}/tasks", tasksPath],
    ["POST", "/api/v1/groups/{groupId}/tasks", tasksPath, { text: "Denied", assigneeUsername: first.username }],
    ["GET", "/api/v1/groups/{groupId}/tasks/{taskId}", taskPath],
    ["PATCH", "/api/v1/groups/{groupId}/tasks/{taskId}", taskPath, { text: "Denied" }],
    ["DELETE", "/api/v1/groups/{groupId}/tasks/{taskId}", taskPath],
    ["PUT", "/api/v1/groups/{groupId}/tasks/{taskId}/state", `${taskPath}/state`, { state: "done" }],
  ];
  for (const [method, contractPath, path, body] of unauthenticatedExamples) {
    const response = await request({ body, method, path });
    assertStatus(response, 401, method, path);
    await validate(response, contractPath, method.toLowerCase());
  }

  await expectSuccess({
    as: "first",
    body: { confirmationName: renamedGroup.name },
    contractPath: "/api/v1/groups/{groupId}/actions/end",
    method: "POST",
    path: `${groupPath}/actions/end`,
    status: 204,
  });
  const finalGroups = await expectSuccess({
    as: "first",
    contractPath: "/api/v1/groups",
    method: "GET",
    path: "/api/v1/groups",
    status: 200,
  });
  if (finalGroups.some(({ groupId }) => groupId === group.groupId)) {
    throw new Error("The disposable acceptance Group remained visible after End Group.");
  }

  return {
    endedGroupId: group.groupId,
    operationCount: successfulOperations.size,
  };
}
