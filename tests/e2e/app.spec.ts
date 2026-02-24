import { expect, test, type Page } from "@playwright/test";

const clickForestMarker = async ({
  page,
  forestId
}: {
  page: Page;
  forestId: string;
}) => {
  await expect
    .poll(async () => page.evaluate((forestIdentifier) => {
      const pageWindow = window as Window & {
        campfireMarkerSelectionHandlers?: Record<string, () => void>;
      };
      return Boolean(pageWindow.campfireMarkerSelectionHandlers?.[forestIdentifier]);
    }, forestId))
    .toBe(true);

  const markerWasClicked = await page.evaluate((forestIdentifier) => {
    const pageWindow = window as Window & {
      campfireMarkerSelectionHandlers?: Record<string, () => void>;
    };
    const markerSelectionHandler = pageWindow.campfireMarkerSelectionHandlers?.[forestIdentifier];

    if (!markerSelectionHandler) {
      return false;
    }

    markerSelectionHandler();
    return true;
  }, forestId);

  expect(markerWasClicked).toBe(true);
};

const readMapCenter = async ({
  page
}: {
  page: Page;
}) => {
  const mapCenter = await page.evaluate(() => {
    const pageWindow = window as Window & {
      campfireLeafletMap?: {
        getCenter: () => { lat: number; lng: number };
      };
    };

    const map = pageWindow.campfireLeafletMap;
    if (!map) {
      throw new Error("Leaflet map bridge is unavailable");
    }

    const center = map.getCenter();
    return {
      latitude: center.lat,
      longitude: center.lng
    };
  });

  return mapCenter;
};

const readPopupLifecycle = async ({
  page
}: {
  page: Page;
}) => {
  const popupLifecycle = await page.evaluate(() => {
    const pageWindow = window as Window & {
      campfireForestPopupLifecycle?: {
        mountCount: number;
        unmountCount: number;
      };
    };

    return pageWindow.campfireForestPopupLifecycle ?? {
      mountCount: 0,
      unmountCount: 0
    };
  });

  return popupLifecycle;
};

const panMap = async ({
  page,
  offsetX,
  offsetY
}: {
  page: Page;
  offsetX: number;
  offsetY: number;
}) => {
  const mapContainer = page.locator(".leaflet-container").first();
  await expect(mapContainer).toBeVisible();
  const mapContainerBounds = await mapContainer.boundingBox();
  if (!mapContainerBounds) {
    throw new Error("Map container bounds are unavailable");
  }

  const dragStartX = mapContainerBounds.x + mapContainerBounds.width / 2;
  const dragStartY = mapContainerBounds.y + mapContainerBounds.height / 2;

  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + offsetX, dragStartY + offsetY, { steps: 20 });
  await page.mouse.up();
};

const clearStoredPreferences = async ({
  page
}: {
  page: Page;
}) => {
  await page.context().clearPermissions();
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
};

test("highlights matching map pin when hovering a forest row", async ({ page }) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: {
          id: "forest-a",
          forestName: "Forest A",
          areaName: "Area 1",
          distanceKm: 10.2
        },
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            distanceKm: 10.2,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");

  const forestRow = page.getByTestId("forest-row").first();
  await expect(forestRow).toBeVisible();
  const mapPanel = page.getByTestId("map-panel");

  await forestRow.hover();

  await expect(forestRow).toHaveCSS("background-color", "rgb(244, 239, 255)");
  await expect(mapPanel).toHaveAttribute("data-hovered-forest-id", "forest-a");

  await page.getByTestId("forest-search-input").hover();
  await expect(mapPanel).toHaveAttribute("data-hovered-forest-id", "");
});

test("opens popup when clicking green matched marker", async ({ page }) => {
  await clearStoredPreferences({ page });
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: {
          id: "forest-green",
          forestName: "Forest Green",
          areaName: "Area 1",
          distanceKm: 0
        },
        forests: [
          {
            id: "forest-green",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest Green",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-green",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Green",
            geocodeConfidence: 0.8,
            distanceKm: 0,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await clickForestMarker({ page, forestId: "forest-green" });

  const forestPopupCard = page.getByTestId("forest-popup-card");
  await expect(forestPopupCard).toBeVisible();
  await expect(forestPopupCard).toContainText("Forest Green");
});

test("opens popup when clicking grey unmatched marker", async ({ page }) => {
  await clearStoredPreferences({ page });
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: [
          {
            id: "forest-grey",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest Grey",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-grey",
            banStatus: "BANNED",
            banStatusText: "Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Grey",
            geocodeConfidence: 0.8,
            distanceKm: null,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await page.getByRole("radiogroup", { name: "Solid fuel fire ban filter" }).getByText("Not banned").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(0);

  await clickForestMarker({ page, forestId: "forest-grey" });

  const forestPopupCard = page.getByTestId("forest-popup-card");
  await expect(forestPopupCard).toBeVisible();
  await expect(forestPopupCard).toContainText("Forest Grey");
});

test("keeps map position after panning with popup open", async ({ page }) => {
  await clearStoredPreferences({ page });
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: {
          id: "forest-pan",
          forestName: "Forest Pan",
          areaName: "Area 1",
          distanceKm: 0
        },
        forests: [
          {
            id: "forest-pan",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest Pan",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-pan",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Pan",
            geocodeConfidence: 0.8,
            distanceKm: 0,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await clickForestMarker({ page, forestId: "forest-pan" });
  await expect(page.getByTestId("forest-popup-card")).toBeVisible();

  const initialMapCenter = await readMapCenter({ page });
  const popupLifecycleBeforePan = await readPopupLifecycle({ page });

  await panMap({ page, offsetX: 200, offsetY: 120 });

  await expect
    .poll(async () => {
      const movedMapCenter = await readMapCenter({ page });
      return Math.hypot(
        movedMapCenter.latitude - initialMapCenter.latitude,
        movedMapCenter.longitude - initialMapCenter.longitude
      );
    })
    .toBeGreaterThan(0.02);

  // Wait for Leaflet inertial scrolling to finish before measuring the pan result
  await page.waitForTimeout(1000);
  const settledMapCenter = await readMapCenter({ page });
  const settledDistanceFromInitial = Math.hypot(
    settledMapCenter.latitude - initialMapCenter.latitude,
    settledMapCenter.longitude - initialMapCenter.longitude
  );

  // Wait again and verify no snap-back occurs
  await page.waitForTimeout(700);
  const finalMapCenter = await readMapCenter({ page });
  const snapBackDistance = Math.hypot(
    finalMapCenter.latitude - settledMapCenter.latitude,
    finalMapCenter.longitude - settledMapCenter.longitude
  );
  const popupLifecycleAfterPan = await readPopupLifecycle({ page });

  expect(settledDistanceFromInitial).toBeGreaterThan(0.02);
  expect(snapBackDistance).toBeLessThan(0.02);
  expect(popupLifecycleAfterPan.mountCount).toBe(popupLifecycleBeforePan.mountCount);
  expect(popupLifecycleAfterPan.unmountCount).toBe(popupLifecycleBeforePan.unmountCount);
});

test("keeps popup stable while hovering forest list", async ({ page }) => {
  await clearStoredPreferences({ page });
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: {
          id: "forest-a",
          forestName: "Forest A",
          areaName: "Area 1",
          distanceKm: 0
        },
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            distanceKm: 0,
            facilities: {}
          },
          {
            id: "forest-b",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/b",
            forestName: "Forest B",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-b",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.2633,
            longitude: 147.1166,
            geocodeName: "Forest B",
            geocodeConfidence: 0.8,
            distanceKm: 12,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await clickForestMarker({ page, forestId: "forest-a" });
  await expect(page.getByTestId("forest-popup-card")).toBeVisible();

  const popupLifecycleBeforeHover = await readPopupLifecycle({ page });
  const mapCenterBeforeHover = await readMapCenter({ page });

  const forestRows = page.getByTestId("forest-row");
  await expect(forestRows).toHaveCount(2);
  await forestRows.nth(1).hover();
  await forestRows.nth(0).hover();
  await page.getByTestId("forest-search-input").hover();

  await expect(page.getByTestId("forest-popup-card")).toBeVisible();
  await expect(page.getByTestId("forest-popup-card")).toContainText("Forest A");

  const popupLifecycleAfterHover = await readPopupLifecycle({ page });
  const mapCenterAfterHover = await readMapCenter({ page });
  const mapCenterShift = Math.hypot(
    mapCenterAfterHover.latitude - mapCenterBeforeHover.latitude,
    mapCenterAfterHover.longitude - mapCenterBeforeHover.longitude
  );

  expect(popupLifecycleAfterHover.mountCount).toBe(popupLifecycleBeforeHover.mountCount);
  expect(popupLifecycleAfterHover.unmountCount).toBe(popupLifecycleBeforeHover.unmountCount);
  expect(mapCenterShift).toBeLessThan(0.001);
});

test("loads forests, applies filters, and resolves nearest legal spot", async ({
  page
}) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [
          {
            key: "fishing",
            label: "Fishing",
            paramName: "fishing",
            iconKey: "fishing"
          },
          {
            key: "camping",
            label: "Camping",
            paramName: "camping",
            iconKey: "camping"
          }
        ],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: {
          id: "forest-a",
          forestName: "Forest A",
          areaName: "Area 1",
          distanceKm: 14.2
        },
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            distanceKm: 14.2,
            facilities: {
              fishing: true,
              camping: true
            }
          },
          {
            id: "forest-b",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/b",
            forestName: "Forest B",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-b",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -34.0,
            longitude: 151.3,
            geocodeName: "Forest B",
            geocodeConfidence: 0.8,
            distanceKm: 30.1,
            facilities: {
              fishing: false,
              camping: true
            }
          },
          {
            id: "forest-c",
            source: "Forestry Corporation NSW",
            areaName: "Area 2",
            areaUrl: "https://example.com/c",
            forestName: "Forest C",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-c",
            banStatus: "BANNED",
            banStatusText: "Solid Fuel Fire Ban",
            totalFireBanStatus: "BANNED",
            totalFireBanStatusText: "Total Fire Ban",
            latitude: -35.0,
            longitude: 151.4,
            geocodeName: "Forest C",
            geocodeConfidence: 0.8,
            distanceKm: 44.2,
            facilities: {
              fishing: true,
              camping: false
            }
          }
        ]
      })
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Campfire Allowed Near Me" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Solid Fuel Fire Ban" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans"
  );
  await expect(page.getByRole("link", { name: "Facilities" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests"
  );
  await expect(page.getByTestId("settings-btn")).toBeVisible();
  await page.getByTestId("settings-btn").click();
  const settingsDialog = page.getByTestId("settings-dialog");
  await expect(settingsDialog).toBeVisible();
  await expect(page.getByTestId("settings-tolls-avoid")).toBeChecked();
  await expect(settingsDialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await settingsDialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("forest-row").first()).toBeVisible();

  const firstForestRow = page.getByTestId("forest-row").first();
  await expect(firstForestRow.getByRole("link", { name: "Forest A", exact: true })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/forest-a"
  );
  await expect(firstForestRow.getByRole("link", { name: "Area 1" })).toHaveAttribute(
    "href",
    "https://example.com/a#:~:text=Forest%20A"
  );
  await expect(firstForestRow.getByTestId("forest-navigation-link")).toHaveAttribute(
    "href",
    "https://www.google.com/maps/dir/?api=1&destination=-33.9%2C151.1&travelmode=driving"
  );

  const totalRows = await page.getByTestId("forest-row").count();
  expect(totalRows).toBeGreaterThan(0);

  await page.getByTestId("forest-search-input").fill("Forest B");
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("forest-row").first()).toContainText("Forest B");
  await page.getByTestId("forest-search-input").fill("");
  await expect(page.getByTestId("forest-row")).toHaveCount(totalRows);

  const solidFuelBanFilter = page.getByRole("radiogroup", { name: "Solid fuel fire ban filter" });
  const totalFireBanFilter = page.getByRole("radiogroup", { name: "Total fire ban filter" });

  await solidFuelBanFilter.getByText("Banned", { exact: true }).click();
  const bannedRows = await page.getByTestId("forest-row").count();
  expect(bannedRows).toBeLessThanOrEqual(totalRows);
  if (bannedRows > 0) {
    const bannedStatuses = await page
      .locator("[data-testid='forest-row'] .status-pill-row > *:first-child")
      .allTextContents();
    expect(bannedStatuses.every((text) => text.includes("Solid fuel: banned"))).toBe(true);
  }

  await solidFuelBanFilter.getByText("Not banned").click();
  const allowedRows = await page.getByTestId("forest-row").count();
  expect(allowedRows).toBeLessThanOrEqual(totalRows);
  if (allowedRows > 0) {
    const allowedStatuses = await page
      .locator("[data-testid='forest-row'] .status-pill-row > *:first-child")
      .allTextContents();
    expect(allowedStatuses.every((text) => text.includes("Solid fuel: not banned"))).toBe(true);
  }

  await solidFuelBanFilter.getByText("All", { exact: true }).click();
  await totalFireBanFilter.getByText("Banned", { exact: true }).click();
  const totalFireBanRows = await page.getByTestId("forest-row").count();
  expect(totalFireBanRows).toBe(1);
  const totalFireBanStatuses = await page
    .locator("[data-testid='forest-row'] .status-pill-row > *:nth-child(2)")
    .allTextContents();
  expect(totalFireBanStatuses.every((text) => text.includes("Total Fire Ban"))).toBe(true);
  await totalFireBanFilter.getByText("All", { exact: true }).click();

  await page.getByTestId("facility-filter-fishing-include").click();
  const fishingRows = await page.getByTestId("forest-row").count();
  expect(fishingRows).toBe(2);

  await page.getByTestId("facility-filter-fishing-include").click();
  const resetFromIncludeRows = await page.getByTestId("forest-row").count();
  expect(resetFromIncludeRows).toBe(totalRows);

  await page.getByTestId("facility-filter-fishing-exclude").click();
  const noFishingRows = await page.getByTestId("forest-row").count();
  expect(noFishingRows).toBe(1);

  await page.getByTestId("facility-filter-fishing-exclude").click();
  const resetFromExcludeRows = await page.getByTestId("forest-row").count();
  expect(resetFromExcludeRows).toBe(totalRows);

  await page.getByTestId("locate-btn").click();
  await expect
    .poll(async () => {
      const nearestCount = await page.getByTestId("nearest-spot").count();
      const nearestEmptyCount = await page.getByTestId("nearest-empty").count();
      return nearestCount + nearestEmptyCount;
    })
    .toBeGreaterThan(0);
});

test("persists location and filters across reloads", async ({ page }) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: -33.9, longitude: 151.1 });

  await page.route("**/api/forests**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const hasLocation =
      requestUrl.searchParams.has("lat") && requestUrl.searchParams.has("lng");

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [
          {
            key: "fishing",
            label: "Fishing",
            paramName: "fishing",
            iconKey: "fishing"
          }
        ],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: hasLocation
          ? {
              id: "forest-a",
              forestName: "Forest A",
              areaName: "Area 1",
              distanceKm: 2.4
            }
          : null,
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            distanceKm: 2.4,
            facilities: {
              fishing: false
            }
          },
          {
            id: "forest-b",
            source: "Forestry Corporation NSW",
            areaName: "Area 2",
            areaUrl: "https://example.com/b",
            forestName: "Forest B",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-b",
            banStatus: "BANNED",
            banStatusText: "Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -34.5,
            longitude: 149.1,
            geocodeName: "Forest B",
            geocodeConfidence: 0.8,
            distanceKm: 45.5,
            facilities: {
              fishing: true
            }
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("nearest-spot")).toContainText("Closest legal campfire spot");

  const solidFuelBanFilter = page.getByRole("radiogroup", { name: "Solid fuel fire ban filter" });

  await solidFuelBanFilter.getByText("Banned", { exact: true }).click();
  await page.getByTestId("facility-filter-fishing-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await page.context().clearPermissions();
  await page.reload();

  await expect(solidFuelBanFilter.locator("input[value='BANNED']")
  ).toBeChecked();
  await expect(page.getByTestId("facility-filter-fishing-include")).toHaveClass(/mantine-active/);
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("nearest-spot")).toContainText("Closest legal campfire spot");
});

test("shows closure badges and applies closure filters", async ({ page }) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [
          {
            key: "camping",
            label: "Camping",
            paramName: "camping",
            iconKey: "camping"
          },
          {
            key: "twowheeling",
            label: "2WD access",
            paramName: "twowheeling",
            iconKey: "two-wheel-drive"
          },
          {
            key: "fourwheeling",
            label: "4WD tracks",
            paramName: "fourwheeling",
            iconKey: "four-wheel-drive"
          }
        ],
        availableClosureTags: [
          { key: "ROAD_ACCESS", label: "Road/trail access" },
          { key: "CAMPING", label: "Camping impact" },
          { key: "EVENT", label: "Event closure" },
          { key: "OPERATIONS", label: "Operations/safety" }
        ],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        closureDiagnostics: {
          unmatchedNotices: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: {
          id: "forest-open",
          forestName: "Open Forest",
          areaName: "Area 1",
          distanceKm: 12.4
        },
        forests: [
          {
            id: "forest-open",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/open",
            forestName: "Open Forest",
            forestUrl: "https://example.com/open",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Open Forest",
            geocodeConfidence: 0.8,
            distanceKm: 12.4,
            facilities: {
              camping: true,
              twowheeling: true,
              fourwheeling: true
            },
            closureStatus: "NONE",
            closureNotices: [],
            closureTags: {
              ROAD_ACCESS: false,
              CAMPING: false,
              EVENT: false,
              OPERATIONS: false
            },
            closureImpactSummary: {
              campingImpact: "NONE",
              access2wdImpact: "NONE",
              access4wdImpact: "NONE"
            }
          },
          {
            id: "forest-closed",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/closed",
            forestName: "Closed Forest",
            forestUrl: "https://example.com/closed",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            latitude: -34.1,
            longitude: 151.3,
            geocodeName: "Closed Forest",
            geocodeConfidence: 0.8,
            distanceKm: 20.1,
            facilities: {
              camping: true,
              twowheeling: true,
              fourwheeling: true
            },
            closureStatus: "CLOSED",
            closureNotices: [
              {
                id: "100",
                title: "Closed Forest: Closed for event",
                detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=100",
                listedAt: null,
                listedAtText: null,
                untilAt: null,
                untilText: "further notice",
                forestNameHint: "Closed Forest",
                status: "CLOSED",
                tags: ["ROAD_ACCESS", "EVENT"],
                structuredImpact: {
                  source: "LLM",
                  confidence: "HIGH",
                  campingImpact: "CLOSED",
                  access2wdImpact: "CLOSED",
                  access4wdImpact: "CLOSED",
                  rationale: "Forest closed."
                }
              }
            ],
            closureTags: {
              ROAD_ACCESS: true,
              CAMPING: false,
              EVENT: true,
              OPERATIONS: false
            },
            closureImpactSummary: {
              campingImpact: "CLOSED",
              access2wdImpact: "CLOSED",
              access4wdImpact: "CLOSED"
            }
          },
          {
            id: "forest-partial",
            source: "Forestry Corporation NSW",
            areaName: "Area 2",
            areaUrl: "https://example.com/partial",
            forestName: "Partial Forest",
            forestUrl: "https://example.com/partial",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            latitude: -34.3,
            longitude: 151.4,
            geocodeName: "Partial Forest",
            geocodeConfidence: 0.8,
            distanceKm: 25.5,
            facilities: {
              camping: true,
              twowheeling: true,
              fourwheeling: true
            },
            closureStatus: "PARTIAL",
            closureNotices: [
              {
                id: "101",
                title: "Partial Forest: Partial road closure",
                detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=101",
                listedAt: null,
                listedAtText: null,
                untilAt: null,
                untilText: "further notice",
                forestNameHint: "Partial Forest",
                status: "PARTIAL",
                tags: ["ROAD_ACCESS"],
                structuredImpact: {
                  source: "LLM",
                  confidence: "MEDIUM",
                  campingImpact: "RESTRICTED",
                  access2wdImpact: "RESTRICTED",
                  access4wdImpact: "NONE",
                  rationale: "Road and camping area restrictions."
                }
              }
            ],
            closureTags: {
              ROAD_ACCESS: true,
              CAMPING: false,
              EVENT: false,
              OPERATIONS: false
            },
            closureImpactSummary: {
              campingImpact: "RESTRICTED",
              access2wdImpact: "RESTRICTED",
              access4wdImpact: "NONE"
            }
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Closures & Notices" })).toHaveAttribute(
    "href",
    "https://forestclosure.fcnsw.net"
  );

  await expect(page.getByTestId("forest-row")).toHaveCount(3);
  await expect(
    page.locator("[data-testid='forest-row'] .status-pill-row").getByText("Closed", { exact: true })
  ).toHaveCount(1);
  await expect(
    page.locator("[data-testid='forest-row'] .status-pill-row").getByText("Partly closed", { exact: true })
  ).toHaveCount(1);

  const closureFilter = page.getByRole("radiogroup", { name: "Closure filter" });

  await closureFilter.getByText("Open only").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await closureFilter.getByText("Has notices").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(2);

  await closureFilter.getByText("No full closures").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(2);

  await page.getByTestId("closure-tag-filter-ROAD_ACCESS-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("forest-row").first()).toContainText("Partial Forest");

  const partialRow = page
    .locator("[data-testid='forest-row']")
    .filter({ hasText: "Partial Forest" });
  await expect(partialRow.locator("[data-facility-key='camping'][data-warning='true']")).toHaveCount(1);
  await expect(partialRow.locator("[data-facility-key='twowheeling'][data-warning='true']")).toHaveCount(1);
  await expect(partialRow.locator("[data-facility-key='fourwheeling'][data-warning='false']")).toHaveCount(1);

  await page.getByTestId("closure-tag-filter-ROAD_ACCESS-any").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(2);

  await page.getByTestId("impact-filter-camping-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("forest-row").first()).toContainText("Partial Forest");

  await page.getByTestId("impact-filter-camping-exclude").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("forest-row").first()).toContainText("Open Forest");

  await page.getByTestId("impact-filter-camping-any").click();
  await page.getByTestId("impact-filter-access-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("forest-row").first()).toContainText("Partial Forest");
});

test("shows stale warning in warnings dialog when upstream scrape falls back to cache", async ({
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
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: ["Forestry site anti-bot verification blocked scraping."],
        nearestLegalSpot: null,
        forests: []
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("warnings-btn")).toContainText("1");
  await page.getByTestId("warnings-btn").click();
  const warningsDialog = page.getByTestId("warnings-dialog");
  await expect(warningsDialog).toContainText(
    "anti-bot verification blocked scraping"
  );
  await expect(warningsDialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("does not request geolocation on page load when permission is not granted", async ({
  page
}) => {
  await page.context().clearPermissions();

  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: []
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("location-required")).toContainText(
    "Enable location to find the closest legal campfire spot near you."
  );
  await expect(page.getByTestId("nearest-spot")).toHaveCount(0);
});

test("shows refresh progress status text when refresh task is running", async ({ page }) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: []
      })
    });
  });

  await page.route("**/api/refresh/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        taskId: "refresh-1",
        status: "RUNNING",
        phase: "GEOCODE_FORESTS",
        message: "Resolving forest coordinates (13/541).",
        startedAt: "2026-02-21T10:00:00.000Z",
        updatedAt: "2026-02-21T10:00:02.000Z",
        completedAt: null,
        error: null,
        progress: {
          phase: "GEOCODE_FORESTS",
          message: "Resolving forest coordinates (13/541).",
          completed: 13,
          total: 541
        }
      })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Refresh from source" }).click();
  await expect(page.getByTestId("refresh-task-status")).toContainText(
    "Refresh in progress:"
  );
  await expect(page.getByTestId("refresh-progress-bar")).toBeVisible();
});

test("opens websocket handshakes for refresh and forests progress endpoints", async ({ page }) => {
  await page.goto("/");

  const websocketHandshakeResult = await page.evaluate(async () => {
    const openWebSocket = async (path: string): Promise<string> =>
      new Promise((resolve) => {
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const webSocket = new WebSocket(`${protocol}://${window.location.host}${path}`);
        let settled = false;

        const settle = (value: string) => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(value);
        };

        webSocket.addEventListener("open", () => {
          webSocket.close();
          settle("open");
        });

        webSocket.addEventListener("error", () => {
          settle("error");
        });

        webSocket.addEventListener("close", () => {
          if (!settled) {
            settle("close");
          }
        });

        setTimeout(() => {
          settle("timeout");
        }, 4000);
      });

    const refreshWebSocketStatus = await openWebSocket("/api/refresh/ws");
    const forestsWebSocketStatus = await openWebSocket("/api/forests/ws");

    return {
      refreshWebSocketStatus,
      forestsWebSocketStatus
    };
  });

  expect(websocketHandshakeResult.refreshWebSocketStatus).toBe("open");
  expect(websocketHandshakeResult.forestsWebSocketStatus).toBe("open");
});

test("uses current location on page load when permission is already granted", async ({
  page
}) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: -33.9, longitude: 151.1 });

  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: {
          id: "forest-a",
          forestName: "Forest A",
          areaName: "Area 1",
          distanceKm: 2.4
        },
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            distanceKm: 2.4,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("nearest-spot")).toContainText(
    "Closest legal campfire spot:"
  );
});

test("keeps nearest spot when non-location response resolves after location response", async ({
  page
}) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: -33.9, longitude: 151.1 });

  await page.route("**/api/forests**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const hasLocation =
      requestUrl.searchParams.has("lat") && requestUrl.searchParams.has("lng");

    if (hasLocation) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fetchedAt: "2026-02-21T10:00:00.000Z",
          stale: false,
          sourceName: "Forestry Corporation NSW",
          availableFacilities: [],
          availableClosureTags: [],
          matchDiagnostics: {
            unmatchedFacilitiesForests: [],
            fuzzyMatches: []
          },
          warnings: [],
          nearestLegalSpot: {
            id: "forest-fast",
            forestName: "Fast Forest",
            areaName: "Area Fast",
            distanceKm: 1.2
          },
          forests: [
            {
              id: "forest-fast",
              source: "Forestry Corporation NSW",
              areaName: "Area Fast",
              areaUrl: "https://example.com/fast",
              forestName: "Fast Forest",
              forestUrl: "https://www.forestrycorporation.com.au/visit/forests/fast-forest",
              banStatus: "NOT_BANNED",
              banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
              latitude: -33.9,
              longitude: 151.1,
              geocodeName: "Fast Forest",
              geocodeConfidence: 0.9,
              distanceKm: 1.2,
              facilities: {}
            }
          ]
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: []
      }),
      delay: 300
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("nearest-spot")).toContainText("Fast Forest");
  await expect(page.getByTestId("nearest-empty")).toHaveCount(0);
});

test("shows facilities mismatch and fuzzy-match details in warnings dialog with links", async ({
  page
}) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: ["Coolangubra State Forest", "Bermagui State Forest"],
          fuzzyMatches: [
            {
              fireBanForestName: "Belangalo State Forest",
              facilitiesForestName: "Belanglo State Forest",
              score: 0.96
            },
            {
              fireBanForestName: "Belangalo State Forest",
              facilitiesForestName: "Belangaloo State Forest",
              score: 0.91
            }
          ]
        },
        warnings: [
          "Facilities page includes 1 forest(s) not present on the Solid Fuel Fire Ban pages: Coolangubra State Forest."
        ],
        nearestLegalSpot: null,
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areaName: "South Coast",
            areaUrl:
              "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans/state-forests-of-the-south-coast-of-nsw",
            forestName: "Belangalo State Forest",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -35.2,
            longitude: 150.4,
            geocodeName: "Belangalo State Forest",
            geocodeConfidence: 0.8,
            distanceKm: 10.2,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("warnings-btn")).toContainText("4");
  await page.getByTestId("warnings-btn").click();

  await expect(page.getByTestId("warnings-dialog")).toContainText(
    "Facilities page includes 2 forest(s) not present on the Solid Fuel Fire Ban pages."
  );
  await expect(page.getByTestId("warnings-dialog")).toContainText(
    "Applied fuzzy facilities matching for 2 forest name(s) with minor naming differences."
  );
  await expect(page.getByTestId("warnings-dialog")).not.toContainText(
    "Facilities page includes 1 forest(s) not present on the Solid Fuel Fire Ban pages: Coolangubra State Forest."
  );
  const warningsDialog = page.getByTestId("warnings-dialog");
  await expect(warningsDialog.getByRole("link", { name: "Facilities page" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests"
  );
  await expect(warningsDialog.getByRole("link", { name: "Solid Fuel Fire Ban" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans"
  );
  await expect(warningsDialog.getByRole("link", { name: "Coolangubra State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/coolangubra-state-forest"
  );
  await expect(warningsDialog.getByRole("link", { name: "Belanglo State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/belanglo-state-forest"
  );
  const fireBanForestLinks = warningsDialog.getByRole("link", { name: "Belangalo State Forest" });
  await expect(fireBanForestLinks).toHaveCount(2);
  await expect(fireBanForestLinks.first()).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans/state-forests-of-the-south-coast-of-nsw#:~:text=Belangalo%20State%20Forest"
  );
});

test("opens fire-ban forest table from warnings and sorts by forest and region", async ({
  page
}) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: ["Coolangubra State Forest"],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: [
          {
            id: "fire-ban-zulu",
            source: "Forestry Corporation NSW",
            areaName: "Far North",
            areaUrl: "https://example.com/far-north",
            forestName: "Zulu State Forest",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -29.2,
            longitude: 153.5,
            geocodeName: "Zulu State Forest",
            geocodeConfidence: 0.8,
            distanceKm: null,
            facilities: {}
          },
          {
            id: "fire-ban-alpha",
            source: "Forestry Corporation NSW",
            areaName: "South Coast",
            areaUrl: "https://example.com/south-coast",
            forestName: "Alpha State Forest",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -35.5,
            longitude: 150.2,
            geocodeName: "Alpha State Forest",
            geocodeConfidence: 0.8,
            distanceKm: null,
            facilities: {}
          },
          {
            id: "fire-ban-beta",
            source: "Forestry Corporation NSW",
            areaName: "Central West",
            areaUrl: "https://example.com/central-west",
            forestName: "Beta State Forest",
            banStatus: "BANNED",
            banStatusText: "Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.4,
            longitude: 149.6,
            geocodeName: "Beta State Forest",
            geocodeConfidence: 0.8,
            distanceKm: null,
            facilities: {}
          },
          {
            id: "facilities-only-coolangubra",
            source: "Forestry Corporation NSW",
            areaName: "Unknown (not listed on Solid Fuel Fire Ban pages)",
            areaUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
            forestName: "Coolangubra State Forest",
            banStatus: "UNKNOWN",
            banStatusText: "Unknown (not listed on Solid Fuel Fire Ban pages)",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -36.4,
            longitude: 149.2,
            geocodeName: "Coolangubra State Forest",
            geocodeConfidence: 0.5,
            distanceKm: null,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await page.getByTestId("warnings-btn").click();
  await page.getByTestId("open-fire-ban-forest-table-btn").click();

  const table = page.getByTestId("fire-ban-forest-table");
  await expect(table).toBeVisible();
  await expect(page.getByTestId("fire-ban-forest-table-row")).toHaveCount(3);
  await expect(table).not.toContainText("Coolangubra State Forest");

  const firstRow = page.getByTestId("fire-ban-forest-table-row").first();
  await expect(firstRow).toContainText("Alpha State Forest");
  await expect(firstRow).toContainText("South Coast");

  await page.getByTestId("fire-ban-forest-table-region-sort").click();
  await expect(firstRow).toContainText("Beta State Forest");
  await expect(firstRow).toContainText("Central West");

  await page.getByTestId("fire-ban-forest-table-region-sort").click();
  await expect(firstRow).toContainText("Alpha State Forest");
  await expect(firstRow).toContainText("South Coast");

  await page.getByTestId("fire-ban-forest-table-forest-sort").click();
  await expect(firstRow).toContainText("Alpha State Forest");
  await expect(firstRow).toContainText("South Coast");

  await page.getByTestId("fire-ban-forest-table-forest-sort").click();
  await expect(firstRow).toContainText("Zulu State Forest");
  await expect(firstRow).toContainText("Far North");
});

test("shows unmapped forests with diagnostics and fallback links in warnings dialog", async ({
  page
}) => {
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: [
          {
            id: "alpha",
            source: "Forestry Corporation NSW",
            areaName: "North Region",
            areaUrl: "https://example.com/north-region",
            forestName: "Alpha State Forest",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/alpha-state-forest",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: null,
            longitude: null,
            geocodeName: null,
            geocodeConfidence: null,
            geocodeDiagnostics: {
              reason: "Geocoding lookup limit reached before coordinates were resolved.",
              debug: [
                "Forest lookup: LIMIT_REACHED | query=Alpha State Forest, North Region, New South Wales, Australia"
              ]
            },
            distanceKm: null,
            facilities: {}
          },
          {
            id: "bravo",
            source: "Forestry Corporation NSW",
            areaName: "South Region",
            areaUrl: "https://example.com/south-region",
            forestName: "Bravo State Forest",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: null,
            longitude: null,
            geocodeName: null,
            geocodeConfidence: null,
            geocodeDiagnostics: {
              reason: "No usable geocoding results were returned for this forest.",
              debug: [
                "Forest lookup: EMPTY_RESULT | query=Bravo State Forest, South Region, New South Wales, Australia | results=0",
                "Area fallback: EMPTY_RESULT | query=South Region, New South Wales, Australia | results=0"
              ]
            },
            distanceKm: null,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("warnings-btn")).toContainText("2");
  await page.getByTestId("warnings-btn").click();

  const unmappedSection = page.getByTestId("warnings-unmapped-section");
  await expect(unmappedSection).toContainText("2 forest(s) could not be mapped to coordinates.");
  await expect(unmappedSection.getByRole("link", { name: "Alpha State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/alpha-state-forest"
  );
  await expect(unmappedSection.getByRole("link", { name: "Bravo State Forest" })).toHaveAttribute(
    "href",
    "https://example.com/south-region#:~:text=Bravo%20State%20Forest"
  );
  await expect(unmappedSection).toContainText(
    "Geocoding lookup limit reached before coordinates were resolved."
  );

  await unmappedSection.getByText("Debug info").first().click();
  await expect(unmappedSection).toContainText("Forest lookup: LIMIT_REACHED");
});

test("prompts for location access when geolocation is unavailable", async ({
  page
}) => {
  await page.addInitScript(() => {
    const geolocationPrototype = Object.getPrototypeOf(navigator.geolocation);
    Object.defineProperty(geolocationPrototype, "getCurrentPosition", {
      configurable: true,
      value: (_success: unknown, error?: (geoError: { message: string }) => void) => {
        if (typeof error === "function") {
          error({
            message: "Location access blocked for test."
          });
        }
      }
    });
  });

  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: []
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("location-required")).toContainText(
    "Enable location to find the closest legal campfire spot near you."
  );
  await expect(page.getByTestId("nearest-empty")).toHaveCount(0);

  await page.getByTestId("locate-btn").click();
  await expect(page.locator(".error")).toContainText(
    "Unable to read your location: Location access blocked for test."
  );
});

test("settings dialog is visible above the map and interactable by coordinates", async ({
  page
}) => {
  await clearStoredPreferences({ page });
  await page.route("**/api/forests**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        fetchedAt: "2026-02-21T10:00:00.000Z",
        stale: false,
        sourceName: "Forestry Corporation NSW",
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: [],
        nearestLegalSpot: null,
        forests: [
          {
            id: "forest-ztest",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest Z-Test",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-ztest",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Z-Test",
            geocodeConfidence: 0.8,
            distanceKm: 10,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await page.getByTestId("settings-btn").click();
  const settingsDialog = page.getByTestId("settings-dialog");
  await expect(settingsDialog).toBeVisible();

  const avoidTollsRadio = page.getByTestId("settings-tolls-avoid");
  const radioBox = await avoidTollsRadio.boundingBox();
  expect(radioBox).not.toBeNull();

  await page.mouse.click(radioBox!.x + radioBox!.width / 2, radioBox!.y + radioBox!.height / 2);
  await expect(avoidTollsRadio).toBeChecked();

  const allowTollsRadio = page.getByTestId("settings-tolls-allow");
  const allowRadioBox = await allowTollsRadio.boundingBox();
  expect(allowRadioBox).not.toBeNull();

  await page.mouse.click(
    allowRadioBox!.x + allowRadioBox!.width / 2,
    allowRadioBox!.y + allowRadioBox!.height / 2
  );
  await expect(allowTollsRadio).toBeChecked();
  await expect(avoidTollsRadio).not.toBeChecked();

  const closeButton = settingsDialog.getByRole("button", { name: "Close" });
  const closeButtonBox = await closeButton.boundingBox();
  expect(closeButtonBox).not.toBeNull();
  await page.mouse.click(
    closeButtonBox!.x + closeButtonBox!.width / 2,
    closeButtonBox!.y + closeButtonBox!.height / 2
  );
  await expect(settingsDialog).not.toBeVisible();
});

test("warnings dialog is visible above the map and interactable by coordinates", async ({
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
        availableFacilities: [],
        availableClosureTags: [],
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        warnings: ["Forestry site anti-bot verification blocked scraping."],
        nearestLegalSpot: null,
        forests: [
          {
            id: "forest-wtest",
            source: "Forestry Corporation NSW",
            areaName: "Area 1",
            areaUrl: "https://example.com/a",
            forestName: "Forest W-Test",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-wtest",
            banStatus: "NOT_BANNED",
            banStatusText: "No Solid Fuel Fire Ban",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest W-Test",
            geocodeConfidence: 0.8,
            distanceKm: 10,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  const warningsButton = page.getByTestId("warnings-btn");
  await expect(warningsButton).toBeEnabled();
  const warningsButtonBox = await warningsButton.boundingBox();
  expect(warningsButtonBox).not.toBeNull();
  await page.mouse.click(
    warningsButtonBox!.x + warningsButtonBox!.width / 2,
    warningsButtonBox!.y + warningsButtonBox!.height / 2
  );

  const warningsDialog = page.getByTestId("warnings-dialog");
  await expect(warningsDialog).toBeVisible();
  await expect(warningsDialog).toContainText("anti-bot verification blocked scraping");

  const dialogBox = await warningsDialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.width).toBeGreaterThan(100);
  expect(dialogBox!.height).toBeGreaterThan(50);

  const closeButton = warningsDialog.getByRole("button", { name: "Close" });
  const closeButtonBox = await closeButton.boundingBox();
  expect(closeButtonBox).not.toBeNull();
  await page.mouse.click(
    closeButtonBox!.x + closeButtonBox!.width / 2,
    closeButtonBox!.y + closeButtonBox!.height / 2
  );
  await expect(warningsDialog).not.toBeVisible();
});
