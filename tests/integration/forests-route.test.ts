import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/app.js";
import type {
  ForestApiResponse,
  ForestDataService
} from "../../apps/api/src/types/domain.js";

const responseFixture: ForestApiResponse = {
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
  nearestLegalSpot: {
    id: "forest-a",
    forestName: "Forest A",
    areaName: "Area A",
    distanceKm: 14.2
  },
  forests: [
    {
      id: "forest-a",
      source: "Forestry Corporation NSW",
      areaName: "Area A",
      areaUrl: "https://example.com/a",
      forestName: "Forest A",
      banStatus: "NOT_BANNED",
      banStatusText: "No Solid Fuel Fire Ban",
      latitude: -33.9,
      longitude: 151.1,
      geocodeName: "Forest A",
      geocodeConfidence: 0.8,
      facilities: {
        fishing: true
      },
      distanceKm: 14.2
    }
  ]
};

describe("GET /api/forests", () => {
  it("returns forest payload from service", async () => {
    const service: ForestDataService = {
      getForestData: async () => responseFixture
    };

    const app = createApp(service);
    const res = await request(app).get("/api/forests?lat=-33.8&lng=151.2");

    expect(res.status).toBe(200);
    expect(res.body.nearestLegalSpot.forestName).toBe("Forest A");
    expect(res.body.forests).toHaveLength(1);
  });

  it("returns 500 when service errors", async () => {
    const service: ForestDataService = {
      getForestData: async () => {
        throw new Error("boom");
      }
    };

    const app = createApp(service);
    const res = await request(app).get("/api/forests");

    expect(res.status).toBe(500);
    expect(res.body.message).toContain("boom");
  });
});
