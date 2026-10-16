import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFile } from "node:fs/promises";

const ical = (uid: string, title: string, extra = "") => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenJob test//EN", "BEGIN:VEVENT", `UID:${uid}`, "DTSTAMP:20261016T080000Z", "DTSTART:20270406T140000Z", "DTEND:20270406T143000Z", `SUMMARY:${title}`, ...(extra ? [extra] : []), "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
async function owner(request: APIRequestContext) { return (await (await request.get("/__test/session/alex")).json()).token as string; }
async function snapshot(request: APIRequestContext, token: string) { return (await (await request.get("/api/v1/workspace/snapshot", { headers: { authorization: `Bearer ${token}` } })).json()).data; }

test("actual Calendar file download, reviewed import and durable dedupe work on desktop and phone", async ({ page, request }, testInfo) => {
  const token = await owner(request);
  const command = (data: unknown) => request.post("/api/v1/workspace/commands", { headers: { authorization: `Bearer ${token}` }, data });
  expect((await command({ type: "mail.examples.add" })).status()).toBe(200);
  const source = await command({ type: "task.create", title: "Portable scheduled Task", messageId: "example-message-1" });
  const task = (await source.json()).data;
  expect((await command({ type: "task.schedule", taskId: task.id, calendarId: "personal", start: "2027-04-06T09:00:00.000Z", end: "2027-04-06T09:30:00.000Z" })).status()).toBe(200);
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const files = page.getByRole("region", { name: "Calendar files", exact: true });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const download = page.waitForEvent("download");
    await files.getByRole("button", { name: "Download calendar file", exact: true }).click();
    const result = await download;
    expect(result.suggestedFilename()).toBe("openjob-calendar.ics");
    const exported = await readFile((await result.path())!, "utf8");
    expect(exported).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(exported).toContain("SUMMARY:Portable scheduled Task\r\n");
    for (const secret of ["example-message-1", "mail:example", task.id, "alex.personal@", "sourceAccountId", "taskId", "ATTENDEE", "ORGANIZER"]) expect(exported).not.toContain(secret);
    const uid = `portable-file-${width}-${Date.now()}`;
    const title = `Portable, Café 日本語 ${width}`;
    const input = { name: "portable.ics", mimeType: "text/calendar", buffer: Buffer.from(ical(uid, title.replace(",", "\\,"))) };
    await files.getByLabel("Preview iCalendar file", { exact: true }).setInputFiles(input);
    const preview = files.getByRole("region", { name: "Calendar import preview", exact: true });
    await expect(preview).toContainText(title);
    expect((await snapshot(request, token)).events.filter((event: { title: string }) => event.title === title)).toHaveLength(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await files.screenshot({ path: testInfo.outputPath(`calendar-file-preview-${width}.png`) });
    await files.getByRole("button", { name: "Import reviewed events", exact: true }).click();
    await files.getByRole("button", { name: "Confirm calendar import", exact: true }).click();
    await expect(page.getByTestId("calendar-event").filter({ hasText: title })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(page.getByTestId("calendar-event").filter({ hasText: title })).toBeVisible();
    await files.getByLabel("Preview iCalendar file", { exact: true }).setInputFiles(input);
    await files.getByRole("button", { name: "Import reviewed events", exact: true }).click();
    await files.getByRole("button", { name: "Confirm calendar import", exact: true }).click();
    await expect(preview).toHaveCount(0);
    expect((await snapshot(request, token)).events.filter((event: { title: string }) => event.title === title)).toHaveLength(1);
    await files.getByLabel("Preview iCalendar file", { exact: true }).setInputFiles({ ...input, buffer: Buffer.from(ical(uid, "Changed duplicate must conflict")) });
    await files.getByRole("button", { name: "Import reviewed events", exact: true }).click();
    await files.getByRole("button", { name: "Confirm calendar import", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "UID already exists" })).toBeVisible();
    expect((await snapshot(request, token)).events.filter((event: { title: string }) => event.title === "Changed duplicate must conflict")).toHaveLength(0);
    await files.getByRole("button", { name: "Cancel file preview", exact: true }).click();
  }
});

test("unsupported files and a changed Calendar after review produce zero import writes", async ({ page, request }) => {
  const token = await owner(request);
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const files = page.getByRole("region", { name: "Calendar files", exact: true });
  let writes = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/workspace/commands") && request.postDataJSON()?.type === "calendar.import") writes += 1; });
  const before = await snapshot(request, token);
  await files.getByLabel("Preview iCalendar file", { exact: true }).setInputFiles({ name: "recurring.ics", mimeType: "text/calendar", buffer: Buffer.from(ical("unsupported", "Never silently flatten recurrence", "RRULE:FREQ=DAILY")) });
  await expect(files.getByRole("alert")).toContainText("unsupported calendar features");
  expect(writes).toBe(0);
  expect((await snapshot(request, token)).events).toEqual(before.events);
  const input = { name: "review.ics", mimeType: "text/calendar", buffer: Buffer.from(ical(`review-${Date.now()}`, "Requires current Calendar review")) };
  await files.getByLabel("Preview iCalendar file", { exact: true }).setInputFiles(input);
  await expect(files.getByRole("region", { name: "Calendar import preview", exact: true })).toContainText("Requires current Calendar review");
  expect((await request.post("/api/v1/workspace/commands", { headers: { authorization: `Bearer ${token}` }, data: { type: "calendar.create", calendarId: "personal", title: "Concurrent newer Calendar work", start: "2027-04-06T16:00:00.000Z", end: "2027-04-06T16:30:00.000Z" } })).status()).toBe(200);
  await files.getByRole("button", { name: "Import reviewed events", exact: true }).click();
  await files.getByRole("button", { name: "Confirm calendar import", exact: true }).click();
  await expect(files.getByRole("alert")).toContainText("Refresh and preview the file again");
  const after = await snapshot(request, token);
  expect(after.events.some((event: { title: string }) => event.title === "Concurrent newer Calendar work")).toBe(true);
  expect(after.events.some((event: { title: string }) => event.title === "Requires current Calendar review")).toBe(false);
});
