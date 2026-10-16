import { expect, test, type APIRequestContext } from "@playwright/test";
import type { WorkspaceView } from "../../shared/workspace-contracts";

async function snapshot(request: APIRequestContext) {
  const response = await request.get("/api/workspace/snapshot", { headers: { "x-openjob-fixture-owner": "demo_alex" } });
  expect(response.ok()).toBe(true);
  return (await response.json() as { data: WorkspaceView }).data;
}

test("saved replies and composed drafts can be edited and simulated without actual delivery", async ({ page, request }, testInfo) => {
  const marker = `Draft lifecycle ${Date.now()}`;
  await page.goto("/workspace");
  await page.getByTestId("mail-row").filter({ hasText: "Design review notes" }).click();
  await page.getByLabel("Reply draft", { exact: true }).fill(`${marker} first reply`);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("No message sent");
  const initial = (await snapshot(request)).drafts.find((item) => item.messageId === "alex_msg_design");
  expect(initial).toBeDefined();
  await page.getByLabel("Reply draft", { exact: true }).fill(`${marker} second reply`);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByTestId("saved-draft").filter({ hasText: `${marker} second reply` })).toBeVisible();
  const updated = (await snapshot(request)).drafts.filter((item) => item.messageId === "alex_msg_design");
  expect(updated).toHaveLength(1);
  expect(updated[0].id).toBe(initial!.id);

  await page.getByTestId("saved-draft").filter({ hasText: `${marker} second reply` }).getByRole("button", { name: "Edit draft", exact: true }).click();
  const editor = page.getByRole("region", { name: "Draft editor" });
  await expect(editor.getByLabel("From mailbox")).toBeDisabled();
  await expect(editor.getByLabel("From mailbox")).toHaveValue("alex_outlook");
  await expect(editor.getByLabel("To", { exact: true })).toHaveValue("noah@work.example.invalid");
  await expect(editor.getByLabel("Subject", { exact: true })).toHaveValue("Re: Design review notes");
  await editor.getByLabel("To", { exact: true }).fill("reply-reviewer@example.invalid");
  await editor.getByLabel("Subject", { exact: true }).fill(`${marker} revised reply`);
  await editor.getByLabel("Message", { exact: true }).fill("Revised fixture reply body.");
  await editor.getByRole("button", { name: "Save draft changes", exact: true }).click();
  const replyDraft = page.getByTestId("saved-draft").filter({ hasText: `${marker} revised reply` });
  await expect(replyDraft).toContainText("Revised fixture reply body.");
  expect((await snapshot(request)).drafts.find((item) => item.id === initial!.id)?.subject).toBe(`${marker} revised reply`);
  await replyDraft.getByRole("button", { name: "Simulate send", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("No actual delivery occurred");
  await expect(replyDraft).toHaveCount(0);
  const sentReply = page.getByTestId("sent-message").filter({ hasText: `${marker} revised reply` });
  await expect(sentReply).toContainText("From: alex@outlook.example.invalid");
  await expect(sentReply).toContainText("To: reply-reviewer@example.invalid");
  await expect(sentReply).toContainText("Revised fixture reply body.");

  await page.getByRole("button", { name: "Compose draft", exact: true }).click();
  await page.getByLabel("From mailbox").selectOption("alex_imap");
  await page.getByLabel("To", { exact: true }).fill("compose-reviewer@example.invalid");
  await page.getByLabel("Subject", { exact: true }).fill(`${marker} composed`);
  await page.getByLabel("Message", { exact: true }).fill("Initial composed fixture body.");
  await page.getByRole("button", { name: "Save new draft", exact: true }).click();
  await page.getByTestId("saved-draft").filter({ hasText: `${marker} composed` }).getByRole("button", { name: "Edit draft", exact: true }).click();
  await expect(editor.getByLabel("From mailbox")).toHaveValue("alex_imap");
  await editor.getByLabel("Message", { exact: true }).fill("Updated composed fixture body.");
  await editor.getByRole("button", { name: "Save draft changes", exact: true }).click();
  await page.reload();
  const composedDraft = page.getByTestId("saved-draft").filter({ hasText: `${marker} composed` });
  await expect(composedDraft).toContainText("Updated composed fixture body.");
  await composedDraft.getByRole("button", { name: "Simulate send", exact: true }).click();
  const sentCompose = page.getByTestId("sent-message").filter({ hasText: `${marker} composed` });
  await expect(sentCompose).toContainText("From: alex@studio.example.invalid");
  await expect(sentCompose).toContainText("To: compose-reviewer@example.invalid");
  await expect(sentCompose).toContainText("Updated composed fixture body.");
  await expect(composedDraft).toHaveCount(0);
  await page.reload();
  await expect(sentCompose).toBeVisible();
  await expect(sentReply).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("workspace-simulated-sent.png"), fullPage: true });

  await page.getByLabel("Fixture owner").selectOption("demo_sam");
  await expect(page.getByTestId("mail-row")).toContainText("Sam's private planning");
  await expect(page.getByTestId("sent-message")).toHaveCount(0);
  await expect(page.getByTestId("saved-draft")).toHaveCount(0);
  await page.getByLabel("Fixture owner").selectOption("demo_alex");
  await expect(sentCompose).toBeVisible();
  await expect(sentReply).toBeVisible();
});
