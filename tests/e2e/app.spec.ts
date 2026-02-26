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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-green",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest Green",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-green",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Green",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-grey",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban" }],
            forestName: "Forest Grey",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-grey",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Grey",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-pan",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest Pan",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-pan",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Pan",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            facilities: {}
          },
          {
            id: "forest-b",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/b", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest B",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-b",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.2633,
            longitude: 147.1166,
            geocodeName: "Forest B",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            facilities: {
              fishing: true,
              camping: true
            }
          },
          {
            id: "forest-b",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/b", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest B",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-b",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -34.0,
            longitude: 151.3,
            geocodeName: "Forest B",
            geocodeConfidence: 0.8,
            facilities: {
              fishing: false,
              camping: true
            }
          },
          {
            id: "forest-c",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 2", areaUrl: "https://example.com/c", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban" }],
            forestName: "Forest C",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-c",
            totalFireBanStatus: "BANNED",
            totalFireBanStatusText: "Total Fire Ban",
            latitude: -35.0,
            longitude: 151.4,
            geocodeName: "Forest C",
            geocodeConfidence: 0.8,
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

  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            facilities: {
              fishing: false
            }
          },
          {
            id: "forest-b",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 2", areaUrl: "https://example.com/b", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban" }],
            forestName: "Forest B",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-b",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -34.5,
            longitude: 149.1,
            geocodeName: "Forest B",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-open",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/open", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Open Forest",
            forestUrl: "https://example.com/open",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Open Forest",
            geocodeConfidence: 0.8,
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
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/closed", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Closed Forest",
            forestUrl: "https://example.com/closed",
            latitude: -34.1,
            longitude: 151.3,
            geocodeName: "Closed Forest",
            geocodeConfidence: 0.8,
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
            areas: [{ areaName: "Area 2", areaUrl: "https://example.com/partial", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Partial Forest",
            forestUrl: "https://example.com/partial",
            latitude: -34.3,
            longitude: 151.4,
            geocodeName: "Partial Forest",
            geocodeConfidence: 0.8,
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

  const closureStatusFilter = page.getByRole("radiogroup", { name: "Closure status filter" });

  await closureStatusFilter.getByText("Open").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await closureStatusFilter.getByText("Partly closed").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await closureStatusFilter.getByText("Closed").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await closureStatusFilter.getByText("All").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(3);

  await page.getByTestId("has-notices-filter-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(2);

  await page.getByTestId("has-notices-filter-any").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(3);

  await page.getByTestId("closure-tag-filter-ROAD_ACCESS-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(2);

  const partialRow = page
    .locator("[data-testid='forest-row']")
    .filter({ hasText: "Partial Forest" });
  await expect(partialRow.locator("[data-facility-key='camping'][data-warning='true']")).toHaveCount(1);
  await expect(partialRow.locator("[data-facility-key='twowheeling'][data-warning='true']")).toHaveCount(1);
  await expect(partialRow.locator("[data-facility-key='fourwheeling'][data-warning='false']")).toHaveCount(1);

  await page.getByTestId("closure-tag-filter-ROAD_ACCESS-any").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(3);

  await page.getByTestId("impact-filter-camping-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(2);

  await page.getByTestId("impact-filter-camping-exclude").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("forest-row").first()).toContainText("Open Forest");

  await page.getByTestId("impact-filter-camping-any").click();
  await page.getByTestId("impact-filter-access-2wd-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(2);

  await page.getByTestId("impact-filter-access-2wd-any").click();
  await page.getByTestId("impact-filter-access-4wd-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("forest-row").first()).toContainText("Closed Forest");
});

test("shows stale warning in warnings dialog when upstream scrape falls back to cache", async ({
  page
}) => {
  await page.route("**/forests-snapshot.json", async (route) => {
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

  await page.route("**/forests-snapshot.json", async (route) => {
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

test("uses current location on page load when permission is already granted", async ({
  page
}) => {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: -33.9, longitude: 151.1 });

  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.9,
            longitude: 151.1,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
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

  await page.route("**/forests-snapshot.json", async (route) => {
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
          forests: [
            {
              id: "forest-fast",
              source: "Forestry Corporation NSW",
              areas: [{ areaName: "Area Fast", areaUrl: "https://example.com/fast", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
              forestName: "Fast Forest",
              forestUrl: "https://www.forestrycorporation.com.au/visit/forests/fast-forest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
              latitude: -33.9,
              longitude: 151.1,
              geocodeName: "Fast Forest",
              geocodeConfidence: 0.9,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "South Coast", areaUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans/state-forests-of-the-south-coast-of-nsw", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Belangalo State Forest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -35.2,
            longitude: 150.4,
            geocodeName: "Belangalo State Forest",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "fire-ban-zulu",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Far North", areaUrl: "https://example.com/far-north", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Zulu State Forest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -29.2,
            longitude: 153.5,
            geocodeName: "Zulu State Forest",
            geocodeConfidence: 0.8,
            facilities: {}
          },
          {
            id: "fire-ban-alpha",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "South Coast", areaUrl: "https://example.com/south-coast", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Alpha State Forest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -35.5,
            longitude: 150.2,
            geocodeName: "Alpha State Forest",
            geocodeConfidence: 0.8,
            facilities: {}
          },
          {
            id: "fire-ban-beta",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Central West", areaUrl: "https://example.com/central-west", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban" }],
            forestName: "Beta State Forest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.4,
            longitude: 149.6,
            geocodeName: "Beta State Forest",
            geocodeConfidence: 0.8,
            facilities: {}
          },
          {
            id: "facilities-only-coolangubra",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Unknown (not listed on Solid Fuel Fire Ban pages)", areaUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans", banStatus: "UNKNOWN", banStatusText: "Unknown (not listed on Solid Fuel Fire Ban pages)" }],
            forestName: "Coolangubra State Forest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -36.4,
            longitude: 149.2,
            geocodeName: "Coolangubra State Forest",
            geocodeConfidence: 0.5,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "alpha",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "North Region", areaUrl: "https://example.com/north-region", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Alpha State Forest",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/alpha-state-forest",
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
            facilities: {}
          },
          {
            id: "bravo",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "South Region", areaUrl: "https://example.com/south-region", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Bravo State Forest",
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

  await page.route("**/forests-snapshot.json", async (route) => {
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-ztest",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest Z-Test",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-ztest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest Z-Test",
            geocodeConfidence: 0.8,
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
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-wtest",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest W-Test",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-wtest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.1633,
            longitude: 147.0166,
            geocodeName: "Forest W-Test",
            geocodeConfidence: 0.8,
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

test("hovering area name in map popup highlights same-area markers orange", async ({ page }) => {
  await clearStoredPreferences({ page });

  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "forest-a",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Hunter Area", areaUrl: "https://example.com/hunter", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest A",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.8,
            longitude: 151.7,
            geocodeName: "Forest A",
            geocodeConfidence: 0.8,
            facilities: {}
          },
          {
            id: "forest-b",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "Hunter Area", areaUrl: "https://example.com/hunter", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest B",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-b",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -32.9,
            longitude: 151.6,
            geocodeName: "Forest B",
            geocodeConfidence: 0.8,
            facilities: {}
          },
          {
            id: "forest-c",
            source: "Forestry Corporation NSW",
            areas: [{ areaName: "South Coast Area", areaUrl: "https://example.com/south-coast", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
            forestName: "Forest C",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-c",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -35.2,
            longitude: 150.5,
            geocodeName: "Forest C",
            geocodeConfidence: 0.8,
            facilities: {}
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("forest-row")).toHaveCount(3);

  // All markers should initially be green (matched)
  const greenFill = "#4ade80";
  const orangeFill = "#fb923c";

  // Wait for markers to be rendered on the map (Leaflet renders CircleMarkers as <path> elements)
  await expect.poll(async () => {
    return page.evaluate(() => {
      const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
      if (!leafletMap) {
        return 0;
      }
      const matchedPane = leafletMap.getPane("matched-forests");
      if (!matchedPane) {
        return 0;
      }
      const paths = matchedPane.querySelectorAll("path");
      return Array.from(paths)
        .map((path) => path.getAttribute("fill"))
        .filter((fill) => fill && fill !== "transparent")
        .length;
    });
  }).toBeGreaterThanOrEqual(3);

  // Click on Forest A marker to open popup
  await clickForestMarker({ page, forestId: "forest-a" });
  const forestPopupCard = page.getByTestId("forest-popup-card");
  await expect(forestPopupCard).toBeVisible();
  await expect(forestPopupCard).toContainText("Forest A");

  // Hover the area name link inside the popup card (scoped to popup)
  const areaLink = forestPopupCard.getByTestId("forest-area-link");
  await expect(areaLink).toBeVisible();
  await areaLink.hover();

  // Same-area markers (Forest A and B, both "Hunter Area") should turn orange
  await expect.poll(async () => {
    return page.evaluate((expectedOrangeFill) => {
      const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
      if (!leafletMap) {
        return { orangeCount: 0, fills: [] as (string | null)[] };
      }
      const highlightedPane = leafletMap.getPane("area-highlighted-forests");
      if (!highlightedPane) {
        return { orangeCount: 0, fills: [] as (string | null)[] };
      }
      const paths = highlightedPane.querySelectorAll("path");
      const fills = Array.from(paths)
        .map((path) => path.getAttribute("fill"))
        .filter((fill) => fill && fill !== "transparent");
      const orangeCount = fills.filter((fill) => fill === expectedOrangeFill).length;
      return { orangeCount, fills };
    }, orangeFill);
  }).toEqual(expect.objectContaining({ orangeCount: 2 }));

  // Forest C (different area) should still be green in matched pane
  const remainingMatchedFills = await page.evaluate((expectedGreenFill) => {
    const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
    if (!leafletMap) {
      return [];
    }
    const matchedPane = leafletMap.getPane("matched-forests");
    if (!matchedPane) {
      return [];
    }
    const paths = matchedPane.querySelectorAll("path");
    return Array.from(paths)
      .map((path) => path.getAttribute("fill"))
      .filter((fill) => fill && fill !== "transparent");
  }, greenFill);
  expect(remainingMatchedFills).toEqual([greenFill]);
});

test("hovering each area link in multi-area forest list row highlights correct markers", async ({ page }) => {
  await clearStoredPreferences({ page });

  /**
   * Setup:
   *   - "Multi Forest" belongs to BOTH "Alpha Area" and "Beta Area"
   *   - "Alpha Only Forest" belongs to "Alpha Area" only
   *   - "Beta Only Forest" belongs to "Beta Area" only
   *
   * Hovering "Alpha Area" → Multi + Alpha Only highlighted (2 orange)
   * Hovering "Beta Area"  → Multi + Beta Only highlighted (2 orange)
   */
  await page.route("**/forests-snapshot.json", async (route) => {
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
        forests: [
          {
            id: "multi-forest",
            source: "Forestry Corporation NSW",
            areas: [
              { areaName: "Alpha Area", areaUrl: "https://example.com/alpha", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" },
              { areaName: "Beta Area", areaUrl: "https://example.com/beta", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }
            ],
            forestName: "Multi Forest",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/multi-forest",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.0,
            longitude: 151.0,
            geocodeName: "Multi Forest",
            geocodeConfidence: 0.8,
            facilities: {},
            distanceKm: 10,
            travelDurationMinutes: 15
          },
          {
            id: "alpha-only-forest",
            source: "Forestry Corporation NSW",
            areas: [
              { areaName: "Alpha Area", areaUrl: "https://example.com/alpha", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }
            ],
            forestName: "Alpha Only Forest",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/alpha-only",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.1,
            longitude: 151.1,
            geocodeName: "Alpha Only Forest",
            geocodeConfidence: 0.8,
            facilities: {},
            distanceKm: 20,
            travelDurationMinutes: 25
          },
          {
            id: "beta-only-forest",
            source: "Forestry Corporation NSW",
            areas: [
              { areaName: "Beta Area", areaUrl: "https://example.com/beta", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }
            ],
            forestName: "Beta Only Forest",
            forestUrl: "https://www.forestrycorporation.com.au/visit/forests/beta-only",
            totalFireBanStatus: "NOT_BANNED",
            totalFireBanStatusText: "No Total Fire Ban",
            latitude: -33.2,
            longitude: 150.9,
            geocodeName: "Beta Only Forest",
            geocodeConfidence: 0.8,
            facilities: {},
            distanceKm: 30,
            travelDurationMinutes: 35
          }
        ]
      })
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("forest-row")).toHaveCount(3);

  const orangeFill = "#fb923c";
  const greenFill = "#4ade80";

  // Wait for all 3 markers to render on the map
  await expect.poll(async () => {
    return page.evaluate(() => {
      const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
      if (!leafletMap) return 0;
      const matchedPane = leafletMap.getPane("matched-forests");
      if (!matchedPane) return 0;
      const paths = matchedPane.querySelectorAll("path");
      return Array.from(paths)
        .map((path) => path.getAttribute("fill"))
        .filter((fill) => fill && fill !== "transparent")
        .length;
    });
  }).toBeGreaterThanOrEqual(3);

  // Find the multi-area forest row (first row, since distanceKm is smallest)
  const multiForestRow = page.getByTestId("forest-row").filter({ hasText: "Multi Forest" });
  await expect(multiForestRow).toBeVisible();

  // Get both area links within the multi-area forest row
  const areaLinks = multiForestRow.getByTestId("forest-area-link");
  await expect(areaLinks).toHaveCount(2);

  const alphaAreaLink = areaLinks.filter({ hasText: "Alpha Area" });
  const betaAreaLink = areaLinks.filter({ hasText: "Beta Area" });
  await expect(alphaAreaLink).toBeVisible();
  await expect(betaAreaLink).toBeVisible();

  // ---- Hover "Alpha Area" → 2 orange markers (Multi + Alpha Only) ----
  await alphaAreaLink.hover();

  await expect.poll(async () => {
    return page.evaluate((expectedOrangeFill) => {
      const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
      if (!leafletMap) return { orangeCount: 0 };
      const highlightedPane = leafletMap.getPane("area-highlighted-forests");
      if (!highlightedPane) return { orangeCount: 0 };
      const paths = highlightedPane.querySelectorAll("path");
      const fills = Array.from(paths)
        .map((path) => path.getAttribute("fill"))
        .filter((fill) => fill && fill !== "transparent");
      return { orangeCount: fills.filter((fill) => fill === expectedOrangeFill).length };
    }, orangeFill);
  }).toEqual(expect.objectContaining({ orangeCount: 2 }));

  // 1 forest (Beta Only) should remain green
  const alphaHoverMatchedFills = await page.evaluate((expectedGreenFill) => {
    const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
    if (!leafletMap) return [];
    const matchedPane = leafletMap.getPane("matched-forests");
    if (!matchedPane) return [];
    return Array.from(matchedPane.querySelectorAll("path"))
      .map((path) => path.getAttribute("fill"))
      .filter((fill) => fill && fill !== "transparent");
  }, greenFill);
  expect(alphaHoverMatchedFills).toEqual([greenFill]);

  // ---- Move mouse away to clear hover ----
  await page.mouse.move(0, 0);

  // Wait for highlighting to clear
  await expect.poll(async () => {
    return page.evaluate(() => {
      const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
      if (!leafletMap) return -1;
      const highlightedPane = leafletMap.getPane("area-highlighted-forests");
      if (!highlightedPane) return 0;
      return Array.from(highlightedPane.querySelectorAll("path"))
        .map((path) => path.getAttribute("fill"))
        .filter((fill) => fill && fill !== "transparent")
        .length;
    });
  }).toBe(0);

  // ---- Hover "Beta Area" → 2 orange markers (Multi + Beta Only) ----
  await betaAreaLink.hover();

  await expect.poll(async () => {
    return page.evaluate((expectedOrangeFill) => {
      const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
      if (!leafletMap) return { orangeCount: 0 };
      const highlightedPane = leafletMap.getPane("area-highlighted-forests");
      if (!highlightedPane) return { orangeCount: 0 };
      const paths = highlightedPane.querySelectorAll("path");
      const fills = Array.from(paths)
        .map((path) => path.getAttribute("fill"))
        .filter((fill) => fill && fill !== "transparent");
      return { orangeCount: fills.filter((fill) => fill === expectedOrangeFill).length };
    }, orangeFill);
  }).toEqual(expect.objectContaining({ orangeCount: 2 }));

  // 1 forest (Alpha Only) should remain green
  const betaHoverMatchedFills = await page.evaluate((expectedGreenFill) => {
    const leafletMap = (window as Window & { campfireLeafletMap?: { getPane: (name: string) => HTMLElement | undefined } }).campfireLeafletMap;
    if (!leafletMap) return [];
    const matchedPane = leafletMap.getPane("matched-forests");
    if (!matchedPane) return [];
    return Array.from(matchedPane.querySelectorAll("path"))
      .map((path) => path.getAttribute("fill"))
      .filter((fill) => fill && fill !== "transparent");
  }, greenFill);
  expect(betaHoverMatchedFills).toEqual([greenFill]);
});
