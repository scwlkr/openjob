function assertStatus(response, expected, method, path) {
  if (response.status !== expected) {
    throw new Error(`${method} ${path} returned ${response.status}; expected ${expected}.`);
  }
}

async function responseData(response) {
  if (response.status === 204) return null;
  return (await response.clone().json()).data;
}

function assertExactPagedIds(pages, idKey, expectedIds, label) {
  const actualIds = pages.flatMap(({ data }) => data).map((item) => item[idKey]);
  if (actualIds.join(",") !== [...expectedIds].sort().join(",")) {
    throw new Error(`${label} pagination skipped or duplicated a ${label}.`);
  }
}

export async function runV1AcceptanceScenario({
  checkpoint = async () => {},
  proposedUsernames,
  request,
  validate,
}) {
  if (typeof request !== "function" || typeof validate !== "function") {
    throw new TypeError("request and validate must be functions.");
  }
  const successfulOperations = new Set();

  async function expectSuccess({
    actor,
    body,
    contractPath,
    method,
    path,
    status,
    envelope = false,
  }) {
    const response = await request({ actor, body, method, path });
    assertStatus(response, status, method, path);
    await validate(response, contractPath, method.toLowerCase());
    successfulOperations.add(`${method.toLowerCase()} ${contractPath}`);
    return envelope ? response.clone().json() : responseData(response);
  }

  async function expectError({
    actor,
    body,
    contractPath,
    method,
    path,
    status,
  }) {
    const response = await request({ actor, body, method, path });
    assertStatus(response, status, method, path);
    await validate(response, contractPath, method.toLowerCase());
    return response.clone().json();
  }

  async function claimIdentity(actor, proposedUsername) {
    const current = await expectSuccess({
      actor,
      contractPath: "/api/v1/me",
      method: "GET",
      path: "/api/v1/me",
      status: 200,
    });
    return expectSuccess({
      actor,
      body: { username: current.username ?? proposedUsername },
      contractPath: "/api/v1/me/username",
      method: "PUT",
      path: "/api/v1/me/username",
      status: 200,
    });
  }

  const initialAdmin = await claimIdentity("initialAdmin", proposedUsernames.initialAdmin);
  const memberUser = await claimIdentity("memberUser", proposedUsernames.memberUser);
  const installationId = "installation_backend_acceptance_01";
  const notificationContractPath =
    "/api/v1/me/notification-subscriptions/{installationId}";
  const notificationPath =
    `/api/v1/me/notification-subscriptions/${installationId}`;
  const capability = {
    endpoint: "https://push.example.test/subscriptions/backend-acceptance-capability",
    keys: {
      p256dh: "p256dh_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG",
      auth: "auth_0123456789abcdef",
    },
  };
  await expectError({
    actor: "initialAdmin",
    contractPath: notificationContractPath,
    method: "GET",
    path: notificationPath,
    status: 404,
  });
  await expectSuccess({
    actor: "initialAdmin",
    body: capability,
    contractPath: notificationContractPath,
    method: "PUT",
    path: notificationPath,
    status: 200,
  });
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: notificationContractPath,
    method: "GET",
    path: notificationPath,
    status: 200,
  });
  await expectError({
    actor: "memberUser",
    contractPath: notificationContractPath,
    method: "GET",
    path: notificationPath,
    status: 404,
  });
  await expectSuccess({
    actor: "initialAdmin",
    body: { state: "paused" },
    contractPath: notificationContractPath,
    method: "PATCH",
    path: notificationPath,
    status: 200,
  });
  const groupName = `OpenJob backend acceptance ${Date.now()}`;
  const group = await expectSuccess({
    actor: "initialAdmin",
    body: { name: groupName },
    contractPath: "/api/v1/groups",
    method: "POST",
    path: "/api/v1/groups",
    status: 201,
  });
  const groupPath = `/api/v1/groups/${group.groupId}`;
  const paginationGroup = await expectSuccess({
    actor: "initialAdmin",
    body: { name: `${groupName} pagination` },
    contractPath: "/api/v1/groups",
    method: "POST",
    path: "/api/v1/groups",
    status: 201,
  });
  const firstGroupPage = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups",
    envelope: true,
    method: "GET",
    path: "/api/v1/groups?limit=1",
    status: 200,
  });
  if (firstGroupPage.data.length !== 1 || !firstGroupPage.nextCursor) {
    throw new Error("Group pagination did not return one row and a cursor.");
  }
  const secondGroupPage = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups",
    envelope: true,
    method: "GET",
    path: `/api/v1/groups?limit=1&cursor=${encodeURIComponent(firstGroupPage.nextCursor)}`,
    status: 200,
  });
  if (secondGroupPage.data.length !== 1 || secondGroupPage.nextCursor !== null) {
    throw new Error("Group pagination did not terminate after the second row.");
  }
  assertExactPagedIds(
    [firstGroupPage, secondGroupPage],
    "groupId",
    [group.groupId, paginationGroup.groupId],
    "Group",
  );
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}",
    method: "GET",
    path: groupPath,
    status: 200,
  });

  const initialInvite = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/invite-link",
    method: "GET",
    path: `${groupPath}/invite-link`,
    status: 200,
  });
  await expectSuccess({
    actor: "memberUser",
    contractPath: "/api/v1/invites/{token}",
    method: "GET",
    path: `/api/v1/invites/${initialInvite.token}`,
    status: 200,
  });
  const invite = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/invite-link/actions/rotate",
    method: "POST",
    path: `${groupPath}/invite-link/actions/rotate`,
    status: 200,
  });
  await expectSuccess({
    actor: "memberUser",
    contractPath: "/api/v1/invites/{token}/actions/join",
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
    status: 200,
  });
  const firstMemberPage = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/members",
    envelope: true,
    method: "GET",
    path: `${groupPath}/members?limit=1`,
    status: 200,
  });
  if (firstMemberPage.data.length !== 1 || !firstMemberPage.nextCursor) {
    throw new Error("Member pagination did not return one row and a cursor.");
  }
  const secondMemberPage = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/members",
    envelope: true,
    method: "GET",
    path: `${groupPath}/members?limit=1&cursor=${encodeURIComponent(firstMemberPage.nextCursor)}`,
    status: 200,
  });
  if (secondMemberPage.data.length !== 1 || secondMemberPage.nextCursor !== null) {
    throw new Error("Member pagination did not terminate after the second row.");
  }
  assertExactPagedIds(
    [firstMemberPage, secondMemberPage],
    "userId",
    [initialAdmin.userId, memberUser.userId],
    "Member",
  );

  const tasksPath = `${groupPath}/tasks`;
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "GET",
    path: tasksPath,
    status: 200,
  });
  const task = await expectSuccess({
    actor: "memberUser",
    body: {
      text: "Prove the hosted backend",
      assigneeUsername: initialAdmin.username,
      dueDate: "2026-07-31",
    },
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "POST",
    path: tasksPath,
    status: 201,
  });
  const earlierDueTask = await expectSuccess({
    actor: "memberUser",
    body: {
      text: "Prove pagination and ordering",
      assigneeUsername: memberUser.username,
      dueDate: "2026-07-20",
    },
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "POST",
    path: tasksPath,
    status: 201,
  });
  const undatedTask = await expectSuccess({
    actor: "initialAdmin",
    body: {
      text: "Prove undated ordering",
      assigneeUsername: initialAdmin.username,
    },
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "POST",
    path: tasksPath,
    status: 201,
  });
  await checkpoint();
  const initialAdminTasks = [task, undatedTask];
  const memberUserTasks = [earlierDueTask];
  const expectedTaskOrder =
    initialAdmin.username < memberUser.username
      ? [...initialAdminTasks, ...memberUserTasks]
      : [...memberUserTasks, ...initialAdminTasks];
  const firstTaskPage = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/tasks",
    envelope: true,
    method: "GET",
    path: `${tasksPath}?limit=2`,
    status: 200,
  });
  if (
    firstTaskPage.data.map(({ taskId }) => taskId).join(",") !==
      expectedTaskOrder.slice(0, 2).map(({ taskId }) => taskId).join(",") ||
    !firstTaskPage.nextCursor
  ) {
    throw new Error("Open Task pagination did not preserve due-date ordering.");
  }
  const secondTaskPage = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/tasks",
    envelope: true,
    method: "GET",
    path: `${tasksPath}?limit=2&cursor=${encodeURIComponent(firstTaskPage.nextCursor)}`,
    status: 200,
  });
  if (
    secondTaskPage.data.map(({ taskId }) => taskId).join(",") !==
      expectedTaskOrder[2].taskId ||
    secondTaskPage.nextCursor !== null
  ) {
    throw new Error("Open Task pagination did not terminate with the undated Task.");
  }
  const filteredTasks = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "GET",
    path: `${tasksPath}?assignee=${encodeURIComponent(memberUser.username)}`,
    status: 200,
  });
  if (
    filteredTasks.length !== 1 ||
    filteredTasks[0].taskId !== earlierDueTask.taskId
  ) {
    throw new Error("Task assignee filtering returned the wrong Task set.");
  }
  const wrongTaskCursor = await expectError({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "GET",
    path: `${tasksPath}?status=done&cursor=${encodeURIComponent(firstTaskPage.nextCursor)}`,
    status: 400,
  });
  if (wrongTaskCursor.error.code !== "invalid_request") {
    throw new Error("Task cursor mismatch did not return invalid_request.");
  }
  const taskPath = `${tasksPath}/${task.taskId}`;
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
    method: "GET",
    path: taskPath,
    status: 200,
  });
  await expectSuccess({
    actor: "memberUser",
    body: {
      text: "Prove and ship the hosted backend",
      assigneeUsername: memberUser.username,
      dueDate: null,
    },
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
    method: "PATCH",
    path: taskPath,
    status: 200,
  });
  await expectSuccess({
    actor: "initialAdmin",
    body: { state: "done" },
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}/state",
    method: "PUT",
    path: `${taskPath}/state`,
    status: 200,
  });
  const frozenTask = await expectError({
    actor: "memberUser",
    body: { text: "Do not rewrite completed work" },
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
    method: "PATCH",
    path: taskPath,
    status: 409,
  });
  if (frozenTask.error.code !== "task_done") {
    throw new Error("Done Task editing did not return task_done.");
  }
  const doneTasks = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/tasks",
    method: "GET",
    path: `${tasksPath}?status=done`,
    status: 200,
  });
  if (doneTasks.length !== 1 || doneTasks[0].taskId !== task.taskId) {
    throw new Error("Done Task filtering returned the wrong Task set.");
  }
  await expectSuccess({
    actor: "initialAdmin",
    body: { state: "open" },
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}/state",
    method: "PUT",
    path: `${taskPath}/state`,
    status: 200,
  });
  await expectSuccess({
    actor: "memberUser",
    contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
    method: "DELETE",
    path: taskPath,
    status: 204,
  });
  for (const removableTask of [earlierDueTask, undatedTask]) {
    await expectSuccess({
      actor: "initialAdmin",
      contractPath: "/api/v1/groups/{groupId}/tasks/{taskId}",
      method: "DELETE",
      path: `${tasksPath}/${removableTask.taskId}`,
      status: 204,
    });
  }

  const memberPath = `${groupPath}/members/${memberUser.userId}`;
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/members/{userId}/actions/promote",
    method: "POST",
    path: `${memberPath}/actions/promote`,
    status: 200,
  });
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/members/{userId}/actions/demote",
    method: "POST",
    path: `${memberPath}/actions/demote`,
    status: 200,
  });
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/members/{userId}/actions/kick",
    method: "POST",
    path: `${memberPath}/actions/kick`,
    status: 204,
  });
  await expectError({
    actor: "memberUser",
    contractPath: "/api/v1/groups/{groupId}",
    method: "GET",
    path: groupPath,
    status: 404,
  });

  const bansPath = `${groupPath}/bans`;
  await expectSuccess({
    actor: "initialAdmin",
    body: { userId: memberUser.userId },
    contractPath: "/api/v1/groups/{groupId}/bans/actions/ban",
    method: "POST",
    path: `${bansPath}/actions/ban`,
    status: 201,
  });
  await expectError({
    actor: "memberUser",
    contractPath: "/api/v1/invites/{token}/actions/join",
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
    status: 403,
  });
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/bans",
    method: "GET",
    path: bansPath,
    status: 200,
  });
  await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups/{groupId}/bans/{userId}/actions/unban",
    method: "POST",
    path: `${bansPath}/${memberUser.userId}/actions/unban`,
    status: 204,
  });
  await expectSuccess({
    actor: "memberUser",
    contractPath: "/api/v1/invites/{token}/actions/join",
    method: "POST",
    path: `/api/v1/invites/${invite.token}/actions/join`,
    status: 200,
  });
  await expectSuccess({
    actor: "memberUser",
    contractPath: "/api/v1/groups/{groupId}/actions/leave",
    method: "POST",
    path: `${groupPath}/actions/leave`,
    status: 204,
  });

  const renamedGroup = await expectSuccess({
    actor: "initialAdmin",
    body: { name: `${groupName} verified` },
    contractPath: "/api/v1/groups/{groupId}",
    method: "PATCH",
    path: groupPath,
    status: 200,
  });

  const unauthenticatedExamples = [
    ["GET", "/api/v1/me", "/api/v1/me", undefined, "invalid"],
    ["PUT", "/api/v1/me/username", "/api/v1/me/username", { username: initialAdmin.username }],
    ["GET", notificationContractPath, notificationPath],
    ["PUT", notificationContractPath, notificationPath, capability],
    ["PATCH", notificationContractPath, notificationPath, { state: "paused" }],
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
    ["POST", "/api/v1/groups/{groupId}/bans/actions/ban", `${bansPath}/actions/ban`, { userId: memberUser.userId }],
    ["POST", "/api/v1/groups/{groupId}/bans/{userId}/actions/unban", `${bansPath}/${memberUser.userId}/actions/unban`],
    ["GET", "/api/v1/groups/{groupId}/invite-link", `${groupPath}/invite-link`],
    ["POST", "/api/v1/groups/{groupId}/invite-link/actions/rotate", `${groupPath}/invite-link/actions/rotate`],
    ["GET", "/api/v1/invites/{token}", `/api/v1/invites/${invite.token}`],
    ["POST", "/api/v1/invites/{token}/actions/join", `/api/v1/invites/${invite.token}/actions/join`],
    ["GET", "/api/v1/groups/{groupId}/tasks", tasksPath],
    ["POST", "/api/v1/groups/{groupId}/tasks", tasksPath, { text: "Denied", assigneeUsername: initialAdmin.username }],
    ["GET", "/api/v1/groups/{groupId}/tasks/{taskId}", taskPath],
    ["PATCH", "/api/v1/groups/{groupId}/tasks/{taskId}", taskPath, { text: "Denied" }],
    ["DELETE", "/api/v1/groups/{groupId}/tasks/{taskId}", taskPath],
    ["PUT", "/api/v1/groups/{groupId}/tasks/{taskId}/state", `${taskPath}/state`, { state: "done" }],
  ];
  for (const [method, contractPath, path, body, actor] of unauthenticatedExamples) {
    const response = await request({ actor, body, method, path });
    assertStatus(response, 401, method, path);
    await validate(response, contractPath, method.toLowerCase());
  }

  await expectSuccess({
    actor: "initialAdmin",
    body: { confirmationName: renamedGroup.name },
    contractPath: "/api/v1/groups/{groupId}/actions/end",
    method: "POST",
    path: `${groupPath}/actions/end`,
    status: 204,
  });
  await expectSuccess({
    actor: "initialAdmin",
    body: { confirmationName: paginationGroup.name },
    contractPath: "/api/v1/groups/{groupId}/actions/end",
    method: "POST",
    path: `/api/v1/groups/${paginationGroup.groupId}/actions/end`,
    status: 204,
  });
  const finalGroups = await expectSuccess({
    actor: "initialAdmin",
    contractPath: "/api/v1/groups",
    method: "GET",
    path: "/api/v1/groups",
    status: 200,
  });
  const endedGroupIds = new Set([group.groupId, paginationGroup.groupId]);
  if (finalGroups.some(({ groupId }) => endedGroupIds.has(groupId))) {
    throw new Error("A disposable acceptance Group remained visible after End Group.");
  }

  return {
    endedGroupId: group.groupId,
    operationCount: successfulOperations.size,
  };
}
