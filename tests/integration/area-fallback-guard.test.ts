import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LiveForestDataService } from "../../apps/api/src/services/live-forest-data-service.js";
import type {
  GeocodeLookupAttempt,
  ForestGeocoder
} from "../../apps/api/src/services/forest-geocoder.js";
import type { ForestryScraper } from "../../apps/api/src/services/forestry-scraper.js";
import type { TotalFireBanService } from "../../apps/api/src/services/total-fire-ban-service.js";
import type { ForestryScrapeResult } from "../../apps/api/src/types/domain.js";

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

const makeForestAttempt = (
  outcome: GeocodeLookupAttempt["outcome"]
): GeocodeLookupAttempt => ({
  provider: "GOOGLE_GEOCODING",
  query: "Badja State Forest, New South Wales, Australia",
  aliasKey: "forest:State forests around Bombala:Badja State Forest",
  cacheKey: "query:badja state forest",
  outcome,
  httpStatus: null,
  resultCount: null,
  errorMessage: null
});

describe("forest geocode area fallback guard", () => {
  it("does not use area centroid fallback when forest lookup is rate-limited", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "State forests around Bombala",
          areaUrl: "https://example.com/bombala",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Badja State Forest"]
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
      geocodeArea: async () => ({
        latitude: -36.0,
        longitude: 149.3,
        displayName: "Bombala",
        confidence: 0.6
      }),
      geocodeForest: async () => ({
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        provider: null,
        attempts: [makeForestAttempt("LIMIT_REACHED")]
      })
    };

    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-area-fallback-limit-"));
    const snapshotPath = join(temporaryDirectory, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({ forceRefresh: true });
      const badjaForest = response.forests.find((forest) => forest.forestName === "Badja State Forest");

      expect(badjaForest?.latitude).toBeNull();
      expect(badjaForest?.longitude).toBeNull();
      expect(badjaForest?.geocodeName).toBeNull();
      expect(badjaForest?.geocodeDiagnostics?.reason).toContain("lookup limit reached");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("uses area centroid fallback only when forest lookup returns no results", async () => {
    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "State forests around Bombala",
          areaUrl: "https://example.com/bombala",
          status: "NOT_BANNED",
          statusText: "No Solid Fuel Fire Ban",
          forests: ["Badja State Forest"]
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
      geocodeArea: async () => ({
        latitude: -36.0,
        longitude: 149.3,
        displayName: "Bombala",
        confidence: 0.6
      }),
      geocodeForest: async () => ({
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        provider: null,
        attempts: [makeForestAttempt("EMPTY_RESULT")]
      })
    };

    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-area-fallback-empty-"));
    const snapshotPath = join(temporaryDirectory, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as ForestGeocoder,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const response = await service.getForestData({ forceRefresh: true });
      const badjaForest = response.forests.find((forest) => forest.forestName === "Badja State Forest");

      expect(badjaForest?.latitude).toBe(-36.0);
      expect(badjaForest?.longitude).toBe(149.3);
      expect(badjaForest?.geocodeName).toContain("area centroid approximation");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
