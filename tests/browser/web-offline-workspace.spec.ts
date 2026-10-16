import { expect, test, type Page } from "@playwright/test";

const saved = (page: Page) => page.getByRole("region", { name: "Saved Tasks and Calendar", exact: true });
async function openSaved(page: Page) {
  await page.getByRole("button", { name: "Saved Tasks and Calendar", exact: true }).click();
  await expect(saved(page)).toBeVisible();
}
async function start(page: Page) {
  await page.goto("/workspace");
  await expect(page.getByLabel("New task", { exact: true })).toBeVisible();
  await openSaved(page);
  await saved(page).getByRole("button", { name: "Refresh from server", exact: true }).click();
  await expect(saved(page).getByRole("heading", { name: "Synced at last check", exact: true })).toBeVisible();
}
async function add(page: Page, title: string) {
  await saved(page).getByLabel("New task", { exact: true }).fill(title);
  await saved(page).getByRole("button", { name: "Add task", exact: true }).click();
  await expect(saved(page).getByTestId("task-row").filter({ hasText: title })).toBeVisible();
}

test("built public shell reloads offline with durable task schedules and Calendar blocks, then explicitly syncs", async ({ page, context }, testInfo) => {
  const title = `Offline browser ${Date.now()}`;
  await start(page);
  await page.getByRole("button", { name: "Prepare offline page", exact: true }).click();
  await expect(page.getByText(/^Offline page ready\./)).toBeVisible();
  await context.setOffline(true);
  await add(page, title);
  let row = saved(page).getByTestId("task-row").filter({ hasText: title });
  await row.getByRole("button", { name: "Schedule", exact: true }).click();
  await saved(page).getByLabel("Start (UTC)", { exact: true }).fill("2027-04-06T09:00");
  await saved(page).getByLabel("End (UTC)", { exact: true }).fill("2027-04-06T09:30");
  await saved(page).getByRole("button", { name: "Save schedule", exact: true }).click();
  await row.getByRole("checkbox").click();
  await expect(row.getByRole("checkbox")).toBeChecked();
  await saved(page).getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(saved(page).getByTestId("calendar-event").filter({ hasText: title })).toBeVisible();
  await saved(page).getByLabel("Block title", { exact: true }).fill(`${title} block`);
  await saved(page).getByLabel("Start (UTC)", { exact: true }).fill("2027-04-06T11:00");
  await saved(page).getByLabel("End (UTC)", { exact: true }).fill("2027-04-06T11:30");
  await saved(page).getByRole("button", { name: "Create block", exact: true }).click();
  await expect(saved(page).getByTestId("calendar-event").filter({ hasText: `${title} block` })).toBeVisible();
  await expect(saved(page).getByRole("heading", { name: "Pending · saved in browser", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("web-offline-calendar-desktop.png"), fullPage: true });
  await page.reload();
  await expect(saved(page)).toBeVisible();
  row = saved(page).getByTestId("task-row").filter({ hasText: title });
  await expect(row.getByRole("checkbox")).toBeChecked();
  await expect(row).toContainText("2027");
  await page.setViewportSize({ width: 390, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("web-offline-pending-phone.png"), fullPage: true });
  const urls = await page.evaluate(async () => { const output: string[] = []; for (const key of await caches.keys()) for (const request of await (await caches.open(key)).keys()) output.push(request.url); return output; });
  expect(urls.some(url => url.endsWith("/workspace"))).toBe(true);
  expect(urls.some(url => /\/api\/|\/__test\/|token|auth/i.test(new URL(url).pathname))).toBe(false);
  await context.setOffline(false);
  await saved(page).getByRole("button", { name: "Sync saved changes", exact: true }).click();
  await expect(saved(page).getByRole("heading", { name: "Synced at last check", exact: true })).toBeVisible();
  await saved(page).getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(saved(page).getByTestId("calendar-event").filter({ hasText: `${title} block` })).toBeVisible();
  await page.getByRole("button", { name: "Online workspace", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("task-row").filter({ hasText: title }).getByRole("checkbox")).toBeChecked();
});

test("competing server work requires explicit review, and signout locks another tab", async ({ page, context, request }, testInfo) => {
  await start(page);
  const local = `Local review ${Date.now()}`;
  await add(page, local);
  const token = (await (await request.get("/__test/session/alex")).json()).token;
  const response = await request.post("/api/v1/workspace/commands", { headers: { authorization: `Bearer ${token}` }, data: { type: "task.create", title: "Newer server work" } });
  expect(response.status()).toBe(200);
  await saved(page).getByRole("button", { name: "Sync saved changes", exact: true }).click();
  await expect(saved(page).getByRole("region", { name: "Conflict review", exact: true })).toContainText("Newer server work");
  await expect(saved(page).getByRole("region", { name: "Conflict review", exact: true })).toContainText(local);
  await page.screenshot({ path: testInfo.outputPath("web-offline-conflict-desktop.png"), fullPage: true });
  await saved(page).getByRole("button", { name: "Use server version", exact: true }).click();
  await saved(page).getByRole("button", { name: "Confirm discard local changes", exact: true }).click();
  await expect(saved(page).getByTestId("task-row").filter({ hasText: local })).toHaveCount(0);
  await expect(saved(page).getByTestId("task-row").filter({ hasText: "Newer server work" })).toBeVisible();
  const other = await context.newPage();
  await other.goto("/workspace");
  await openSaved(other);
  await expect(saved(other).getByTestId("task-row").filter({ hasText: "Newer server work" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(other.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await expect(saved(other)).toHaveCount(0);
});

test("opt-in authored Mail text survives offline reload and recovers on reconnect without submission", async ({ page, context, request }) => {
  const token = (await (await request.get("/__test/session/alex")).json()).token;
  expect((await request.post("/api/v1/workspace/commands", { headers: { authorization: `Bearer ${token}` }, data: { type: "mail.examples.add" } })).status()).toBe(200);
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Mail", exact: true }).click();
  await page.getByLabel("Keep unfinished drafts in this browser", { exact: true }).check();
  await page.getByRole("button", { name: "Compose draft", exact: true }).click();
  await page.getByLabel("To", { exact: true }).fill("invented@example.invalid");
  await page.getByLabel("Subject", { exact: true }).fill("Only authored subject");
  await page.getByLabel("Message", { exact: true }).fill("Only authored outgoing text, never submitted");
  await page.getByRole("button", { name: "Prepare offline page", exact: true }).click();
  await expect(page.getByText(/^Offline page ready\./)).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(saved(page)).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await page.getByRole("button", { name: "Mail", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("Only authored outgoing text, never submitted");
  await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("Only authored subject");
  const snapshot = (await (await request.get("/api/v1/workspace/snapshot", { headers: { authorization: `Bearer ${token}` } })).json()).data;
  expect(snapshot.drafts.some((draft: { body: string }) => draft.body.includes("Only authored outgoing"))).toBe(false);
  await page.getByLabel("Test identity", { exact: true }).selectOption("sam");
  await page.getByRole("button", { name: "Mail", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
});

test("a stale editor in a second tab cannot overwrite a newer browser edit", async ({ page, context }) => {
  await start(page);
  const title = `Two tab task ${Date.now()}`;
  await add(page, title);
  const other = await context.newPage();
  await other.goto("/workspace");
  await openSaved(other);
  const row = (tab: Page) => saved(tab).getByTestId("task-row").filter({ hasText: title });
  await row(other).getByRole("button", { name: "Edit title", exact: true }).click();
  await saved(other).getByLabel("Task title", { exact: true }).fill("Stale second tab title");
  await row(page).getByRole("button", { name: "Edit title", exact: true }).click();
  await saved(page).getByLabel("Task title", { exact: true }).fill(`${title} newer`);
  await saved(page).getByRole("button", { name: "Save title", exact: true }).click();
  await expect(row(page)).toContainText(`${title} newer`);
  await saved(other).getByRole("button", { name: "Save title", exact: true }).click();
  await expect(saved(other).getByRole("alert")).toContainText("changed in another tab");
  await expect(saved(other).getByLabel("Task title", { exact: true })).toHaveValue("Stale second tab title");
  await expect(row(other)).toContainText(`${title} newer`);
});

test("competing unfinished Mail recovery writes and clears retain saved text and stale editor input", async ({ page, context, request }) => {
  const token = (await (await request.get("/__test/session/alex")).json()).token;
  expect((await request.post("/api/v1/workspace/commands", { headers: { authorization: `Bearer ${token}` }, data: { type: "mail.examples.add" } })).status()).toBe(200);
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Mail", exact: true }).click();
  await page.getByLabel("Keep unfinished drafts in this browser", { exact: true }).check();
  const stored = (tab: Page) => tab.evaluate(() => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open("openjob-private-workspace-v1", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const read = db.transaction("private-state", "readonly").objectStore("private-state").get("current"); read.onsuccess = () => { db.close(); resolve(JSON.stringify(read.result)); }; read.onerror = () => { db.close(); reject(read.error); }; };
  }));
  await expect.poll(() => stored(page)).toContain('"enabled":true');
  const other = await context.newPage();
  await other.goto("/workspace");
  await other.getByRole("button", { name: "Mail", exact: true }).click();
  await expect(other.getByLabel("Keep unfinished drafts in this browser", { exact: true })).toBeChecked();
  for (const tab of [page, other]) await tab.getByRole("button", { name: "Compose draft", exact: true }).click();
  await page.getByLabel("Message", { exact: true }).fill("First tab saved authored text");
  await expect.poll(() => stored(page)).toContain("First tab saved authored text");
  await other.getByLabel("Message", { exact: true }).fill("Second tab editor must survive");
  await expect(other.getByText(/^Unfinished text changed in another tab\./)).toBeVisible();
  await expect(other.getByLabel("Message", { exact: true })).toHaveValue("Second tab editor must survive");
  expect(await stored(page)).toContain("First tab saved authored text");
  expect(await stored(page)).not.toContain("Second tab editor must survive");
  await other.getByLabel("Keep unfinished drafts in this browser", { exact: true }).uncheck();
  await expect(other.getByText(/^Unfinished text changed in another tab\./)).toBeVisible();
  expect(await stored(page)).toContain("First tab saved authored text");
  await page.reload();
  await page.getByRole("button", { name: "Mail", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue("First tab saved authored text");
});
