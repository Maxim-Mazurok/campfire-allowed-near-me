import { expect, test } from "@playwright/test";

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
  await expect(page.getByRole("link", { name: "Fire Ban" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans"
  );
  await expect(page.getByRole("link", { name: "Facilities" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests"
  );
  await expect(page.getByTestId("forest-row").first()).toBeVisible();

  const firstForestRow = page.getByTestId("forest-row").first();
  await expect(firstForestRow.getByRole("link", { name: "Forest A" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/forest-a"
  );
  await expect(firstForestRow.getByRole("link", { name: "Area 1" })).toHaveAttribute(
    "href",
    "https://example.com/a#:~:text=Forest%20A"
  );

  const totalRows = await page.getByTestId("forest-row").count();
  expect(totalRows).toBeGreaterThan(0);

  await page.getByTestId("ban-filter-not-allowed").click();
  const bannedRows = await page.getByTestId("forest-row").count();
  expect(bannedRows).toBeLessThanOrEqual(totalRows);
  if (bannedRows > 0) {
    const bannedStatuses = await page.locator("[data-testid='forest-row'] .status-pill").allTextContents();
    expect(bannedStatuses.every((text) => text.includes("Banned"))).toBe(true);
  }

  await page.getByTestId("ban-filter-allowed").click();
  const allowedRows = await page.getByTestId("forest-row").count();
  expect(allowedRows).toBeLessThanOrEqual(totalRows);
  if (allowedRows > 0) {
    const allowedStatuses = await page.locator("[data-testid='forest-row'] .status-pill").allTextContents();
    expect(allowedStatuses.every((text) => text.includes("No ban"))).toBe(true);
  }

  await page.getByTestId("facility-filter-fishing-include").click();
  const fishingRows = await page.getByTestId("forest-row").count();
  expect(fishingRows).toBe(1);

  await page.getByTestId("facility-filter-fishing-include").click();
  const resetFromIncludeRows = await page.getByTestId("forest-row").count();
  expect(resetFromIncludeRows).toBe(allowedRows);

  await page.getByTestId("facility-filter-fishing-exclude").click();
  const noFishingRows = await page.getByTestId("forest-row").count();
  expect(noFishingRows).toBe(1);

  await page.getByTestId("facility-filter-fishing-exclude").click();
  const resetFromExcludeRows = await page.getByTestId("forest-row").count();
  expect(resetFromExcludeRows).toBe(allowedRows);

  await page.getByTestId("locate-btn").click();
  await expect
    .poll(async () => {
      const nearestCount = await page.getByTestId("nearest-spot").count();
      const nearestEmptyCount = await page.getByTestId("nearest-empty").count();
      return nearestCount + nearestEmptyCount;
    })
    .toBeGreaterThan(0);
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
  await expect(page.getByTestId("warnings-dialog")).toContainText(
    "anti-bot verification blocked scraping"
  );
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
        matchDiagnostics: {
          unmatchedFacilitiesForests: ["Coolangubra State Forest"],
          fuzzyMatches: [
            {
              fireBanForestName: "Belangalo State Forest",
              facilitiesForestName: "Belanglo State Forest",
              score: 0.96
            }
          ]
        },
        warnings: [],
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
  await expect(page.getByTestId("warnings-btn")).toContainText("2");
  await page.getByTestId("warnings-btn").click();

  await expect(page.getByTestId("warnings-dialog")).toContainText(
    "Facilities page includes 1 forest(s) not present on the Solid Fuel Fire Ban pages."
  );
  await expect(page.getByRole("link", { name: "Coolangubra State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/coolangubra-state-forest"
  );
  await expect(page.getByRole("link", { name: "Belanglo State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/belanglo-state-forest"
  );
  await expect(page.getByRole("link", { name: "Belangalo State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans/state-forests-of-the-south-coast-of-nsw#:~:text=Belangalo%20State%20Forest"
  );
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
