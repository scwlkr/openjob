import { expect, type Page, test } from "@playwright/test";

type Group = {
  groupId: string;
  name: string;
  role: "member" | "admin";
  createdAt: string;
};

type ApiState = {
  user: { userId: string; username: string | null; usernameRequired: boolean };
  groups: Group[];
  concealedGroupIds: Set<string>;
  authorizationHeaders: string[];
  failMe: boolean;
  failGroups: boolean;
  hangMe: boolean;
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

async function installApi(
  page: Page,
  initial: Partial<Pick<ApiState, "user" | "groups" | "failMe" | "failGroups" | "hangMe">> = {},
) {
  const state: ApiState = {
    user: initial.user ?? {
      userId: "user_shane",
      username: null,
      usernameRequired: true,
    },
    groups: [...(initial.groups ?? [])],
    concealedGroupIds: new Set(),
    authorizationHeaders: [],
    failMe: initial.failMe ?? false,
    failGroups: initial.failGroups ?? false,
    hangMe: initial.hangMe ?? false,
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
      if (state.failMe) {
        await error(500, "internal_error", "An unexpected error occurred.");
        return;
      }
      await reply(200, { data: state.user });
      return;
    }

    if (url.pathname === "/api/v1/me/username" && request.method() === "PUT") {
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

    const groupId = decodeURIComponent(url.pathname.slice("/api/v1/groups/".length));
    if (request.method() === "GET" && groupId) {
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
  state.failMe = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("OpenJob could not load right now.");

  state.failMe = false;
  state.failGroups = true;
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("OpenJob could not load right now.");
  await expect(page.getByRole("heading", { name: "Create your first Group" })).toHaveCount(0);
});

test("turns Firebase initialization failure into an understandable auth state", async ({ page }) => {
  await installApi(page);
  await page.goto("/?scenario=auth-error");
  await expect(page.getByRole("alert")).toContainText("Google sign-in could not start. Try again.");
});
