import { expect, test } from "@playwright/test";

test("signs in, claims a Username, creates a Group, and remembers it", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Your team. One clear list." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(
    page.getByRole("heading", { name: "Claim your Username" }),
  ).toBeVisible();
  await page.getByLabel("Username").fill("Shane");
  await page.getByRole("button", { name: "Claim Username" }).click();
  await expect(page.getByText("Use lowercase letters")).toBeVisible();

  await page.getByLabel("Username").fill("shane");
  await page.getByRole("button", { name: "Claim Username" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your first Group" }),
  ).toBeVisible();

  await page.getByLabel("Group Name").fill("Walker Labs");
  await page.getByRole("button", { name: "Create Group" }).click();
  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Walker Labs", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Walker Labs", exact: true }),
  ).toBeVisible();
});

test("requires an explicit choice for multiple Groups and remembers that choice", async ({
  page,
}) => {
  await page.goto("/?scenario=multiple");

  await expect(
    page.getByRole("heading", { name: "Choose a Group" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "OpenJob Core", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "OpenJob Core", exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "OpenJob Core", exact: true }),
  ).toBeVisible();
});

test("clears stale or concealed Group access without exposing private details", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("openjob:selected-group-id", "grp_retired");
  });
  await page.goto("/?scenario=multiple");

  await expect(
    page.getByText("That Group is no longer accessible. Choose another."),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("openjob:selected-group-id"),
      ),
    )
    .toBeNull();

  await page.goto("/?scenario=concealed");
  await expect(
    page.getByText("That Group is no longer accessible."),
  ).toBeVisible();
  await expect(page.getByText("Retired Operations")).toHaveCount(0);
});

test("uses a persistent rail on desktop and a horizontal Group picker on narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?scenario=multiple");
  await page.getByRole("button", { name: "Walker Labs", exact: true }).click();

  const desktopRail = await page.getByTestId("group-rail").boundingBox();
  const desktopWork = await page.getByTestId("group-workspace").boundingBox();
  expect(desktopRail).not.toBeNull();
  expect(desktopWork).not.toBeNull();
  expect(desktopRail!.width).toBeLessThan(300);
  expect(desktopRail!.height).toBeGreaterThanOrEqual(790);
  expect(desktopWork!.x).toBeGreaterThanOrEqual(desktopRail!.width - 1);

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowRail = await page.getByTestId("group-rail").boundingBox();
  const firstGroup = await page
    .getByRole("button", { name: "Walker Labs", exact: true })
    .boundingBox();
  const secondGroup = await page
    .getByRole("button", { name: "OpenJob Core", exact: true })
    .boundingBox();
  expect(narrowRail).not.toBeNull();
  expect(narrowRail!.width).toBeGreaterThanOrEqual(389);
  expect(narrowRail!.height).toBeLessThan(240);
  expect(Math.abs(firstGroup!.y - secondGroup!.y)).toBeLessThan(2);
});

test("explains loading and service failures", async ({ page }) => {
  await page.goto("/?scenario=loading");
  await expect(page.getByText("Loading your OpenJob…")).toBeVisible();

  await page.goto("/?scenario=error");
  await expect(page.getByRole("alert")).toContainText(
    "OpenJob could not load right now.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
