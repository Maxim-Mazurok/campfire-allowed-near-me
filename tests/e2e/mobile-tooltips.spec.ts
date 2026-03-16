/**
 * Mobile-specific e2e tests for InfoTooltip accessibility.
 *
 * These tests run at a mobile viewport (iPhone 14 — 390×844) with touch
 * enabled and isMobile=true, verifying that all info tooltips are reachable
 * via tap-only interaction (no hover).
 */

import { test, expect } from "@playwright/test";

// ── Mobile device configuration ─────────────────────────────────────
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

// ── Shared fixture ──────────────────────────────────────────────────

const buildMobileSnapshot = () =>
  JSON.stringify({
    schemaVersion: 7,
    fetchedAt: "2026-03-16T10:00:00.000Z",
    stale: false,
    sourceName: "Forestry Corporation NSW",
    availableFacilities: [
      {
        key: "camping_and_picnics",
        label: "Camping and picnics",
        paramName: "camping_and_picnics",
        iconKey: "camping",
      },
      {
        key: "toilets",
        label: "Toilets",
        paramName: "toilets",
        iconKey: "toilets",
      },
    ],
    availableClosureTags: [
      { key: "ROAD_ACCESS", label: "Road/trail access" },
      { key: "CAMPING", label: "Camping impact" },
    ],
    matchDiagnostics: { unmatchedFacilitiesForests: [], fuzzyMatches: [] },
    closureDiagnostics: { unmatchedNotices: [], fuzzyMatches: [] },
    warnings: [],
    forests: [
      {
        id: "mobile-forest-open",
        source: "Forestry Corporation NSW",
        areas: [
          {
            areaName: "Mobile Area",
            areaUrl: "https://example.com/area",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            banScope: "ALL",
          },
        ],
        forestName: "Mobile Test Forest",
        forestUrl:
          "https://www.forestrycorporation.com.au/visit/forests/mobile-test",
        totalFireBanStatus: "NOT_BANNED",
        totalFireBanStatusText: "No Total Fire Ban",
        latitude: -33.9,
        longitude: 151.1,
        geocodeName: "Mobile Test Forest",
        facilities: { camping_and_picnics: true, toilets: true },
        closureStatus: "PARTIAL",
        closureNotices: [
          {
            id: "notice-mobile-1",
            title: "Mobile Test Forest: Walking track closure notice",
            detailUrl: "https://example.com/notices/mobile-1",
            listedAt: null,
            listedAtText: null,
            untilAt: null,
            untilText: null,
            forestNameHint: "Mobile Test Forest",
            status: "PARTIAL",
            tags: ["ROAD_ACCESS"],
            detailText:
              "Walking track closed due to maintenance. Camping areas remain open.",
            structuredImpact: {
              source: "RULES",
              confidence: "HIGH",
              campingImpact: "NONE",
              access2wdImpact: "NONE",
              access4wdImpact: "NONE",
              rationale: "Walking track closure only — vehicle access and camping unaffected.",
            },
          },
        ],
      },
    ],
  });

const interceptSnapshot = async (
  page: import("@playwright/test").Page,
  snapshotBody?: string
) => {
  await page.route("**/forests-snapshot.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: snapshotBody ?? buildMobileSnapshot(),
    });
  });
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Wait for the forest list to appear and be non-empty. */
const waitForForestList = async (page: import("@playwright/test").Page) => {
  const forestRow = page.getByTestId("forest-row").first();
  await expect(forestRow).toBeVisible();
  return forestRow;
};

/** Tap the first info-tooltip trigger matching the given locator scope. */
const tapInfoTrigger = async (scope: import("@playwright/test").Locator) => {
  const trigger = scope.locator(".info-tooltip-trigger").first();
  await expect(trigger).toBeVisible();
  await trigger.tap();
  return trigger;
};

// ── Tests ───────────────────────────────────────────────────────────

test.describe("Mobile InfoTooltip accessibility", () => {
  test.beforeEach(async ({ page }) => {
    await interceptSnapshot(page);
  });

  test("forest card: solid fuel ban info tooltip opens on tap and closes on outside tap", async ({
    page,
  }) => {
    await page.goto("/");
    const forestRow = await waitForForestList(page);

    // Find the solid fuel ban badge, then tap the info icon next to it
    const solidFuelBadge = forestRow.locator("[data-testid='closure-badge'], .mantine-Badge").first();
    await expect(solidFuelBadge).toBeVisible();

    // The info tooltip trigger sits adjacent to badges in the forest card
    const trigger = await tapInfoTrigger(forestRow);

    // Popover should be visible
    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(trigger).toHaveClass(/info-tooltip-trigger--active/);

    // Tap outside — on the header
    await page.locator(".app-header").tap();
    await expect(popover).not.toBeVisible();
    await expect(trigger).not.toHaveClass(/info-tooltip-trigger--active/);
  });

  test("forest card: info tooltip toggles closed on second tap", async ({
    page,
  }) => {
    await page.goto("/");
    const forestRow = await waitForForestList(page);
    const trigger = await tapInfoTrigger(forestRow);

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();

    // Second tap on the same trigger — should close
    await trigger.tap();
    await expect(popover).not.toBeVisible();
    await expect(trigger).not.toHaveClass(/info-tooltip-trigger--active/);
  });

  test("forest card: closure badge info tooltip shows detail text on tap", async ({
    page,
  }) => {
    await page.goto("/");
    const forestRow = await waitForForestList(page);

    // The closure badge line has an InfoTooltip with the notice detail
    const closureBadge = forestRow.getByTestId("closure-badge");
    await expect(closureBadge).toBeVisible();

    // The InfoTooltip trigger is a sibling of the closure badge within a wrapper
    const closureWrapper = closureBadge.locator("..");
    const closureTrigger = closureWrapper.locator(".info-tooltip-trigger");
    await expect(closureTrigger).toBeVisible();
    await closureTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("Walking track closed due to maintenance");
  });

  test("forest card: facility icon tooltip appears on tap", async ({
    page,
  }) => {
    await page.goto("/");
    const forestRow = await waitForForestList(page);

    // Facility icons use Mantine <Tooltip> with events={{ touch: true }}
    const facilityIndicator = forestRow
      .locator(".facility-indicator")
      .first();
    await expect(facilityIndicator).toBeVisible();

    await facilityIndicator.tap();

    // Mantine Tooltip renders role="tooltip"
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    // Should contain the facility label and a status
    await expect(tooltip).toContainText(/Camping and picnics|Toilets/);
  });

  test("forest card: distance info tooltip accessible on tap", async ({
    page,
  }) => {
    await page.goto("/");
    const forestRow = await waitForForestList(page);

    const distanceText = forestRow.getByTestId("distance-text");
    await expect(distanceText).toBeVisible();

    // The InfoTooltip trigger is next to the distance text element.
    // Both are inside the .forest-card-details container
    const detailsContainer = distanceText.locator("..");
    const distanceTrigger = detailsContainer.locator(
      ".info-tooltip-trigger"
    ).last();
    await expect(distanceTrigger).toBeVisible();
    await distanceTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/distance|driving/i);
  });

  test("header: snapshot freshness info tooltip opens on tap", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForForestList(page);

    const snapshotText = page.getByTestId("snapshot-freshness");
    await expect(snapshotText).toBeVisible();

    // The InfoTooltip trigger is next to the freshness text inside a Group
    const headerGroup = snapshotText.locator("..");
    const headerTrigger = headerGroup.locator(".info-tooltip-trigger");
    await expect(headerTrigger).toBeVisible();
    await headerTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/twice daily/i);
  });

  test("preset buttons: campfire preset info tooltip opens on tap", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForForestList(page);

    const presetButton = page.getByTestId("preset-legal-campfire");
    await expect(presetButton).toBeVisible();

    // The InfoTooltip trigger is adjacent to the preset button inside a Group
    const presetGroup = presetButton.locator("..");
    const presetTrigger = presetGroup.locator(".info-tooltip-trigger");
    await expect(presetTrigger).toBeVisible();
    await presetTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/campfire allowed/i);
  });

  test("preset buttons: camping preset info tooltip opens on tap", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForForestList(page);

    const presetButton = page.getByTestId("preset-legal-campfire-camping");
    await expect(presetButton).toBeVisible();

    const presetGroup = presetButton.locator("..");
    const presetTrigger = presetGroup.locator(".info-tooltip-trigger");
    await expect(presetTrigger).toBeVisible();
    await presetTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/camping/i);
  });

  test("filter panel: info tooltips accessible on tap at mobile viewport", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForForestList(page);

    // Open the advanced filters
    await page.getByTestId("advanced-filters-toggle").tap();

    const filterPanel = page.locator(".filter-panel");
    await expect(filterPanel).toBeVisible();

    // Tap the first info tooltip in the filter panel (Solid Fuel Fire Ban help)
    const filterTrigger = filterPanel
      .locator(".info-tooltip-trigger")
      .first();
    await expect(filterTrigger).toBeVisible();
    await filterTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    // Should contain solid fuel fire ban explanation
    await expect(popover).toContainText(/solid fuel/i);
    await expect(filterTrigger).toHaveClass(/info-tooltip-trigger--active/);

    // Tap outside on the header to dismiss
    await page.locator(".app-header").tap();
    await expect(popover).not.toBeVisible();
    await expect(filterTrigger).not.toHaveClass(/info-tooltip-trigger--active/);

    // On mobile, CSS :hover can stick after tap. Verify the icon's computed
    // opacity returns to the default 0.5 (not the :hover value of 0.85).
    const opacity = await filterTrigger.evaluate(
      (element) => getComputedStyle(element).opacity
    );
    expect(opacity).toBe("0.5");
  });

  test("filter panel: multiple filter info tooltips work independently on tap", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForForestList(page);

    await page.getByTestId("advanced-filters-toggle").tap();

    const filterPanel = page.locator(".filter-panel");
    const allTriggers = filterPanel.locator(".info-tooltip-trigger");

    // Must have at least two info tooltips in the filter panel
    const triggerCount = await allTriggers.count();
    expect(triggerCount).toBeGreaterThanOrEqual(2);

    // Tap the first trigger — opens its popover
    const firstTrigger = allTriggers.nth(0);
    await firstTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(firstTrigger).toHaveClass(/info-tooltip-trigger--active/);

    // Tap the second trigger — first should dismiss, second should activate
    const secondTrigger = allTriggers.nth(1);
    await secondTrigger.tap();

    // Second trigger should be active, first should not
    await expect(firstTrigger).not.toHaveClass(/info-tooltip-trigger--active/);
    await expect(secondTrigger).toHaveClass(/info-tooltip-trigger--active/);
  });

  test("tapping a different forest card info icon dismisses the first", async ({
    page,
  }) => {
    // Use a snapshot with two forests so we get two cards
    const twoForestSnapshot = JSON.stringify({
      schemaVersion: 7,
      fetchedAt: "2026-03-16T10:00:00.000Z",
      stale: false,
      sourceName: "Forestry Corporation NSW",
      availableFacilities: [],
      availableClosureTags: [],
      matchDiagnostics: { unmatchedFacilitiesForests: [], fuzzyMatches: [] },
      closureDiagnostics: { unmatchedNotices: [], fuzzyMatches: [] },
      warnings: [],
      forests: [
        {
          id: "forest-a",
          source: "Forestry Corporation NSW",
          areas: [
            {
              areaName: "Area A",
              areaUrl: "https://example.com/a",
              banStatus: "NOT_BANNED",
              banStatusText: "No Solid Fuel Fire Ban",
              banScope: "ALL",
            },
          ],
          forestName: "Alpha Forest",
          forestUrl:
            "https://www.forestrycorporation.com.au/visit/forests/alpha",
          totalFireBanStatus: "NOT_BANNED",
          totalFireBanStatusText: "No Total Fire Ban",
          latitude: -33.9,
          longitude: 151.1,
          geocodeName: "Alpha Forest",
          facilities: {},
        },
        {
          id: "forest-b",
          source: "Forestry Corporation NSW",
          areas: [
            {
              areaName: "Area B",
              areaUrl: "https://example.com/b",
              banStatus: "BANNED",
              banStatusText: "Solid Fuel Fire Ban",
              banScope: "ALL",
            },
          ],
          forestName: "Beta Forest",
          forestUrl:
            "https://www.forestrycorporation.com.au/visit/forests/beta",
          totalFireBanStatus: "BANNED",
          totalFireBanStatusText: "Total Fire Ban",
          latitude: -34.0,
          longitude: 151.2,
          geocodeName: "Beta Forest",
          facilities: {},
        },
      ],
    });

    await page.unroute("**/forests-snapshot.json");
    await page.route("**/forests-snapshot.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: twoForestSnapshot,
      });
    });
    await page.goto("/");

    const rows = page.getByTestId("forest-row");
    await expect(rows).toHaveCount(2);

    // Tap info icon in the first forest card
    const firstRowTrigger = rows
      .nth(0)
      .locator(".info-tooltip-trigger")
      .first();
    await firstRowTrigger.tap();
    await expect(page.locator(".mantine-Popover-dropdown")).toBeVisible();
    await expect(firstRowTrigger).toHaveClass(/info-tooltip-trigger--active/);

    // Tap info icon in the second forest card
    const secondRowTrigger = rows
      .nth(1)
      .locator(".info-tooltip-trigger")
      .first();
    await secondRowTrigger.tap();

    // First trigger should be dismissed, second should be active
    await expect(firstRowTrigger).not.toHaveClass(
      /info-tooltip-trigger--active/
    );
    await expect(secondRowTrigger).toHaveClass(/info-tooltip-trigger--active/);
  });

  test("mapped count info tooltip accessible on tap", async ({ page }) => {
    await page.goto("/");
    await waitForForestList(page);

    const mappedCount = page.getByTestId("mapped-count");
    await expect(mappedCount).toBeVisible();

    const countGroup = mappedCount.locator("..");
    const countTrigger = countGroup.locator(".info-tooltip-trigger");
    await expect(countTrigger).toBeVisible();
    await countTrigger.tap();

    const popover = page.locator(".mantine-Popover-dropdown");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(/matching.*forests/i);
  });
});
