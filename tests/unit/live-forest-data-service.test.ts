import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { LiveForestDataService } from "../../apps/api/src/services/live-forest-data-service.js";
import type { ForestryScraper } from "../../apps/api/src/services/forestry-scraper.js";
import type { OSMGeocoder } from "../../apps/api/src/services/osm-geocoder.js";
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
      geocodeArea: async () => ({
        latitude: -34.5,
        longitude: 150.3,
        displayName: "Southern Highlands",
        confidence: 0.9
      }),
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
        geocoder: geocoder as unknown as OSMGeocoder
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
      expect(awaba?.banStatus).toBe("UNKNOWN");
      expect(awaba?.banStatusText).toContain("Unknown");
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
      geocodeArea: async () => ({
        latitude: -34.5,
        longitude: 150.3,
        displayName: "Southern Highlands",
        confidence: 0.9
      }),
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
        geocoder: geocoder as unknown as OSMGeocoder
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
      geocodeArea: async () => ({
        latitude: -37.0,
        longitude: 149.0,
        displayName: "Bombala",
        confidence: 0.9
      }),
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
        geocoder: geocoder as unknown as OSMGeocoder
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
      geocodeArea: async () => ({
        latitude: -32.0,
        longitude: 151.6,
        displayName: "North Coast",
        confidence: 0.9
      }),
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
        geocoder: geocoder as unknown as OSMGeocoder
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
      geocodeArea: async () => ({
        latitude: -33.9,
        longitude: 151.2,
        displayName: "Legacy Area",
        confidence: 0.7
      }),
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
        geocoder: geocoder as unknown as OSMGeocoder
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
      geocodeArea: async () => ({
        latitude: -33.2,
        longitude: 150.1,
        displayName: "New Area",
        confidence: 0.7
      }),
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
        geocoder: geocoder as unknown as OSMGeocoder
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
      schemaVersion: 4,
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
      geocodeArea: async () => ({
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          {
            query: "Legacy Area, New South Wales, Australia",
            aliasKey: "alias:area:https://example.com/legacy-area",
            cacheKey: "query:legacy area, new south wales, australia",
            outcome: "EMPTY_RESULT",
            httpStatus: null,
            resultCount: 0,
            errorMessage: null
          }
        ]
      }),
      geocodeForest: async (forestName: string) => {
        if (forestName === "Mapped State Forest") {
          return {
            latitude: -33.9,
            longitude: 151.2,
            displayName: "Mapped State Forest",
            confidence: 0.8,
            attempts: [
              {
                query: "Mapped State Forest, Legacy Area, New South Wales, Australia",
                aliasKey: "alias:forest:legacy area:mapped state forest",
                cacheKey:
                  "query:mapped state forest, legacy area, new south wales, australia",
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
              query: "Unmapped State Forest, Legacy Area, New South Wales, Australia",
              aliasKey: "alias:forest:legacy area:unmapped state forest",
              cacheKey:
                "query:unmapped state forest, legacy area, new south wales, australia",
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
        geocoder: geocoder as unknown as OSMGeocoder
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
          expect.stringContaining("Forest lookup: LIMIT_REACHED"),
          expect.stringContaining("Area fallback: EMPTY_RESULT")
        ])
      );
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
      geocodeArea: async () => ({
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          {
            query: "West Region, New South Wales, Australia",
            aliasKey: "alias:area:https://example.com/west-region",
            cacheKey: "query:west region, new south wales, australia",
            outcome: "EMPTY_RESULT",
            httpStatus: null,
            resultCount: 0,
            errorMessage: null
          }
        ]
      }),
      geocodeForest: async () => ({
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          {
            query: "Unmapped State Forest, West Region, New South Wales, Australia",
            aliasKey: "alias:forest:west region:unmapped state forest",
            cacheKey:
              "query:unmapped state forest, west region, new south wales, australia",
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
        geocoder: geocoder as unknown as OSMGeocoder
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
          expect.stringContaining("Forest lookup: LIMIT_REACHED"),
          expect.stringContaining("Area fallback: EMPTY_RESULT")
        ])
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
