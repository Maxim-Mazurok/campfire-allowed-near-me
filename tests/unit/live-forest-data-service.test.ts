import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { LiveForestDataService } from "../../apps/api/src/services/live-forest-data-service.js";
import { getForestBanStatus } from "../../packages/shared/src/forest-helpers.js";
import type { ForestryScraper } from "../../apps/api/src/services/forestry-scraper.js";
import type { ForestGeocoder } from "../../apps/api/src/services/forest-geocoder.js";
import type { RouteService } from "../../apps/api/src/services/google-routes.js";
import type { TotalFireBanService } from "../../apps/api/src/services/total-fire-ban-service.js";
import type {
  ForestDirectorySnapshot,
  ForestryScrapeResult
} from "../../apps/api/src/types/domain.js";

const makeDirectoryFixture = (): ForestDirectorySnapshot => ({
  filters: [
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
  forests: [
    {
      forestName: "Belanglo State Forest",
      forestUrl: "https://www.forestrycorporation.com.au/visit/forests/belanglo-state-forest",
      facilities: {
        fishing: true,
        camping: false
      }
    },
    {
      forestName: "Awaba State Forest",
      forestUrl: "https://www.forestrycorporation.com.au/visit/forests/awaba-state-forest",
      facilities: {
        fishing: false,
        camping: true
      }
    }
  ],
  warnings: []
});

const makeTotalFireBanServiceStub = (): TotalFireBanService =>
  ({
    fetchCurrentSnapshot: async () => ({
      fetchedAt: "2026-02-22T08:00:00.000Z",
      lastUpdatedIso: "2026-02-22T08:00:00.000Z",
      areaStatuses: [],
      geoAreas: [],
      warnings: []
    }),
    lookupStatusByCoordinates: (_snapshot, latitude, longitude) => ({
      status: latitude === null || longitude === null ? "UNKNOWN" : "NOT_BANNED",
      statusText:
        latitude === null || longitude === null
          ? "Unknown (Total Fire Ban status unavailable)"
          : "No Total Fire Ban",
      fireWeatherAreaName: latitude === null || longitude === null ? null : "Test Area",
      lookupCode: latitude === null || longitude === null ? "NO_COORDINATES" : "MATCHED"
    })
  }) as unknown as TotalFireBanService;

describe("LiveForestDataService facilities matching", () => {
  it("fuzzy-matches near-identical names and leaves unmatched forests as unknown", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "Southern Highlands",
          areaUrl: "https://example.com/southern-highlands",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Belangalo State Forest", "Completely Different Forest"]
        }
      ],
      directory: makeDirectoryFixture(),
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -34.5,
        longitude: 150.3,
        displayName: "Mock Forest",
        confidence: 0.8
      })
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-live-service-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({
        userLocation: { latitude: -34.52, longitude: 150.35 },
        forceRefresh: true
      });

      const belangalo = response.forests.find((forest) =>
        /belangalo/i.test(forest.forestName)
      );
      const unmatched = response.forests.find((forest) =>
        /completely different/i.test(forest.forestName)
      );
      const awaba = response.forests.find((forest) => forest.forestName === "Awaba State Forest");

      expect(response.availableFacilities.map((facility) => facility.key)).toEqual([
        "fishing",
        "camping"
      ]);
      expect(belangalo?.facilities).toEqual({
        fishing: true,
        camping: false
      });
      expect(belangalo?.forestUrl).toBe(
        "https://www.forestrycorporation.com.au/visit/forests/belanglo-state-forest"
      );
      expect(unmatched?.facilities).toEqual({
        fishing: null,
        camping: null
      });
      expect(unmatched?.forestUrl).toBeNull();
      expect(getForestBanStatus(awaba!.areas)).toBe("UNKNOWN");
      expect(awaba?.areas[0]?.banStatusText).toContain("Unknown");
      expect(awaba?.facilities).toEqual({
        fishing: false,
        camping: true
      });
      expect(awaba?.forestUrl).toBe(
        "https://www.forestrycorporation.com.au/visit/forests/awaba-state-forest"
      );
      expect(
        response.warnings.some((warning) => warning.includes("fuzzy facilities matching"))
      ).toBe(true);
      expect(
        response.warnings.some((warning) =>
          warning.includes("not present on the Solid Fuel Fire Ban pages")
        )
      ).toBe(true);
      expect(response.matchDiagnostics.unmatchedFacilitiesForests).toContain(
        "Awaba State Forest"
      );
      expect(response.matchDiagnostics.fuzzyMatches).toEqual([
        {
          fireBanForestName: "Belangalo State Forest",
          facilitiesForestName: "Belanglo State Forest",
          score: expect.any(Number)
        }
      ]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reuses fresh snapshots when unknown statuses are only from facilities-only forests", async () => {
    let scrapeCalls = 0;
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "Southern Highlands",
          areaUrl: "https://example.com/southern-highlands",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Belangalo State Forest"]
        }
      ],
      directory: makeDirectoryFixture(),
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => {
        scrapeCalls += 1;
        return scrapeFixture;
      }
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -34.5,
        longitude: 150.3,
        displayName: "Mock Forest",
        confidence: 0.8
      })
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-live-service-cache-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const first = await service.getForestData();
      const second = await service.getForestData();

      expect(scrapeCalls).toBe(1);
      expect(first.forests.some((forest) => forest.forestName === "Awaba State Forest")).toBe(true);
      expect(second.forests.some((forest) => forest.forestName === "Awaba State Forest")).toBe(
        true
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prioritizes previously unresolved forests on force refresh", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "Cypress pine forests",
          areaUrl: "https://example.com/cypress-pine-forests",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Alpha State Forest", "Brewombenia State Forest"]
        }
      ],
      directory: {
        filters: [],
        forests: [],
        warnings: []
      },
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocodedForestNameOrder: string[] = [];
    const geocoder = {
      resetLookupBudgetForRun: () => {},
      geocodeForest: async (forestName: string) => {
        geocodedForestNameOrder.push(forestName);

        if (forestName === "Brewombenia State Forest") {
          return {
            latitude: null,
            longitude: null,
            displayName: null,
            confidence: null
          };
        }

        return {
          latitude: -31.1,
          longitude: 148.1,
          displayName: forestName,
          confidence: 0.9
        };
      }
    };

    const temporaryDirectoryPath = mkdtempSync(join(tmpdir(), "campfire-live-service-retry-priority-"));
    const snapshotPath = join(temporaryDirectoryPath, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      await service.getForestData({ forceRefresh: true });

      geocodedForestNameOrder.length = 0;

      await service.getForestData({ forceRefresh: true });

      expect(geocodedForestNameOrder[0]).toBe("Brewombenia State Forest");
    } finally {
      rmSync(temporaryDirectoryPath, { recursive: true, force: true });
    }
  });

  it("attaches closure notices and skips fully closed forests for nearest legal spot", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "South Coast",
          areaUrl: "https://example.com/south-coast",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Forest A State Forest", "Forest B State Forest"]
        }
      ],
      directory: {
        filters: [],
        forests: [],
        warnings: []
      },
      closures: [
        {
          id: "100",
          title: "Forest A State Forest: Closed",
          detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=100",
          listedAt: "2026-01-01T00:00:00.000Z",
          listedAtText: "2026-01-01",
          untilAt: null,
          untilText: "further notice",
          forestNameHint: "Forest A State Forest",
          status: "CLOSED",
          tags: ["ROAD_ACCESS"],
          structuredImpact: {
            source: "RULES",
            confidence: "HIGH",
            campingImpact: "CLOSED",
            access2wdImpact: "CLOSED",
            access4wdImpact: "CLOSED",
            rationale: "Full closure."
          }
        },
        {
          id: "101",
          title: "Forest B State Forest: Partial closure",
          detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=101",
          listedAt: "2026-01-02T00:00:00.000Z",
          listedAtText: "2026-01-02",
          untilAt: null,
          untilText: "further notice",
          forestNameHint: "Forest B State Forest",
          status: "PARTIAL",
          tags: ["ROAD_ACCESS"],
          structuredImpact: {
            source: "RULES",
            confidence: "MEDIUM",
            campingImpact: "RESTRICTED",
            access2wdImpact: "RESTRICTED",
            access4wdImpact: "NONE",
            rationale: "Partial closure."
          }
        },
        {
          id: "103",
          title: "Forest B State Forest: Closed for event",
          detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=103",
          listedAt: "2999-01-01T00:00:00.000Z",
          listedAtText: "2999-01-01",
          untilAt: "2999-01-07T00:00:00.000Z",
          untilText: "2999-01-07",
          forestNameHint: "Forest B State Forest",
          status: "CLOSED",
          tags: ["EVENT"]
        },
        {
          id: "104",
          title: "Forest B State Forest: Closed due to works",
          detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=104",
          listedAt: "2000-01-01T00:00:00.000Z",
          listedAtText: "2000-01-01",
          untilAt: "2000-01-07T00:00:00.000Z",
          untilText: "2000-01-07",
          forestNameHint: "Forest B State Forest",
          status: "CLOSED",
          tags: ["OPERATIONS"]
        },
        {
          id: "102",
          title: "Forest C State Forest: Closed",
          detailUrl: "https://forestclosure.fcnsw.net/ClosureDetailsFrame?id=102",
          listedAt: null,
          listedAtText: null,
          untilAt: null,
          untilText: null,
          forestNameHint: "Forest C State Forest",
          status: "CLOSED",
          tags: []
        }
      ],
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async (forestName: string) => {
        if (forestName === "Forest A State Forest") {
          return {
            latitude: -35.0,
            longitude: 150.0,
            displayName: "Forest A",
            confidence: 0.9
          };
        }

        if (forestName === "Forest B State Forest") {
          return {
            latitude: -35.3,
            longitude: 150.4,
            displayName: "Forest B",
            confidence: 0.9
          };
        }

        return {
          latitude: -35.8,
          longitude: 151.1,
          displayName: "Other",
          confidence: 0.6
        };
      }
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-live-service-closures-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder
      });

      const response = await service.getForestData({
        forceRefresh: true,
        userLocation: { latitude: -35.01, longitude: 150.01 }
      });

      const forestA = response.forests.find((forest) => forest.forestName === "Forest A State Forest");
      const forestB = response.forests.find((forest) => forest.forestName === "Forest B State Forest");

      expect(forestA?.closureStatus).toBe("CLOSED");
      expect(forestA?.closureNotices?.map((notice) => notice.id)).toEqual(["100"]);
      expect(forestA?.closureImpactSummary).toEqual({
        campingImpact: "CLOSED",
        access2wdImpact: "CLOSED",
        access4wdImpact: "CLOSED"
      });
      expect(forestB?.closureStatus).toBe("PARTIAL");
      expect(forestB?.closureNotices?.map((notice) => notice.id)).toEqual(["101"]);
      expect(forestB?.closureImpactSummary).toEqual({
        campingImpact: "RESTRICTED",
        access2wdImpact: "RESTRICTED",
        access4wdImpact: "NONE"
      });
      expect(forestB?.closureNotices?.map((notice) => notice.id)).not.toContain("103");
      expect(forestB?.closureNotices?.map((notice) => notice.id)).not.toContain("104");
      expect(response.nearestLegalSpot?.forestName).toBe("Forest B State Forest");
      expect(response.closureDiagnostics?.unmatchedNotices).toEqual([
        expect.objectContaining({
          id: "102",
          title: "Forest C State Forest: Closed"
        })
      ]);
      expect(
        response.warnings.some((warning) => warning.includes("Could not match 1 closure notice"))
      ).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not reuse an exact-matched facilities forest for fuzzy matching", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "Bombala",
          areaUrl: "https://example.com/bombala",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Bondi State Forest", "Bondo State Forest"]
        }
      ],
      directory: {
        filters: [
          {
            key: "fishing",
            label: "Fishing",
            paramName: "fishing",
            iconKey: "fishing"
          }
        ],
        forests: [
          {
            forestName: "Bondi State Forest",
            facilities: { fishing: true }
          }
        ],
        warnings: []
      },
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -37.0,
        longitude: 149.0,
        displayName: "Mock Forest",
        confidence: 0.8
      })
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-live-service-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({ forceRefresh: true });
      const bondi = response.forests.find((forest) => forest.forestName === "Bondi State Forest");
      const bondo = response.forests.find((forest) => forest.forestName === "Bondo State Forest");

      expect(bondi?.facilities.fishing).toBe(true);
      expect(bondo?.facilities.fishing).toBeNull();
      expect(response.matchDiagnostics.fuzzyMatches).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("merges parenthetical facilities variants into a single exact fire-ban forest match", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "North Coast",
          areaUrl: "https://example.com/north-coast",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Chichester State Forest"]
        }
      ],
      directory: {
        filters: [
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
        forests: [
          {
            forestName: "Chichester State Forest (Allyn River)",
            facilities: {
              fishing: true,
              camping: false
            }
          },
          {
            forestName: "Chichester State Forest (Telegherry River)",
            facilities: {
              fishing: false,
              camping: true
            }
          }
        ],
        warnings: []
      },
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -32.0,
        longitude: 151.6,
        displayName: "Chichester State Forest",
        confidence: 0.8
      })
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-live-service-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({ forceRefresh: true });
      const chichester = response.forests.find(
        (forest) => forest.forestName === "Chichester State Forest"
      );

      expect(chichester?.facilities).toEqual({
        fishing: true,
        camping: true
      });
      expect(response.matchDiagnostics.unmatchedFacilitiesForests).toEqual([]);
      expect(response.matchDiagnostics.fuzzyMatches).toEqual([]);
      expect(
        response.warnings.some((warning) =>
          warning.includes("not present on the Solid Fuel Fire Ban pages")
        )
      ).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("treats forests as banned when any fire-ban area marks them banned", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "State Forests of the North Coast of NSW",
          areaUrl: "https://example.com/state-forests-of-the-north-coast-of-nsw",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Carwong State Forest", "Nymboida State Forest"]
        },
        {
          areaName: "Pine Forests of North Coast",
          areaUrl: "https://example.com/pine-forests-of-north-coast",
          status: "BANNED",
          statusText: "Solid Fuel Fire Ban",
          forests: ["Carwong State Forest"]
        }
      ],
      directory: {
        filters: [
          {
            key: "camping",
            label: "Camping",
            paramName: "camping",
            iconKey: "camping"
          }
        ],
        forests: [
          {
            forestName: "Carwong State Forest",
            facilities: {
              camping: true
            }
          },
          {
            forestName: "Nymboida State Forest",
            facilities: {
              camping: true
            }
          }
        ],
        warnings: []
      },
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async (forestName: string) => {
        if (forestName === "Carwong State Forest") {
          return {
            latitude: -29.001,
            longitude: 152.001,
            displayName: "Carwong State Forest",
            confidence: 0.9
          };
        }

        return {
          latitude: -29.3,
          longitude: 152.4,
          displayName: "Nymboida State Forest",
          confidence: 0.9
        };
      }
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-live-service-ban-priority-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const routeServiceStub: RouteService = {
        getDrivingRouteMetrics: async ({ forests }) => {
          const byForestId = new Map<string, { distanceKm: number; durationMinutes: number }>();

          for (const forest of forests) {
            const isNymboidaCoordinates =
              Math.abs(forest.latitude - -29.3) < 0.001 &&
              Math.abs(forest.longitude - 152.4) < 0.001;
            byForestId.set(forest.id, {
              distanceKm: isNymboidaCoordinates ? 10 : 30,
              durationMinutes: isNymboidaCoordinates ? 15 : 40
            });
          }

          return {
            byForestId,
            warnings: []
          };
        }
      };

      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        routeService: routeServiceStub,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({
        forceRefresh: true,
        userLocation: {
          latitude: -29.002,
          longitude: 152.002
        }
      });

      const carwongEntries = response.forests.filter(
        (forest) => forest.forestName === "Carwong State Forest"
      );

      // Multi-area dedup merges duplicates into a single entry
      expect(carwongEntries).toHaveLength(1);

      const carwong = carwongEntries[0]!;

      // Pessimistic ban: BANNED wins over NOT_BANNED
      expect(getForestBanStatus(carwong.areas)).toBe("BANNED");
      expect(carwong.areas.find((area) => area.banStatus === "BANNED")?.banStatusText).toBe("Solid Fuel Fire Ban");

      // Both areas preserved in the areas array
      expect(carwong.areas).toHaveLength(2);
      expect(carwong.areas[0]!.areaName).toBe("State Forests of the North Coast of NSW");
      expect(carwong.areas[0]!.banStatus).toBe("NOT_BANNED");
      expect(carwong.areas[1]!.areaName).toBe("Pine Forests of North Coast");
      expect(carwong.areas[1]!.banStatus).toBe("BANNED");

      expect(response.nearestLegalSpot?.forestName).toBe("Nymboida State Forest");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refreshes legacy snapshots that do not contain facilities metadata", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-legacy-snapshot-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    const legacySnapshot = {
      fetchedAt: "2026-02-21T10:00:00.000Z",
      stale: false,
      sourceName: "Forestry Corporation NSW",
      warnings: [],
      forests: [
        {
          id: "legacy-forest",
          source: "Forestry Corporation NSW",
          areaName: "Legacy Area",
          areaUrl: "https://example.com/legacy",
          forestName: "Legacy Forest",
          banStatus: "NOT_BANNED",
          banStatusText: "No Solid Fuel Fire Ban",
          totalFireBanStatus: "NOT_BANNED",
          totalFireBanStatusText: "No Total Fire Ban",
          latitude: -33.9,
          longitude: 151.2,
          geocodeName: "Legacy Forest",
          geocodeConfidence: 0.7
        }
      ]
    };

    let scrapeCalls = 0;

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => {
        scrapeCalls += 1;
        return {
          areas: [
            {
              areaName: "Legacy Area",
              areaUrl: "https://example.com/legacy",
              status: "NOT_BANNED",
              statusText: "No Solid Fuel Fire Ban",
              forests: ["Legacy Forest"]
            }
          ],
          directory: {
            filters: [
              {
                key: "fishing",
                label: "Fishing",
                paramName: "fishing",
                iconKey: "fishing"
              }
            ],
            forests: [
              {
                forestName: "Legacy Forest",
                facilities: {
                  fishing: true
                }
              }
            ],
            warnings: []
          },
          warnings: []
        };
      }
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -33.9,
        longitude: 151.2,
        displayName: "Legacy Forest",
        confidence: 0.7
      })
    };

    try {
      await writeFile(snapshotPath, JSON.stringify(legacySnapshot), "utf8");

      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({
        userLocation: { latitude: -33.85, longitude: 151.21 }
      });

      expect(scrapeCalls).toBe(1);
      expect(response.availableFacilities).toEqual([
        {
          key: "fishing",
          label: "Fishing",
          paramName: "fishing",
          iconKey: "fishing"
        }
      ]);
      expect(response.forests[0]?.facilities.fishing).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refreshes snapshots from older schema versions even if they are fresh", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-schema-refresh-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    const oldSnapshot = {
      fetchedAt: new Date().toISOString(),
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
        unmatchedFacilitiesForests: [
          "Defined State forest area",
          "Find a State forest"
        ],
        fuzzyMatches: []
      },
      warnings: [
        "Facilities page includes 2 forest(s) not present on the Solid Fuel Fire Ban pages: Defined State forest area, Find a State forest."
      ],
      forests: [
        {
          id: "old-forest",
          source: "Forestry Corporation NSW",
          areaName: "Old Area",
          areaUrl: "https://example.com/old",
          forestName: "Old Forest",
          banStatus: "NOT_BANNED",
          banStatusText: "No Solid Fuel Fire Ban",
          totalFireBanStatus: "NOT_BANNED",
          totalFireBanStatusText: "No Total Fire Ban",
          latitude: -33.5,
          longitude: 150.5,
          geocodeName: "Old Forest",
          geocodeConfidence: 0.6,
          facilities: {
            fishing: false
          }
        }
      ]
    };

    let scrapeCalls = 0;

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => {
        scrapeCalls += 1;
        return {
          areas: [
            {
              areaName: "New Area",
              areaUrl: "https://example.com/new",
              status: "NOT_BANNED",
              statusText: "No Solid Fuel Fire Ban",
              forests: ["New State Forest"]
            }
          ],
          directory: {
            filters: [
              {
                key: "fishing",
                label: "Fishing",
                paramName: "fishing",
                iconKey: "fishing"
              }
            ],
            forests: [
              {
                forestName: "New State Forest",
                facilities: {
                  fishing: true
                }
              }
            ],
            warnings: []
          },
          warnings: []
        };
      }
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -33.2,
        longitude: 150.1,
        displayName: "New State Forest",
        confidence: 0.7
      })
    };

    try {
      await writeFile(snapshotPath, JSON.stringify(oldSnapshot), "utf8");

      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData();
      expect(scrapeCalls).toBe(1);
      expect(response.forests.some((forest) => forest.forestName === "New State Forest")).toBe(
        true
      );
      expect(
        response.matchDiagnostics.unmatchedFacilitiesForests.includes("Defined State forest area")
      ).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("refreshes fresh snapshots when unmapped forests have missing geocode diagnostics", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-missing-geocode-diagnostics-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    const snapshotWithoutDiagnostics = {
      schemaVersion: 5,
      fetchedAt: new Date().toISOString(),
      stale: false,
      sourceName: "Forestry Corporation NSW",
      availableFacilities: [
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
      forests: [
        {
          id: "mapped-forest",
          source: "Forestry Corporation NSW",
          areaName: "Legacy Area",
          areaUrl: "https://example.com/legacy-area",
          forestName: "Mapped State Forest",
          forestUrl: null,
          banStatus: "NOT_BANNED",
          banStatusText: "No Solid Fuel Fire Ban",
          totalFireBanStatus: "NOT_BANNED",
          totalFireBanStatusText: "No Total Fire Ban",
          latitude: -33.9,
          longitude: 151.2,
          geocodeName: "Mapped State Forest",
          geocodeConfidence: 0.8,
          geocodeDiagnostics: null,
          facilities: {
            camping: true
          }
        },
        {
          id: "unmapped-forest",
          source: "Forestry Corporation NSW",
          areaName: "Legacy Area",
          areaUrl: "https://example.com/legacy-area",
          forestName: "Unmapped State Forest",
          forestUrl: null,
          banStatus: "NOT_BANNED",
          banStatusText: "No Solid Fuel Fire Ban",
          totalFireBanStatus: "UNKNOWN",
          totalFireBanStatusText: "Unknown (Total Fire Ban status unavailable)",
          latitude: null,
          longitude: null,
          geocodeName: null,
          geocodeConfidence: null,
          geocodeDiagnostics: null,
          facilities: {
            camping: true
          }
        }
      ]
    };

    let scrapeCalls = 0;

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => {
        scrapeCalls += 1;
        return {
          areas: [
            {
              areaName: "Legacy Area",
              areaUrl: "https://example.com/legacy-area",
              status: "NOT_BANNED",
              statusText: "No Solid Fuel Fire Ban",
              forests: ["Mapped State Forest", "Unmapped State Forest"]
            }
          ],
          directory: {
            filters: [
              {
                key: "camping",
                label: "Camping",
                paramName: "camping",
                iconKey: "camping"
              }
            ],
            forests: [
              {
                forestName: "Mapped State Forest",
                facilities: {
                  camping: true
                }
              },
              {
                forestName: "Unmapped State Forest",
                facilities: {
                  camping: true
                }
              }
            ],
            warnings: []
          },
          warnings: []
        };
      }
    };

    const geocoder = {
      geocodeForest: async (forestName: string) => {
        if (forestName === "Mapped State Forest") {
          return {
            latitude: -33.9,
            longitude: 151.2,
            displayName: "Mapped State Forest",
            confidence: 0.8,
            attempts: [
              {
                query: "Mapped State Forest, New South Wales, Australia",
                aliasKey: "alias:forest::mapped state forest",
                cacheKey:
                  "query:mapped state forest, new south wales, australia",
                outcome: "LOOKUP_SUCCESS",
                httpStatus: 200,
                resultCount: 1,
                errorMessage: null
              }
            ]
          };
        }

        return {
          latitude: null,
          longitude: null,
          displayName: null,
          confidence: null,
          attempts: [
            {
              query: "Unmapped State Forest, New South Wales, Australia",
              aliasKey: "alias:forest::unmapped state forest",
              cacheKey:
                "query:unmapped state forest, new south wales, australia",
              outcome: "LIMIT_REACHED",
              httpStatus: null,
              resultCount: null,
              errorMessage: null
            }
          ]
        };
      }
    };

    try {
      await writeFile(snapshotPath, JSON.stringify(snapshotWithoutDiagnostics), "utf8");

      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const firstResponse = await service.getForestData();
      const secondResponse = await service.getForestData();
      const unmappedForest = firstResponse.forests.find(
        (forest) => forest.forestName === "Unmapped State Forest"
      );

      expect(scrapeCalls).toBe(1);
      expect(unmappedForest?.geocodeDiagnostics?.reason).toBe(
        "Geocoding lookup limit reached before coordinates were resolved."
      );
      expect(unmappedForest?.geocodeDiagnostics?.debug).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Forest lookup: LIMIT_REACHED")
        ])
      );
      // All diagnostics debug entries should be forest lookups only (no area lookups)
      for (const debugEntry of unmappedForest?.geocodeDiagnostics?.debug ?? []) {
        expect(debugEntry).toMatch(/^Forest lookup:/);
      }
      expect(secondResponse.forests.find((forest) => forest.forestName === "Unmapped State Forest")
        ?.geocodeDiagnostics?.debug).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Forest lookup: LIMIT_REACHED")
        ])
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("includes geocode failure diagnostics for unmapped forests", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "West Region",
          areaUrl: "https://example.com/west-region",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Unmapped State Forest"]
        }
      ],
      directory: {
        filters: [
          {
            key: "camping",
            label: "Camping",
            paramName: "camping",
            iconKey: "camping"
          }
        ],
        forests: [
          {
            forestName: "Unmapped State Forest",
            facilities: {
              camping: true
            }
          }
        ],
        warnings: []
      },
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          {
            query: "Unmapped State Forest, New South Wales, Australia",
            aliasKey: "alias:forest::unmapped state forest",
            cacheKey:
              "query:unmapped state forest, new south wales, australia",
            outcome: "LIMIT_REACHED",
            httpStatus: null,
            resultCount: null,
            errorMessage: null
          }
        ]
      })
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-live-service-geocode-diagnostics-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({ forceRefresh: true });
      const unmappedForest = response.forests.find(
        (forest) => forest.forestName === "Unmapped State Forest"
      );

      expect(unmappedForest?.latitude).toBeNull();
      expect(unmappedForest?.longitude).toBeNull();
      expect(unmappedForest?.geocodeDiagnostics?.reason).toBe(
        "Geocoding lookup limit reached before coordinates were resolved."
      );
      expect(unmappedForest?.geocodeDiagnostics?.debug).toEqual(
        expect.arrayContaining([
          expect.stringContaining("Forest lookup: LIMIT_REACHED")
        ])
      );
      // All diagnostics debug entries should be forest lookups only (no area lookups)
      for (const debugEntry of unmappedForest?.geocodeDiagnostics?.debug ?? []) {
        expect(debugEntry).toMatch(/^Forest lookup:/);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("LiveForestDataService multi-area forest deduplication", () => {
  it("merges a forest appearing in two areas into one entry with both areas", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "Pine forests around Tumut",
          areaUrl: "https://example.com/pine-tumut",
          status: "BANNED",
          statusText: "Solid Fuel Fires banned",
          forests: ["Bago State Forest", "Other Pine Forest"]
        },
        {
          areaName: "Native forest areas in Bago and Bondo",
          areaUrl: "https://example.com/bago-bondo",
          status: "BANNED",
          statusText: "Solid fuel fires banned",
          forests: ["Bago State Forest", "Bondo State Forest"]
        }
      ],
      directory: {
        filters: [],
        forests: [],
        warnings: []
      },
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -35.5,
        longitude: 148.3,
        displayName: "Mock Forest",
        confidence: 0.8
      })
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-multi-area-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({
        userLocation: { latitude: -35.52, longitude: 148.35 },
        forceRefresh: true
      });

      // Bago should appear only once
      const bagoForests = response.forests.filter((forest) =>
        forest.forestName === "Bago State Forest"
      );
      expect(bagoForests).toHaveLength(1);

      const bago = bagoForests[0]!;
      expect(bago.areas).toHaveLength(2);
      expect(bago.areas[0]!.areaName).toBe("Pine forests around Tumut");
      expect(bago.areas[1]!.areaName).toBe("Native forest areas in Bago and Bondo");

      // Primary area should be the first one
      expect(bago.areas[0]!.areaName).toBe("Pine forests around Tumut");
      expect(bago.areas[0]!.areaUrl).toBe("https://example.com/pine-tumut");

      // Ban status should be pessimistic (BANNED since both areas are BANNED)
      expect(getForestBanStatus(bago.areas)).toBe("BANNED");

      // Per-area ban statuses
      expect(bago.areas[0]!.banStatus).toBe("BANNED");
      expect(bago.areas[1]!.banStatus).toBe("BANNED");

      // Other forests should remain separate and single-area
      const otherPine = response.forests.find((forest) =>
        forest.forestName === "Other Pine Forest"
      );
      expect(otherPine).toBeDefined();
      expect(otherPine!.areas).toHaveLength(1);

      const bondo = response.forests.find((forest) =>
        forest.forestName === "Bondo State Forest"
      );
      expect(bondo).toBeDefined();
      expect(bondo!.areas).toHaveLength(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("uses pessimistic ban status when areas differ (BANNED wins over NOT_BANNED)", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "Area with ban",
          areaUrl: "https://example.com/area-ban",
          status: "BANNED",
          statusText: "Solid Fuel Fires banned",
          forests: ["Disputed Forest"]
        },
        {
          areaName: "Area without ban",
          areaUrl: "https://example.com/area-no-ban",
          status: "NOT_BANNED",
          statusText: "No ban",
          forests: ["Disputed Forest"]
        }
      ],
      directory: {
        filters: [],
        forests: [],
        warnings: []
      },
      warnings: []
    };

    const scraper = {
      scrape: async (): Promise<ForestryScrapeResult> => scrapeFixture
    };

    const geocoder = {
      geocodeForest: async () => ({
        latitude: -34.0,
        longitude: 150.0,
        displayName: "Disputed Forest",
        confidence: 0.9
      })
    };

    const tmpDir = mkdtempSync(join(tmpdir(), "campfire-pessimistic-ban-"));
    const snapshotPath = join(tmpDir, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({
        userLocation: { latitude: -34.02, longitude: 150.05 },
        forceRefresh: true
      });

      const disputed = response.forests.find((forest) =>
        forest.forestName === "Disputed Forest"
      );
      expect(disputed).toBeDefined();

      // Only one card
      expect(
        response.forests.filter((forest) => forest.forestName === "Disputed Forest")
      ).toHaveLength(1);

      // Overall ban is pessimistic: BANNED wins
      expect(getForestBanStatus(disputed!.areas)).toBe("BANNED");

      // Both areas present
      expect(disputed!.areas).toHaveLength(2);

      // Per-area ban statuses preserved
      expect(disputed!.areas[0]!.banStatus).toBe("BANNED");
      expect(disputed!.areas[0]!.banStatusText).toBe("Solid Fuel Fires banned");
      expect(disputed!.areas[1]!.banStatus).toBe("NOT_BANNED");
      expect(disputed!.areas[1]!.banStatusText).toBe("No ban");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
