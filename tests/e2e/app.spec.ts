import { expect, test } from "@playwright/test";

test("loads forests, applies filters, and resolves nearest legal spot", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Campfire Allowed Near Me" })).toBeVisible();
  await expect(page.getByTestId("forest-row").first()).toBeVisible();

  const totalRows = await page.getByTestId("forest-row").count();
  expect(totalRows).toBeGreaterThan(0);

  await page.getByTestId("filter-select").selectOption("ONLY_BANNED");
  const bannedRows = await page.getByTestId("forest-row").count();
  expect(bannedRows).toBeLessThanOrEqual(totalRows);
  if (bannedRows > 0) {
    const bannedStatuses = await page.locator("[data-testid='forest-row'] .status-pill").allTextContents();
    expect(bannedStatuses.every((text) => text.includes("Banned"))).toBe(true);
  }

  await page.getByTestId("filter-select").selectOption("ONLY_ALLOWED");
  const allowedRows = await page.getByTestId("forest-row").count();
  expect(allowedRows).toBeLessThanOrEqual(totalRows);
  if (allowedRows > 0) {
    const allowedStatuses = await page.locator("[data-testid='forest-row'] .status-pill").allTextContents();
    expect(allowedStatuses.every((text) => text.includes("No ban"))).toBe(true);
  }

  await page.getByTestId("locate-btn").click();
  await expect
    .poll(async () => {
      const nearestCount = await page.getByTestId("nearest-spot").count();
      const nearestEmptyCount = await page.getByTestId("nearest-empty").count();
      return nearestCount + nearestEmptyCount;
    })
    .toBeGreaterThan(0);
});

test("shows stale warning banner when upstream scrape falls back to cache", async ({
  page
}) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: true,
        sourceName: "Forestry Corporation NSW",
        warnings: ["Forestry site anti-bot verification blocked scraping."],
        nearestLegalSpot: null,
        forests: []
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("warning-banner")).toContainText(
    "anti-bot verification blocked scraping"
  );
});
