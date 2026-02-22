import { QueryClient } from "@tanstack/react-query";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ForestApiResponse } from "../../apps/web/src/lib/api";
import {
  buildForestsQueryKey,
  forestsQueryFn
} from "../../apps/web/src/lib/forests-query";

const API_URL = "http://localhost/api/forests";

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

const buildPayload = (overrides: Partial<ForestApiResponse> = {}): ForestApiResponse => ({
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
      distanceKm: 12.4,
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
  it("includes location coordinates in requests for location-aware query keys", async () => {
    let seenUrl: URL | null = null;
    server.use(
      http.get(API_URL, ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json(buildPayload());
      })
    );

    const queryClient = createQueryClient();
    const location = { latitude: -33.9, longitude: 151.1 };
    const queryKey = buildForestsQueryKey(location);

    const response = await queryClient.fetchQuery({
      queryKey,
      queryFn: forestsQueryFn(location)
    });

    expect(response.forests[0]?.forestName).toBe("Forest A");
    expect(seenUrl?.searchParams.get("lat")).toBe(String(location.latitude));
    expect(seenUrl?.searchParams.get("lng")).toBe(String(location.longitude));
    expect(seenUrl?.searchParams.get("refresh")).toBeNull();
  });

  it("forces refresh-from-source requests with refresh=1 on the same query key", async () => {
    const seenUrls: URL[] = [];
    server.use(
      http.get(API_URL, ({ request }) => {
        const requestUrl = new URL(request.url);
        seenUrls.push(requestUrl);

        const timestamp =
          requestUrl.searchParams.get("refresh") === "1"
            ? "2026-02-21T10:01:00.000Z"
            : "2026-02-21T10:00:00.000Z";
        return HttpResponse.json(
          buildPayload({
            fetchedAt: timestamp
          })
        );
      })
    );

    const queryClient = createQueryClient();
    const queryKey = buildForestsQueryKey(null);

    const firstResponse = await queryClient.fetchQuery({
      queryKey,
      queryFn: forestsQueryFn(null, false)
    });
    const refreshedResponse = await queryClient.fetchQuery({
      queryKey,
      queryFn: forestsQueryFn(null, true)
    });

    expect(firstResponse.fetchedAt).toBe("2026-02-21T10:00:00.000Z");
    expect(refreshedResponse.fetchedAt).toBe("2026-02-21T10:01:00.000Z");
    expect(seenUrls[0]?.searchParams.get("refresh")).toBeNull();
    expect(seenUrls[1]?.searchParams.get("refresh")).toBe("1");
    expect(
      queryClient.getQueryData<ForestApiResponse>(queryKey)?.fetchedAt
    ).toBe("2026-02-21T10:01:00.000Z");
  });

  it("keeps location and non-location responses isolated when requests overlap", async () => {
    server.use(
      http.get(API_URL, async ({ request }) => {
        const requestUrl = new URL(request.url);
        const hasLocation =
          requestUrl.searchParams.has("lat") && requestUrl.searchParams.has("lng");

        if (hasLocation) {
          return HttpResponse.json(
            buildPayload({
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
          );
        }

        await delay(200);
        return HttpResponse.json(
          buildPayload({
            nearestLegalSpot: null,
            forests: []
          })
        );
      })
    );

    const queryClient = createQueryClient();
    const location = { latitude: -33.9, longitude: 151.1 };

    const nonLocationRequest = queryClient.fetchQuery({
      queryKey: buildForestsQueryKey(null),
      queryFn: forestsQueryFn(null)
    });
    const locationResponse = await queryClient.fetchQuery({
      queryKey: buildForestsQueryKey(location),
      queryFn: forestsQueryFn(location)
    });

    await nonLocationRequest;

    expect(locationResponse.nearestLegalSpot?.forestName).toBe("Fast Forest");
    expect(
      queryClient.getQueryData<ForestApiResponse>(buildForestsQueryKey(location))
        ?.nearestLegalSpot?.forestName
    ).toBe("Fast Forest");
    expect(
      queryClient.getQueryData<ForestApiResponse>(buildForestsQueryKey(null))
        ?.nearestLegalSpot
    ).toBeNull();
  });
});
