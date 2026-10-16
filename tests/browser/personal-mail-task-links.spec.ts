import { expect, test } from "@playwright/test";

test("Mail opens exact linked Tasks and preserves unfinished editors on desktop and phone", async ({ page, request }, testInfo) => {
  const { token } = await (await request.get("/__test/session/alex")).json();
  const command = async (input: unknown) => {
    const response = await request.post("/api/v1/workspace/commands", { headers: { authorization: `Bearer ${token}` }, data: input });
    expect(response.status()).toBe(200); return (await response.json()).data;
  };
  await command({ type: "mail.examples.add" });
  for (const width of [1280, 390]) {
    const title = `Mail linked work ${width} ${Date.now()}`;
    const first = await command({ type: "task.create", title, messageId: "example-message-3" });
    const completed = await command({ type: "task.create", title: `${title} completed`, messageId: "example-message-3" });
    await command({ type: "task.complete", taskId: completed.id, completed: true });
    await command({ type: "task.create", title: `${title} other message`, messageId: "example-message-1" });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const row = page.getByTestId("task-row").filter({ has: page.getByText(title, { exact: true }) });
    await row.getByRole("button", { name: "Edit title", exact: true }).click();
    await page.getByLabel("Task title", { exact: true }).fill(`${title} unfinished title`);
    await page.getByLabel("Search tasks", { exact: true }).fill("hide every task");
    await page.getByRole("button", { name: "Mail", exact: true }).click();
    await page.getByTestId("mail-row").filter({ hasText: "Design review notes" }).click();
    await page.getByLabel("Reply draft", { exact: true }).fill(`${title} unfinished reply`);
    await page.getByRole("button", { name: "Compose draft", exact: true }).click();
    await page.getByLabel("Subject", { exact: true }).fill(`${title} unfinished composition`);
    const links = page.getByRole("region", { name: "Tasks from this message", exact: true });
    await expect(links.getByRole("button", { name: `Open task: ${title}`, exact: true })).toBeVisible();
    await expect(links.getByRole("button", { name: `Open task: ${title} completed`, exact: true })).toBeVisible();
    await expect(links).toContainText("Completed");
    await expect(links).not.toContainText(`${title} other message`);
    await links.getByRole("button", { name: `Open task: ${title}`, exact: true }).click();
    await expect(row).toBeFocused();
    await expect(page.getByLabel("Search tasks", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(`${title} unfinished title`);
    await row.getByRole("button", { name: "Open source mail", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Design review notes", exact: true })).toBeFocused();
    await expect(page.getByLabel("Reply draft", { exact: true })).toHaveValue(`${title} unfinished reply`);
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue(`${title} unfinished composition`);
    const previousLinks = await links.getByRole("button").count();
    await page.getByRole("button", { name: "Create another task from mail", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Private task created");
    await expect(links.getByRole("button")).toHaveCount(previousLinks + 1);
    await expect(links.getByRole("button", { name: "Open task: Design review notes", exact: true }).last()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mail-linked-tasks-${width}.png`), fullPage: true });
    await links.getByRole("button", { name: `Open task: ${title} completed`, exact: true }).click();
    await expect(page.getByTestId("task-row").filter({ has: page.getByText(`${title} completed`, { exact: true }) })).toBeFocused();
    await expect(page.getByRole("checkbox", { name: `Complete ${title} completed`, exact: true })).toBeChecked();
    expect(first.id).not.toBe(completed.id);
  }
  await page.getByLabel("Test identity", { exact: true }).selectOption("sam");
  await page.getByRole("button", { name: "Mail", exact: true }).click();
  await expect(page.getByRole("region", { name: "Tasks from this message", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Subject", { exact: true })).toHaveCount(0);
});
