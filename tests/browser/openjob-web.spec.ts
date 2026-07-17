import { expect, type Page, test } from "@playwright/test";

type Group = {
  groupId: string;
  name: string;
  role: "member" | "admin";
  createdAt: string;
};

type Member = {
  userId: string;
  username: string | null;
  role: "member" | "admin";
  joinedAt: string;
};

type Ban = {
  userId: string;
  username: string | null;
  bannedAt: string;
};

type InviteLink = {
  token: string;
  url: string;
  issuedAt: string;
  expiresAt: string;
  remainingJoins: number;
};

type Task = {
  taskId: string;
  groupId: string;
  text: string;
  assignee:
    | { state: "assigned"; userId: string; username: string }
    | { state: "unassigned" };
  dueDate: string | null;
  state: "open" | "done";
  createdAt: string;
  completedAt: string | null;
};

type ApiState = {
  user: { userId: string; username: string | null; usernameRequired: boolean };
  groups: Group[];
  members: Member[];
  knownUsers: Map<string, string | null>;
  bans: Ban[];
  invite: InviteLink;
  tasks: Task[];
  taskQueries: string[];
  concealedGroupIds: Set<string>;
  authorizationHeaders: string[];
  meFailureStatus: number | null;
  claimFailureStatus: number | null;
  getGroupFailureStatus: number | null;
  taskFailureStatus: number | null;
  taskMutationFailureStatus: number | null;
  failGroups: boolean;
  failTaskNetwork: boolean;
  hangMe: boolean;
  hangTasks: boolean;
  membershipDenied: boolean;
};

const signedInUser = {
  userId: "user_shane",
  username: "shane",
  usernameRequired: false,
};

const walkerLabs: Group = {
  groupId: "grp_walker",
  name: "Walker Labs",
  role: "admin",
  createdAt: "2026-07-15T15:00:00.000Z",
};

const openJobCore: Group = {
  groupId: "grp_openjob",
  name: "OpenJob Core",
  role: "member",
  createdAt: "2026-07-16T15:00:00.000Z",
};

async function startSignedIn(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("openjob-test:firebase-session", "signed-in");
  });
}

async function expectConfirmation(
  page: Page,
  expectedMessage: string,
  action: () => Promise<unknown>,
  accept = true,
) {
  const confirmation = page.waitForEvent("dialog").then(async (dialog) => {
    const message = dialog.message();
    if (accept) await dialog.accept();
    else await dialog.dismiss();
    return message;
  });
  await action();
  expect(await confirmation).toContain(expectedMessage);
}

async function installApi(
  page: Page,
  initial: Partial<Pick<ApiState, "user" | "groups" | "members" | "bans" | "invite" | "tasks" | "meFailureStatus" | "claimFailureStatus" | "getGroupFailureStatus" | "taskFailureStatus" | "taskMutationFailureStatus" | "failGroups" | "failTaskNetwork" | "hangMe" | "hangTasks" | "membershipDenied">> = {},
) {
  const members = [...(initial.members ?? [])];
  const bans = [...(initial.bans ?? [])];
  const tasks = [...(initial.tasks ?? [])];
  const state: ApiState = {
    user: initial.user ?? {
      userId: "user_shane",
      username: null,
      usernameRequired: true,
    },
    groups: [...(initial.groups ?? [])],
    members,
    knownUsers: new Map([
      ...members.map((member) => [member.userId, member.username] as const),
      ...bans.map((ban) => [ban.userId, ban.username] as const),
      ...tasks.flatMap((task) => task.assignee.state === "assigned"
        ? [[task.assignee.userId, task.assignee.username] as const]
        : []),
    ]),
    bans,
    invite: initial.invite ?? {
      token: "ivt_browser_active",
      url: "https://openjob.dev/invites/ivt_browser_active",
      issuedAt: "2026-07-16T15:00:00.000Z",
      expiresAt: "2026-07-23T15:00:00.000Z",
      remainingJoins: 25,
    },
    tasks,
    taskQueries: [],
    concealedGroupIds: new Set(),
    authorizationHeaders: [],
    meFailureStatus: initial.meFailureStatus ?? null,
    claimFailureStatus: initial.claimFailureStatus ?? null,
    getGroupFailureStatus: initial.getGroupFailureStatus ?? null,
    taskFailureStatus: initial.taskFailureStatus ?? null,
    taskMutationFailureStatus: initial.taskMutationFailureStatus ?? null,
    failGroups: initial.failGroups ?? false,
    failTaskNetwork: initial.failTaskNetwork ?? false,
    hangMe: initial.hangMe ?? false,
    hangTasks: initial.hangTasks ?? false,
    membershipDenied: initial.membershipDenied ?? false,
  };

  const removeMember = (userId: string) => {
    state.members = state.members.filter((item) => item.userId !== userId);
    state.tasks = state.tasks.map((task) =>
      task.state === "open" && task.assignee.state === "assigned" && task.assignee.userId === userId
        ? { ...task, assignee: { state: "unassigned" as const } }
        : task,
    );
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const authorization = request.headers().authorization ?? "";
    state.authorizationHeaders.push(authorization);

    const reply = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    const error = (
      status: number,
      code: string,
      message: string,
      fields?: Record<string, string>,
    ) => reply(status, { error: { code, message, fields, requestId: "req_browser" } });

    if (authorization !== "Bearer browser-test-token") {
      await error(401, "authentication_required", "Authentication is required.");
      return;
    }

    if (url.pathname === "/api/v1/me" && request.method() === "GET") {
      if (state.hangMe) return await new Promise<void>(() => undefined);
      if (state.meFailureStatus) {
        await error(
          state.meFailureStatus,
          state.meFailureStatus === 401 ? "authentication_required" : "internal_error",
          state.meFailureStatus === 401
            ? "Authentication is required."
            : "An unexpected error occurred.",
        );
        return;
      }
      await reply(200, { data: state.user });
      return;
    }

    if (url.pathname === "/api/v1/me/username" && request.method() === "PUT") {
      if (state.claimFailureStatus) {
        await error(
          state.claimFailureStatus,
          "authentication_required",
          "Authentication is required.",
        );
        return;
      }
      const { username } = request.postDataJSON() as { username?: unknown };
      const valid =
        typeof username === "string" &&
        /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])$/.test(username);
      if (!valid) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          username: "Use 2 to 32 lowercase letters, numbers, or internal ._- characters.",
        });
        return;
      }
      state.user = { ...state.user, username, usernameRequired: false };
      await reply(200, { data: state.user });
      return;
    }

    if (url.pathname === "/api/v1/groups" && request.method() === "GET") {
      if (state.failGroups) {
        await error(500, "internal_error", "An unexpected error occurred.");
        return;
      }
      await reply(200, { data: state.groups, nextCursor: null });
      return;
    }

    if (url.pathname === "/api/v1/groups" && request.method() === "POST") {
      const { name: rawName } = request.postDataJSON() as { name?: unknown };
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (
        [...name].length < 1 ||
        [...name].length > 80 ||
        /[\n\r\p{Cc}]/u.test(name)
      ) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          name: "Use 1 to 80 characters without line breaks or control characters.",
        });
        return;
      }
      const group: Group = {
        groupId: `grp_${String(state.groups.length + 1).padStart(4, "0")}`,
        name,
        role: "admin",
        createdAt: "2026-07-16T16:00:00.000Z",
      };
      state.groups.push(group);
      await reply(201, { data: group });
      return;
    }

    const inviteMatch = url.pathname.match(/^\/api\/v1\/invites\/([^/]+)$/);
    if (inviteMatch && request.method() === "GET") {
      if (decodeURIComponent(inviteMatch[1]) !== state.invite.token) {
        await error(404, "invite_not_found", "Invite Link is not valid.");
        return;
      }
      await reply(200, { data: { groupName: walkerLabs.name } });
      return;
    }

    const joinMatch = url.pathname.match(/^\/api\/v1\/invites\/([^/]+)\/actions\/join$/);
    if (joinMatch && request.method() === "POST") {
      if (decodeURIComponent(joinMatch[1]) !== state.invite.token) {
        await error(404, "invite_not_found", "Invite Link is not valid.");
        return;
      }
      if (state.membershipDenied) {
        await error(403, "membership_denied", "Membership could not be granted.");
        return;
      }
      const existing = state.groups.find((group) => group.groupId === walkerLabs.groupId);
      const joined = existing ?? { ...walkerLabs, role: "member" as const };
      if (!existing) {
        state.groups.push(joined);
      }
      if (!state.members.some((member) => member.userId === state.user.userId)) {
        state.members.push({
          userId: state.user.userId,
          username: state.user.username,
          role: "member",
          joinedAt: "2026-07-16T16:00:00.000Z",
        });
        state.knownUsers.set(state.user.userId, state.user.username);
        state.invite = { ...state.invite, remainingJoins: state.invite.remainingJoins - 1 };
      }
      await reply(200, { data: joined });
      return;
    }

    const groupMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)$/);
    if (groupMatch && request.method() === "PATCH") {
      const groupId = decodeURIComponent(groupMatch[1]);
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      const { name: rawName } = request.postDataJSON() as { name?: unknown };
      const name = typeof rawName === "string" ? rawName.trim() : "";
      if (!name) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          name: "Use 1 to 80 characters without line breaks or control characters.",
        });
        return;
      }
      const renamed = { ...group, name };
      state.groups = state.groups.map((item) => item.groupId === groupId ? renamed : item);
      await reply(200, { data: renamed });
      return;
    }

    const leaveMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/actions\/leave$/);
    if (leaveMatch && request.method() === "POST") {
      const groupId = decodeURIComponent(leaveMatch[1]);
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      const ownsOpenTask = state.tasks.some((task) =>
        task.groupId === groupId &&
        task.state === "open" &&
        task.assignee.state === "assigned" &&
        task.assignee.userId === state.user.userId
      );
      if (ownsOpenTask) {
        await error(409, "open_tasks_assigned", "Reassign or complete your open Tasks before leaving.");
        return;
      }
      const admins = state.members.filter((member) => member.role === "admin");
      if (group.role === "admin" && admins.length === 1) {
        await error(409, "last_admin", "Promote another Admin before leaving.");
        return;
      }
      state.groups = state.groups.filter((item) => item.groupId !== groupId);
      state.members = state.members.filter((member) => member.userId !== state.user.userId);
      await route.fulfill({ status: 204 });
      return;
    }

    const endMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/actions\/end$/);
    if (endMatch && request.method() === "POST") {
      const groupId = decodeURIComponent(endMatch[1]);
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      const { confirmationName } = request.postDataJSON() as { confirmationName?: unknown };
      if (confirmationName !== group.name) {
        await error(409, "confirmation_mismatch", "Enter the current Group Name exactly.");
        return;
      }
      if (state.members.length !== 1) {
        await error(409, "members_remain", "Remove every other Member before ending this Group.");
        return;
      }
      state.groups = state.groups.filter((item) => item.groupId !== groupId);
      state.members = [];
      state.tasks = state.tasks.filter((task) => task.groupId !== groupId);
      state.bans = [];
      await route.fulfill({ status: 204 });
      return;
    }

    const inviteAdminMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/invite-link(?:\/actions\/rotate)?$/);
    if (inviteAdminMatch) {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(inviteAdminMatch[1]));
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      if (request.method() === "GET" && !url.pathname.endsWith("/actions/rotate")) {
        await reply(200, { data: state.invite });
        return;
      }
      if (request.method() === "POST" && url.pathname.endsWith("/actions/rotate")) {
        state.invite = {
          ...state.invite,
          token: `${state.invite.token}_rotated`,
          url: `${state.invite.url}_rotated`,
          issuedAt: "2026-07-16T17:00:00.000Z",
          expiresAt: "2026-07-23T17:00:00.000Z",
          remainingJoins: 25,
        };
        await reply(200, { data: state.invite });
        return;
      }
    }

    const memberActionMatch = url.pathname.match(
      /^\/api\/v1\/groups\/([^/]+)\/members\/([^/]+)\/actions\/(promote|demote|kick)$/,
    );
    if (memberActionMatch && request.method() === "POST") {
      const [, encodedGroupId, encodedUserId, action] = memberActionMatch;
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(encodedGroupId));
      const userId = decodeURIComponent(encodedUserId);
      const member = state.members.find((item) => item.userId === userId);
      if (!group || !member) {
        await error(404, "member_not_found", "Member was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      if (action === "kick") {
        if (userId === state.user.userId) {
          await error(409, "self_removal", "Use Leave Group to remove yourself.");
          return;
        }
        removeMember(userId);
        await route.fulfill({ status: 204 });
        return;
      }
      const role = action === "promote" ? "admin" as const : "member" as const;
      const updated = { ...member, role };
      state.members = state.members.map((item) => item.userId === userId ? updated : item);
      if (userId === state.user.userId) {
        state.groups = state.groups.map((item) => item.groupId === group.groupId ? { ...item, role } : item);
      }
      await reply(200, { data: updated });
      return;
    }

    const bansMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/bans$/);
    if (bansMatch && request.method() === "GET") {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(bansMatch[1]));
      if (!group) {
        await error(404, "group_not_found", "The requested Group was not found.");
      } else if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
      } else {
        await reply(200, { data: state.bans, nextCursor: null });
      }
      return;
    }

    const banMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/bans\/actions\/ban$/);
    if (banMatch && request.method() === "POST") {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(banMatch[1]));
      const { userId } = request.postDataJSON() as { userId?: string };
      const member = state.members.find((item) => item.userId === userId);
      if (!group || !userId || !state.knownUsers.has(userId)) {
        await error(404, "user_not_found", "User was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      if (userId === state.user.userId) {
        await error(409, "self_removal", "Admins cannot ban themselves.");
        return;
      }
      const ban = { userId, username: state.knownUsers.get(userId) ?? null, bannedAt: "2026-07-16T17:00:00.000Z" };
      state.bans.push(ban);
      if (member) removeMember(userId);
      await reply(201, { data: ban });
      return;
    }

    const unbanMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/bans\/([^/]+)\/actions\/unban$/);
    if (unbanMatch && request.method() === "POST") {
      const group = state.groups.find((item) => item.groupId === decodeURIComponent(unbanMatch[1]));
      const userId = decodeURIComponent(unbanMatch[2]);
      if (!group || !state.bans.some((ban) => ban.userId === userId)) {
        await error(404, "ban_not_found", "Ban was not found.");
        return;
      }
      if (group.role !== "admin") {
        await error(403, "admin_required", "Admin permission is required.");
        return;
      }
      state.bans = state.bans.filter((ban) => ban.userId !== userId);
      await route.fulfill({ status: 204 });
      return;
    }

    const membersMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/members$/);
    if (membersMatch && request.method() === "GET") {
      await reply(200, { data: state.members, nextCursor: null });
      return;
    }

    const tasksMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/tasks$/);
    if (tasksMatch && request.method() === "GET") {
      if (state.hangTasks) return await new Promise<void>(() => undefined);
      if (state.failTaskNetwork) {
        await route.abort("failed");
        return;
      }
      if (state.taskFailureStatus) {
        const code = state.taskFailureStatus === 401
          ? "authentication_required"
          : state.taskFailureStatus === 403
            ? "forbidden"
            : "internal_error";
        await error(state.taskFailureStatus, code, "The Task List is unavailable.");
        return;
      }
      state.taskQueries.push(url.searchParams.toString());
      const status = url.searchParams.get("status") ?? "open";
      const assignee = url.searchParams.get("assignee");
      const tasks = state.tasks.filter((task) => {
        if (status !== "all" && task.state !== status) return false;
        if (assignee === null) return true;
        return assignee === "unassigned"
          ? task.assignee.state === "unassigned"
          : task.assignee.state === "assigned" && task.assignee.username === assignee;
      });
      await reply(200, { data: tasks, nextCursor: null });
      return;
    }
    if (tasksMatch && request.method() === "POST") {
      const input = request.postDataJSON() as {
        text?: unknown;
        assigneeUsername?: unknown;
        dueDate?: unknown;
      };
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text) {
        await error(400, "invalid_request", "One or more fields are invalid.", {
          text: "Use 1 to 2,000 characters.",
        });
        return;
      }
      const member = state.members.find((item) => item.username === input.assigneeUsername);
      if (!member || member.username === null) {
        await error(409, "assignee_not_member", "The assignee is not a current Member.");
        return;
      }
      const task: Task = {
        taskId: `task_${String(state.tasks.length + 1).padStart(4, "0")}`,
        groupId: decodeURIComponent(tasksMatch[1]),
        text,
        assignee: { state: "assigned", userId: member.userId, username: member.username },
        dueDate: typeof input.dueDate === "string" ? input.dueDate : null,
        state: "open",
        createdAt: "2026-07-16T18:00:00.000Z",
        completedAt: null,
      };
      state.tasks.push(task);
      await reply(201, { data: task });
      return;
    }

    const taskMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/tasks\/([^/]+)$/);
    if (taskMatch && request.method() === "PATCH") {
      const taskId = decodeURIComponent(taskMatch[2]);
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (!task) {
        await error(404, "not_found", "The requested resource was not found.");
        return;
      }
      if (task.state === "done") {
        await error(409, "task_done", "Reopen the Task before editing it.");
        return;
      }
      const input = request.postDataJSON() as {
        text?: string;
        assigneeUsername?: string;
        dueDate?: string | null;
      };
      let nextAssignee = task.assignee;
      if (input.assigneeUsername !== undefined) {
        const member = state.members.find((item) => item.username === input.assigneeUsername);
        if (!member || member.username === null) {
          await error(409, "assignee_not_member", "The assignee is not a current Member.");
          return;
        }
        nextAssignee = { state: "assigned", userId: member.userId, username: member.username };
      }
      const updated = {
        ...task,
        ...(input.text !== undefined ? { text: input.text.trim() } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        assignee: nextAssignee,
      };
      state.tasks = state.tasks.map((item) => item.taskId === taskId ? updated : item);
      await reply(200, { data: updated });
      return;
    }
    if (taskMatch && request.method() === "DELETE") {
      const taskId = decodeURIComponent(taskMatch[2]);
      state.tasks = state.tasks.filter((item) => item.taskId !== taskId);
      await route.fulfill({ status: 204 });
      return;
    }

    const taskStateMatch = url.pathname.match(/^\/api\/v1\/groups\/([^/]+)\/tasks\/([^/]+)\/state$/);
    if (taskStateMatch && request.method() === "PUT") {
      if (state.taskMutationFailureStatus) {
        await error(
          state.taskMutationFailureStatus,
          state.taskMutationFailureStatus === 409 ? "task_changed" : "internal_error",
          "The Task could not be changed.",
        );
        return;
      }
      const taskId = decodeURIComponent(taskStateMatch[2]);
      const desired = (request.postDataJSON() as { state: "open" | "done" }).state;
      const task = state.tasks.find((item) => item.taskId === taskId);
      if (!task) {
        await error(404, "not_found", "The requested resource was not found.");
        return;
      }
      const updated: Task = {
        ...task,
        state: desired,
        completedAt: desired === "done" ? task.completedAt ?? "2026-07-16T18:30:00.000Z" : null,
      };
      state.tasks = state.tasks.map((item) => item.taskId === taskId ? updated : item);
      await reply(200, { data: updated });
      return;
    }

    const groupId = decodeURIComponent(url.pathname.slice("/api/v1/groups/".length));
    if (request.method() === "GET" && groupId) {
      if (state.getGroupFailureStatus) {
        await error(
          state.getGroupFailureStatus,
          "authentication_required",
          "Authentication is required.",
        );
        return;
      }
      const group = state.groups.find((item) => item.groupId === groupId);
      if (!group || state.concealedGroupIds.has(groupId)) {
        await error(404, "not_found", "The requested resource was not found.");
        return;
      }
      await reply(200, { data: group });
      return;
    }

    await error(404, "not_found", "The requested resource was not found.");
  });

  return state;
}

test("runs the production sign-in, Username, Group creation, persistence, and sign-out path", async ({ page }) => {
  const state = await installApi(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Your team. One clear list." })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Claim your Username" })).toBeVisible();

  await page.getByLabel("Username").fill("Shane");
  await page.getByRole("button", { name: "Claim Username" }).click();
  await expect(page.getByRole("alert")).toContainText("lowercase letters");
  await page.getByLabel("Username").fill("shane");
  await page.getByRole("button", { name: "Claim Username" }).click();

  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
  await page.getByLabel("Group Name").fill("Walker Labs");
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openjob-test:firebase-persistence"))).toBe("LOCAL");
  expect(state.authorizationHeaders.every((header) => header === "Bearer browser-test-token")).toBe(true);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
});

test("returns a signed-out Invite Link visitor to an explicit Group join confirmation", async ({ page }) => {
  const state = await installApi(page, { user: signedInUser, groups: [openJobCore] });

  await page.goto(`/invites/${state.invite.token}`);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.getByRole("heading", { name: "Join Walker Labs" })).toBeVisible();
  await expect(page.getByText(walkerLabs.groupId)).toHaveCount(0);
  await page.getByRole("button", { name: "Join Group" }).click();

  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "OpenJob Core", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.location.pathname)).toBe("/");
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id")),
  ).toBe(walkerLabs.groupId);
  expect(state.invite.remainingJoins).toBe(24);
});

test("keeps an existing Member's complete Group rail on idempotent Invite Link join", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs, openJobCore],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
  });

  await page.goto(`/invites/${state.invite.token}`);
  await page.getByRole("button", { name: "Join Group" }).click();

  await expect(page.getByRole("button", { name: "Walker Labs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "OpenJob Core", exact: true })).toBeVisible();
  expect(state.invite.remainingJoins).toBe(25);
});

test("keeps invalid and membership-denied Invite Link results generic", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser });

  await page.goto("/invites/ivt_unknown");
  await expect(page.getByRole("heading", { name: "Invite Link unavailable" })).toBeVisible();
  await expect(page.getByText("Walker Labs")).toHaveCount(0);

  state.membershipDenied = true;
  await page.goto(`/invites/${state.invite.token}`);
  await expect(page.getByRole("heading", { name: "Join Walker Labs" })).toBeVisible();
  await page.getByRole("button", { name: "Join Group" }).click();
  await expect(page.getByRole("alert")).toHaveText("Membership could not be granted.");
  await expect(page.getByText(/ban/i)).toHaveCount(0);
});

test("lets Admins govern Invite Links, Members, bans, and forced-removal recovery", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
      { userId: "user_elijah", username: "elijah", role: "member", joinedAt: "2026-07-03T00:00:00.000Z" },
      { userId: "user_avery", username: "avery", role: "admin", joinedAt: "2026-07-04T00:00:00.000Z" },
    ],
    bans: [
      { userId: "user_zora", username: "zora", bannedAt: "2026-07-10T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_removed_member",
        groupId: walkerLabs.groupId,
        text: "Recover removed Member work",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-15T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Manage Group" }).click();

  await expect(page.getByRole("heading", { name: "Manage Walker Labs" })).toBeVisible();
  await expect(page.getByLabel("Invite Link")).toHaveValue(state.invite.url);
  await expect(page.getByText("25 joins remaining")).toBeVisible();
  await expect(page.locator("time").filter({ hasText: /Expires/ })).toHaveAttribute("datetime", state.invite.expiresAt);

  await expectConfirmation(
    page,
    "current link will stop working immediately",
    () => page.getByRole("button", { name: "Rotate Invite Link" }).click(),
    false,
  );
  await expect(page.getByLabel("Invite Link")).toHaveValue(state.invite.url);
  await expectConfirmation(
    page,
    "current link will stop working immediately",
    () => page.getByRole("button", { name: "Rotate Invite Link" }).click(),
  );
  await expect(page.getByLabel("Invite Link")).toHaveValue(/_rotated$/);

  const elijah = page.getByTestId("member-row").filter({ hasText: "@elijah" });
  const formerMemberUserId = await elijah.getByLabel("@elijah User ID").textContent();
  await elijah.getByRole("button", { name: "Promote" }).click();
  await expect(elijah.getByText("Admin", { exact: true })).toBeVisible();
  await expectConfirmation(
    page,
    "Demote @elijah to Member",
    () => elijah.getByRole("button", { name: "Demote" }).click(),
  );
  await expect(elijah.getByText("Member", { exact: true })).toBeVisible();
  await expectConfirmation(
    page,
    "Their open Tasks will become Unassigned",
    () => elijah.getByRole("button", { name: "Kick" }).click(),
  );
  await expect(elijah).toHaveCount(0);

  const morgan = page.getByTestId("member-row").filter({ hasText: "@morgan" });
  await expectConfirmation(
    page,
    "cannot rejoin until unbanned",
    () => morgan.getByRole("button", { name: "Ban" }).click(),
  );
  await expect(morgan).toHaveCount(0);
  await expect(page.getByTestId("ban-row").filter({ hasText: "@morgan" })).toBeVisible();

  const zoraBan = page.getByTestId("ban-row").filter({ hasText: "@zora" });
  await expectConfirmation(
    page,
    "still need an Invite Link to rejoin",
    () => zoraBan.getByRole("button", { name: "Unban" }).click(),
  );
  await expect(zoraBan).toHaveCount(0);

  await page.getByLabel("Former Member User ID").fill(formerMemberUserId!);
  await expectConfirmation(
    page,
    "former Member",
    () => page.getByRole("button", { name: "Ban former Member" }).click(),
  );
  await expect(page.getByTestId("ban-row").filter({ hasText: "@elijah" })).toBeVisible();

  await page.getByRole("button", { name: "Task List" }).click();
  const unassigned = page.getByTestId("task-lane").filter({
    has: page.getByRole("heading", { name: "Unassigned" }),
  });
  await expect(unassigned.getByText("Recover removed Member work")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Manage Group" }).click();
  const governanceSurface = await page.getByTestId("governance-surface").boundingBox();
  expect(governanceSurface!.width).toBeLessThanOrEqual(354);

  const shane = page.getByTestId("member-row").filter({ hasText: "@shane" });
  await expectConfirmation(
    page,
    "Demote @shane to Member",
    () => shane.getByRole("button", { name: "Demote" }).click(),
  );
  await expect(page.getByRole("heading", { name: "Walker Labs settings" })).toBeVisible();
  await expect(page.getByLabel("Invite Link")).toHaveCount(0);
});

test("keeps Admin controls private and enforces guarded Member departure", async ({ page }) => {
  await startSignedIn(page);
  const memberGroup = { ...openJobCore, role: "member" as const };
  const state = await installApi(page, {
    user: signedInUser,
    groups: [memberGroup],
    members: [
      { userId: "user_shane", username: "shane", role: "member", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "admin", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_leave_guard",
        groupId: memberGroup.groupId,
        text: "Finish before leaving",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-15T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Group settings" }).click();

  await expect(page.getByRole("heading", { name: "OpenJob Core settings" })).toBeVisible();
  await expect(page.getByLabel("Invite Link")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bans" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Promote|Demote|Kick|Ban/ })).toHaveCount(0);

  await expectConfirmation(
    page,
    "lose access immediately",
    () => page.getByRole("button", { name: "Leave Group" }).click(),
  );
  await expect(page.getByRole("alert")).toContainText("Reassign or complete your open Tasks");

  state.tasks = [];
  await expectConfirmation(
    page,
    "lose access immediately",
    () => page.getByRole("button", { name: "Leave Group" }).click(),
  );
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id"))).toBeNull();
});

test("lets the sole Admin rename and explicitly End Group", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Manage Group" }).click();

  await page.getByLabel("Group Name").fill("Walker Studio");
  await page.getByRole("button", { name: "Rename Group" }).click();
  await expect(page.getByRole("heading", { name: "Manage Walker Studio" })).toBeVisible();

  const endButton = page.getByRole("button", { name: "End Group" });
  await expect(endButton).toBeDisabled();
  await page.getByLabel("Type Walker Studio to confirm").fill("Walker Studio");
  await expect(endButton).toBeEnabled();
  await expectConfirmation(
    page,
    "cannot be undone",
    () => endButton.click(),
  );
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
});

test("auto-selects one Group but requires and remembers a choice among multiple Groups", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs] });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Walker Labs", exact: true })).toBeVisible();

  state.groups.push(openJobCore);
  await page.evaluate(() => window.localStorage.removeItem("openjob:selected-group-id"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Choose a Group" })).toBeVisible();
  await page.getByRole("button", { name: "OpenJob Core", exact: true }).click();
  await expect(page.getByRole("heading", { name: "OpenJob Core", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "OpenJob Core", exact: true })).toBeVisible();
});

test("clears stale or concealed Group access without exposing private details", async ({ page }) => {
  await startSignedIn(page);
  await page.addInitScript(() => window.localStorage.setItem("openjob:selected-group-id", "grp_retired"));
  const state = await installApi(page, { user: signedInUser, groups: [walkerLabs, openJobCore] });
  await page.goto("/");
  await expect(page.getByText("That Group is no longer accessible. Choose another.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("openjob:selected-group-id"))).toBeNull();

  const concealed = { ...walkerLabs, groupId: "grp_concealed", name: "Retired Operations" };
  state.groups = [concealed];
  state.concealedGroupIds.add(concealed.groupId);
  await page.reload();
  await expect(page.getByText("That Group is no longer accessible.")).toBeVisible();
  await expect(page.getByText("Retired Operations")).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  state.groups = [walkerLabs, openJobCore];
  state.concealedGroupIds.clear();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Choose a Group" })).toBeVisible();
  await expect(page.getByText("That Group is no longer accessible.")).toHaveCount(0);
});

test("accepts an 80-character Unicode Group Name from the service", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, { user: signedInUser });
  await page.goto("/");
  const name = "🚀".repeat(80);
  await page.getByLabel("Group Name").fill(name);
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

test("uses a persistent rail on desktop and a horizontal Group picker on narrow screens", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, { user: signedInUser, groups: [walkerLabs, openJobCore] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();

  const desktopRail = await page.getByTestId("group-rail").boundingBox();
  const desktopSurface = await page.getByTestId("group-surface").boundingBox();
  expect(desktopRail!.width).toBeLessThan(300);
  expect(desktopRail!.height).toBeGreaterThanOrEqual(790);
  expect(desktopSurface!.x).toBeGreaterThanOrEqual(desktopRail!.width - 1);

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowRail = await page.getByTestId("group-rail").boundingBox();
  const firstGroup = await page.getByRole("button", { name: "Walker Labs", exact: true }).boundingBox();
  const secondGroup = await page.getByRole("button", { name: "OpenJob Core", exact: true }).boundingBox();
  const newGroup = await page.getByRole("button", { name: "+ New Group" }).boundingBox();
  expect(narrowRail!.width).toBeGreaterThanOrEqual(389);
  expect(narrowRail!.height).toBeLessThan(240);
  expect(Math.abs(firstGroup!.y - secondGroup!.y)).toBeLessThan(2);
  expect(newGroup!.y).toBeGreaterThan(firstGroup!.y + firstGroup!.height);
});

test("distinguishes loading and failures from a User with no Groups", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, { user: signedInUser, hangMe: true });
  await page.goto("/");
  await expect(page.getByText("Loading your OpenJob…")).toBeVisible();

  state.hangMe = false;
  state.meFailureStatus = 500;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("OpenJob could not load right now.");

  state.meFailureStatus = null;
  state.failGroups = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("OpenJob could not load right now.");
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toHaveCount(0);
});

test("turns Firebase initialization failure into an understandable auth state", async ({ page }) => {
  await installApi(page);
  await page.goto("/?scenario=auth-error");
  await expect(page.getByRole("alert")).toContainText("Google sign-in could not start. Try again.");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Claim your Username" })).toBeVisible();
});

test("returns an expired session to a working sign-in path", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    meFailureStatus: 401,
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");
  state.meFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toBeVisible();
});

test("recovers when a session expires during a mutation", async ({ page }) => {
  const state = await installApi(page, { claimFailureStatus: 401 });
  await page.goto("/");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByLabel("Username").fill("shane");
  await page.getByRole("button", { name: "Claim Username" }).click();
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");

  state.claimFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Claim your Username" })).toBeVisible();
});

test("recovers when a session expires while selecting a Group", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs, openJobCore],
    getGroupFailureStatus: 401,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");

  state.getGroupFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByRole("heading", { name: "Choose a Group" })).toBeVisible();
});

test("renders ordered assignee lanes with combined status and assignee filters", async ({ page }) => {
  await startSignedIn(page);
  await page.clock.setFixedTime(new Date("2026-07-16T17:00:00-05:00"));
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-03T00:00:00.000Z" },
      { userId: "user_elijah", username: "elijah", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_elijah",
        groupId: walkerLabs.groupId,
        text: "Confirm patio measurements",
        assignee: { state: "assigned", userId: "user_elijah", username: "elijah" },
        dueDate: "2026-07-15",
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_morgan_open",
        groupId: walkerLabs.groupId,
        text: "Order menu stands",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-02T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_morgan_done",
        groupId: walkerLabs.groupId,
        text: "Archive spring campaign",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "done",
        createdAt: "2026-07-03T10:00:00.000Z",
        completedAt: "2026-07-15T15:00:00.000Z",
      },
      {
        taskId: "task_shane",
        groupId: walkerLabs.groupId,
        text: "Publish lunch specials",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: "2026-07-18",
        state: "open",
        createdAt: "2026-07-04T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_unassigned",
        groupId: walkerLabs.groupId,
        text: "Recover payroll handoff",
        assignee: { state: "unassigned" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-05T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });

  await page.goto("/");

  const lanes = page.getByTestId("task-lane");
  await expect(lanes).toHaveCount(4);
  await expect(lanes.nth(0).getByRole("heading")).toHaveText("@elijah");
  await expect(lanes.nth(1).getByRole("heading")).toHaveText("@morgan");
  await expect(lanes.nth(2).getByRole("heading")).toHaveText("@shane");
  await expect(lanes.nth(3).getByRole("heading")).toHaveText("Unassigned");
  await expect(page.getByText("Archive spring campaign")).toHaveCount(0);
  await expect(page.getByText("Confirm patio measurements").locator("..")).toContainText("Overdue");

  await page.getByLabel("Task status").selectOption("all");
  await page.getByLabel("Assignee filter").selectOption({ label: "@morgan" });
  await expect(lanes).toHaveCount(1);
  const morganCards = lanes.getByTestId("task-card");
  await expect(morganCards.nth(0)).toContainText("Order menu stands");
  await expect(morganCards.nth(1)).toContainText("Archive spring campaign");
  expect(state.taskQueries.some((query) => query.includes("status=all") && query.includes("assignee=morgan"))).toBe(true);
});

test("runs the complete Task lifecycle through assignee lanes", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_existing",
        groupId: walkerLabs.groupId,
        text: "Publish lunch specials",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_unassigned",
        groupId: walkerLabs.groupId,
        text: "Recover payroll handoff",
        assignee: { state: "unassigned" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-02T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");

  const morganLane = page.getByTestId("task-lane").filter({ has: page.getByRole("heading", { name: "@morgan" }) });
  const unassignedLane = page.getByTestId("task-lane").filter({ has: page.getByRole("heading", { name: "Unassigned" }) });
  await expect(morganLane.getByRole("button", { name: "Add Task" })).toBeVisible();
  await expect(unassignedLane.getByRole("button", { name: "Add Task" })).toHaveCount(0);

  await morganLane.getByRole("button", { name: "Add Task" }).click();
  await morganLane.getByLabel("Task text").fill("Order replacement menu stands");
  await morganLane.getByLabel("Due date").fill("2026-07-20");
  await morganLane.getByRole("button", { name: "Create Task" }).click();
  await expect(page.getByText("Order replacement menu stands")).toBeVisible();

  let card = page.getByTestId("task-card").filter({ hasText: "Order replacement menu stands" });
  await card.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("dialog", { name: "Edit Task" }).getByLabel("Task text").fill("Order two menu stands");
  await page.getByRole("dialog", { name: "Edit Task" }).getByLabel("Assignee").selectOption("shane");
  await page.getByRole("dialog", { name: "Edit Task" }).getByRole("button", { name: "Save Task" }).click();
  card = page.getByTestId("task-card").filter({ hasText: "Order two menu stands" });
  await expect(card).toBeVisible();

  await card.getByRole("button", { name: "Complete" }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel("Task status").selectOption("done");
  card = page.getByTestId("task-card").filter({ hasText: "Order two menu stands" });
  await expect(card.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await card.getByRole("button", { name: "Reopen" }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel("Task status").selectOption("open");
  card = page.getByTestId("task-card").filter({ hasText: "Order two menu stands" });
  await expect(card).toBeVisible();

  const unassignedCard = page.getByTestId("task-card").filter({ hasText: "Recover payroll handoff" });
  await unassignedCard.getByRole("button", { name: "Assign" }).click();
  await page.getByRole("dialog", { name: "Assign Task" }).getByLabel("Assignee").selectOption("morgan");
  await page.getByRole("dialog", { name: "Assign Task" }).getByRole("button", { name: "Assign Task" }).click();
  await expect(morganLane.getByText("Recover payroll handoff")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("permanently delete");
    await dialog.accept();
  });
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Order two menu stands")).toHaveCount(0);
});

test("keeps narrow-screen lanes nearly full width and horizontally interactive", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_morgan", username: "morgan", role: "member", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_mobile",
        groupId: walkerLabs.groupId,
        text: "Check the narrow layout",
        assignee: { state: "assigned", userId: "user_morgan", username: "morgan" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const lanes = page.getByTestId("task-lane");
  const first = await lanes.nth(0).boundingBox();
  const second = await lanes.nth(1).boundingBox();
  expect(first!.width).toBeGreaterThanOrEqual(330);
  expect(first!.width).toBeLessThan(390);
  expect(second!.x).toBeGreaterThan(first!.x + first!.width);

  const morganLane = lanes.filter({ has: page.getByRole("heading", { name: "@morgan" }) });
  await morganLane.scrollIntoViewIfNeeded();
  await morganLane.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByText("Check the narrow layout")).toHaveCount(0);
});

test("shows loading and empty Task List states", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    hangTasks: true,
  });
  await page.goto("/");
  await expect(page.getByText("Loading Task List…")).toBeVisible();

  state.hangTasks = false;
  await page.reload();
  await expect(page.getByTestId("task-lane")).toHaveCount(1);
  await expect(page.getByText("No Tasks here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Task" })).toBeVisible();
});

test("recovers Task List permission and network failures", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    taskFailureStatus: 403,
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("no longer have permission");

  state.taskFailureStatus = null;
  state.failTaskNetwork = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");

  state.failTaskNetwork = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("task-lane")).toHaveCount(1);
});

test("keeps validation and conflict failures visible and recoverable", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_conflict",
        groupId: walkerLabs.groupId,
        text: "Resolve the conflict",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Add Task" }).click();
  const form = page.getByTestId("task-lane").getByRole("form");
  await form.getByRole("button", { name: "Create Task" }).click();
  await expect(form.getByRole("alert")).toContainText("1 to 2,000 characters");
  await form.getByLabel("Task text").fill("A valid Task");
  await form.getByRole("button", { name: "Create Task" }).click();
  await expect(page.getByText("A valid Task")).toBeVisible();

  state.taskMutationFailureStatus = 409;
  const conflictCard = page.getByTestId("task-card").filter({ hasText: "Resolve the conflict" });
  await conflictCard.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByRole("alert")).toContainText("Task changed");
  state.taskMutationFailureStatus = null;
  await page.getByRole("button", { name: "Reload Task List" }).click();
  await conflictCard.getByRole("button", { name: "Complete" }).click();
  await expect(page.getByText("Resolve the conflict")).toHaveCount(0);
});

test("returns Task List authentication failures to a working sign-in path", async ({ page }) => {
  await startSignedIn(page);
  const state = await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    taskFailureStatus: 401,
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Your session expired. Sign in again.");

  state.taskFailureStatus = null;
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByTestId("task-lane")).toHaveCount(1);
});

test("filters a Member whose valid Username is all", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_all", username: "all", role: "member", joinedAt: "2026-07-01T00:00:00.000Z" },
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-02T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_all",
        groupId: walkerLabs.groupId,
        text: "Work assigned to all",
        assignee: { state: "assigned", userId: "user_all", username: "all" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
      {
        taskId: "task_shane",
        groupId: walkerLabs.groupId,
        text: "Work assigned to shane",
        assignee: { state: "assigned", userId: "user_shane", username: "shane" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-02T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");
  await page.getByLabel("Assignee filter").selectOption({ label: "@all" });

  const lanes = page.getByTestId("task-lane");
  await expect(lanes).toHaveCount(1);
  await expect(lanes.getByRole("heading")).toHaveText("@all");
  await expect(page.getByText("Work assigned to all")).toBeVisible();
  await expect(page.getByText("Work assigned to shane")).toHaveCount(0);
});

test("keeps an empty Unassigned lane visible after the final recovery", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_unassigned_last",
        groupId: walkerLabs.groupId,
        text: "Recover the last Task",
        assignee: { state: "unassigned" },
        dueDate: null,
        state: "open",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: null,
      },
    ],
  });
  await page.goto("/");
  await page.getByLabel("Assignee filter").selectOption({ label: "Unassigned" });
  await page.getByRole("button", { name: "Assign" }).click();
  await page.getByRole("dialog", { name: "Assign Task" }).getByRole("button", { name: "Assign Task" }).click();

  const lane = page.getByTestId("task-lane");
  await expect(lane).toHaveCount(1);
  await expect(lane.getByRole("heading")).toHaveText("Unassigned");
  await expect(lane.getByText("No Tasks here.")).toBeVisible();
});

test("keeps done Tasks visible in departed assignee lanes", async ({ page }) => {
  await startSignedIn(page);
  await installApi(page, {
    user: signedInUser,
    groups: [walkerLabs],
    members: [
      { userId: "user_shane", username: "shane", role: "admin", joinedAt: "2026-07-01T00:00:00.000Z" },
    ],
    tasks: [
      {
        taskId: "task_departed",
        groupId: walkerLabs.groupId,
        text: "Completed before departure",
        assignee: { state: "assigned", userId: "user_zora", username: "zora" },
        dueDate: null,
        state: "done",
        createdAt: "2026-07-01T10:00:00.000Z",
        completedAt: "2026-07-15T10:00:00.000Z",
      },
    ],
  });
  await page.goto("/");
  await page.getByLabel("Task status").selectOption("done");

  const departedLane = page.getByTestId("task-lane").filter({ has: page.getByRole("heading", { name: "@zora" }) });
  await expect(departedLane.getByText("Former Member")).toBeVisible();
  await expect(departedLane.getByText("Completed before departure")).toBeVisible();
  await expect(departedLane.getByRole("button", { name: "Add Task" })).toHaveCount(0);

  await page.getByLabel("Assignee filter").selectOption({ label: "@zora" });
  await expect(page.getByTestId("task-lane")).toHaveCount(1);
  await expect(page.getByText("Completed before departure")).toBeVisible();
});
