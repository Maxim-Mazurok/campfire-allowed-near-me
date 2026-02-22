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
      facilities: {
        fishing: true,
        camping: false
      }
    },
    {
      forestName: "Awaba State Forest",
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

      expect(response.availableFacilities.map((facility) => facility.key)).toEqual([
        "fishing",
        "camping"
      ]);
      expect(belangalo?.facilities).toEqual({
        fishing: true,
        camping: false
      });
      expect(unmatched?.facilities).toEqual({
        fishing: null,
        camping: null
      });
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
});
