import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LiveForestDataService } from "../../apps/api/src/services/live-forest-data-service.js";
import type { RouteService } from "../../apps/api/src/services/google-routes.js";
import type { ForestryScraper } from "../../apps/api/src/services/forestry-scraper.js";
import type { OSMGeocoder } from "../../apps/api/src/services/osm-geocoder.js";
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
    lookupStatusByCoordinates: () => ({
      status: "NOT_BANNED",
      statusText: "No Total Fire Ban",
      fireWeatherAreaName: "Test Area",
      lookupCode: "MATCHED"
    })
  }) as unknown as TotalFireBanService;

describe("LiveForestDataService single-flight refresh", () => {
  it("runs one scrape/geocode pipeline for concurrent requests", async () => {
    let scrapeCallCount = 0;

    const scrapeFixture: ForestryScrapeResult = {
      areas: [
        {
          areaName: "South Coast",
          areaUrl: "https://example.com/south-coast",
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
      scrape: async (): Promise<ForestryScrapeResult> => {
        scrapeCallCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return scrapeFixture;
      }
    };

    const geocoder = {
      geocodeArea: async () => ({
        latitude: -36.0,
        longitude: 149.0,
        displayName: "South Coast",
        confidence: 0.8,
        provider: "OSM_NOMINATIM",
        attempts: [],
        warnings: []
      }),
      geocodeForest: async () => ({
        latitude: -36.1,
        longitude: 149.1,
        displayName: "Badja State Forest",
        confidence: 0.9,
        provider: "OSM_NOMINATIM",
        attempts: [],
        warnings: []
      })
    };

    const routeService: RouteService = {
      getDrivingRouteMetrics: async () => ({
        byForestId: new Map(),
        warnings: []
      })
    };

    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-singleflight-"));
    const snapshotPath = join(temporaryDirectory, "snapshot.json");

    try {
      const service = new LiveForestDataService({
        scrapeTtlMs: 0,
        snapshotPath,
        scraper: scraper as unknown as ForestryScraper,
        geocoder: geocoder as unknown as OSMGeocoder,
        routeService,
        totalFireBanService: makeTotalFireBanServiceStub()
      });

      const [firstResponse, secondResponse] = await Promise.all([
        service.getForestData({ forceRefresh: true }),
        service.getForestData({ forceRefresh: true })
      ]);

      expect(scrapeCallCount).toBe(1);
      expect(firstResponse.forests).toHaveLength(1);
      expect(secondResponse.forests).toHaveLength(1);
      expect(firstResponse.fetchedAt).toBe(secondResponse.fetchedAt);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
