import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ForestApiResponse } from "../../apps/web/src/lib/api";
import type { PersistedSnapshot } from "../../packages/shared/src/contracts";
import {
  buildForestsQueryKey,
  forestsQueryFn
} from "../../apps/web/src/lib/forests-query";

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
      areas: [{ areaName: "Area 1", areaUrl: "https://example.com/a", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
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
  it("fetches snapshot and computes haversine distances when location is provided", async () => {
    server.use(
      http.get(SNAPSHOT_URL, () => HttpResponse.json(buildSnapshot()))
    );

    const queryClient = createQueryClient();
    const location = { latitude: -33.9, longitude: 151.1 };
    const queryKey = buildForestsQueryKey(location);

    const response = await queryClient.fetchQuery({
      queryKey,
      queryFn: forestsQueryFn(location)
    });

    expect(response.forests[0]?.forestName).toBe("Forest A");
    expect(response.forests[0]?.distanceKm).toBeCloseTo(0, 0);
    expect(response.forests[0]?.travelDurationMinutes).toBeNull();
  });

  it("returns null distances when no location is provided", async () => {
    server.use(
      http.get(SNAPSHOT_URL, () => HttpResponse.json(buildSnapshot()))
    );

    const queryClient = createQueryClient();
    const queryKey = buildForestsQueryKey(null);

    const response = await queryClient.fetchQuery({
      queryKey,
      queryFn: forestsQueryFn(null)
    });

    expect(response.forests[0]?.forestName).toBe("Forest A");
    expect(response.forests[0]?.distanceKm).toBeNull();
    expect(response.forests[0]?.travelDurationMinutes).toBeNull();
  });

  it("keeps location and non-location responses isolated in separate query keys", async () => {
    server.use(
      http.get(SNAPSHOT_URL, () => HttpResponse.json(buildSnapshot()))
    );

    const queryClient = createQueryClient();
    const location = { latitude: -33.9, longitude: 151.1 };

    const locationResponse = await queryClient.fetchQuery({
      queryKey: buildForestsQueryKey(location),
      queryFn: forestsQueryFn(location)
    });

    const noLocationResponse = await queryClient.fetchQuery({
      queryKey: buildForestsQueryKey(null),
      queryFn: forestsQueryFn(null)
    });

    expect(locationResponse.forests[0]?.distanceKm).toBeCloseTo(0, 0);
    expect(noLocationResponse.forests[0]?.distanceKm).toBeNull();

    expect(
      queryClient.getQueryData<ForestApiResponse>(buildForestsQueryKey(location))
        ?.forests[0]?.distanceKm
    ).toBeCloseTo(0, 0);
    expect(
      queryClient.getQueryData<ForestApiResponse>(buildForestsQueryKey(null))
        ?.forests[0]?.distanceKm
    ).toBeNull();
  });

  it("computes nearestLegalSpot from forests when location is provided", async () => {
    server.use(
      http.get(SNAPSHOT_URL, () =>
        HttpResponse.json(
          buildSnapshot({
            forests: [
              {
                id: "forest-banned",
                source: "Forestry Corporation NSW",
                areas: [{ areaName: "Area 1", areaUrl: "https://example.com/banned", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban" }],
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
                areas: [{ areaName: "Area 2", areaUrl: "https://example.com/legal", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban" }],
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
    const location = { latitude: -33.9, longitude: 151.1 };

    const response = await queryClient.fetchQuery({
      queryKey: buildForestsQueryKey(location),
      queryFn: forestsQueryFn(location)
    });

    expect(response.nearestLegalSpot?.forestName).toBe("Legal Forest");
    expect(response.nearestLegalSpot?.id).toBe("forest-legal");
  });
});
