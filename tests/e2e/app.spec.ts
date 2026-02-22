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

  await page.getByTestId("ban-filter-not-allowed").click();
  await page.getByTestId("facility-filter-fishing-include").click();
  await expect(page.getByTestId("forest-row")).toHaveCount(1);

  await page.context().clearPermissions();
  await page.reload();

  await expect(page.getByTestId("ban-filter-not-allowed")).toHaveClass(/is-active/);
  await expect(page.getByTestId("facility-filter-fishing-include")).toHaveClass(/is-active/);
  await expect(page.getByTestId("forest-row")).toHaveCount(1);
  await expect(page.getByTestId("nearest-spot")).toContainText("Closest legal campfire spot");
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
  await expect(page.getByRole("link", { name: "Facilities page" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests"
  );
  await expect(page.getByRole("link", { name: "Solid Fuel Fire Ban" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans"
  );
  await expect(page.getByRole("link", { name: "Coolangubra State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/coolangubra-state-forest"
  );
  await expect(page.getByRole("link", { name: "Belanglo State Forest" })).toHaveAttribute(
    "href",
    "https://www.forestrycorporation.com.au/visit/forests/belanglo-state-forest"
  );
  const fireBanForestLinks = page.getByRole("link", { name: "Belangalo State Forest" });
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
