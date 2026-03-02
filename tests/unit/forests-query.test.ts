import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PersistedSnapshot } from "../../shared/contracts";
import {
  buildForestsQueryKey,
  forestsQueryFn
} from "../../web/src/lib/forests-query";
import { computeForestsWithDistances, findNearestLegalSpot } from "../../web/src/lib/static-snapshot";

const SNAPSHOT_URL = "http://localhost/forests-snapshot.json";

const server = setupServer();

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity
      }
    }
  });

const buildSnapshot = (overrides: Partial<PersistedSnapshot> = {}): PersistedSnapshot => ({
  fetchedAt: "2026-02-21T10:00:00.000Z",
  stale: false,
  sourceName: "Forestry Corporation NSW",
  availableFacilities: [],
  matchDiagnostics: {
    unmatchedFacilitiesForests: [],
    fuzzyMatches: []
  },
  warnings: [],
  forests: [
    {
      id: "forest-a",
      source: "Forestry Corporation NSW",
      areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }],
      forestName: "Forest A",
      forestUrl: "https://www.forestrycorporation.com.au/visit/forests/forest-a",
      totalFireBanStatus: "NOT_BANNED",
      totalFireBanStatusText: "No Total Fire Ban",
      latitude: -33.9,
      longitude: 151.1,
      geocodeName: "Forest A",
      facilities: {}
    }
  ],
  ...overrides
});

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe("forests query options", () => {
  it("fetches snapshot and returns forests with null distances", async () => {
    server.use(
      http.get(SNAPSHOT_URL, () => HttpResponse.json(buildSnapshot()))
    );

    const queryClient = createQueryClient();
    const queryKey = buildForestsQueryKey();

    const response = await queryClient.fetchQuery({
      queryKey,
      queryFn: forestsQueryFn()
    });

    expect(response.forests[0]?.forestName).toBe("Forest A");
    expect(response.forests[0]?.distanceKm).toBeNull();
    expect(response.forests[0]?.travelDurationMinutes).toBeNull();
  });

  it("computes distances via computeForestsWithDistances separately from the query", async () => {
    server.use(
      http.get(SNAPSHOT_URL, () => HttpResponse.json(buildSnapshot()))
    );

    const queryClient = createQueryClient();

    const response = await queryClient.fetchQuery({
      queryKey: buildForestsQueryKey(),
      queryFn: forestsQueryFn()
    });

    const location = { latitude: -33.9, longitude: 151.1 };
    const forestsWithDistances = computeForestsWithDistances(response.forests, location);

    expect(forestsWithDistances[0]?.forestName).toBe("Forest A");
    expect(forestsWithDistances[0]?.distanceKm).toBeCloseTo(0, 0);
    expect(forestsWithDistances[0]?.travelDurationMinutes).toBeNull();
  });

  it("returns stable query key regardless of location changes", () => {
    const queryKey1 = buildForestsQueryKey();
    const queryKey2 = buildForestsQueryKey();

    expect(queryKey1).toEqual(queryKey2);
    expect(queryKey1).toEqual(["forests"]);
  });

  it("returns null nearestLegalSpot from query (computed separately via useMemo)", async () => {
    server.use(
      http.get(SNAPSHOT_URL, () =>
        HttpResponse.json(
          buildSnapshot({
            forests: [
              {
                id: "forest-banned",
                source: "Forestry Corporation NSW",
                areas: [{ areaName: "Area 1", areaUrl: "https://example.com/banned", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban", banScope: "ALL" }],
                forestName: "Banned Forest",
                forestUrl: "https://www.forestrycorporation.com.au/visit/forests/banned",
                totalFireBanStatus: "NOT_BANNED",
                totalFireBanStatusText: "No Total Fire Ban",
                latitude: -33.8,
                longitude: 151.0,
                geocodeName: "Banned Forest",
                facilities: {}
              },
              {
                id: "forest-legal",
                source: "Forestry Corporation NSW",
                areas: [{ areaName: "Area 2", areaUrl: "https://example.com/legal", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }],
                forestName: "Legal Forest",
                forestUrl: "https://www.forestrycorporation.com.au/visit/forests/legal",
                totalFireBanStatus: "NOT_BANNED",
                totalFireBanStatusText: "No Total Fire Ban",
                latitude: -33.9,
                longitude: 151.1,
                geocodeName: "Legal Forest",
                facilities: {}
              }
            ]
          })
        )
      )
    );

    const queryClient = createQueryClient();

    const response = await queryClient.fetchQuery({
      queryKey: buildForestsQueryKey(),
      queryFn: forestsQueryFn()
    });

    // Query no longer computes nearestLegalSpot — it's computed in the app via useMemo
    expect(response.nearestLegalSpot).toBeNull();

    // Verify findNearestLegalSpot works when called directly
    const location = { latitude: -33.9, longitude: 151.1 };
    const forestsWithDistances = computeForestsWithDistances(response.forests, location);
    const nearest = findNearestLegalSpot(forestsWithDistances, location);
    expect(nearest?.forestName).toBe("Legal Forest");
    expect(nearest?.id).toBe("forest-legal");
  });
});
