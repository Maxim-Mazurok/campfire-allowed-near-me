import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForestGeocoder } from "../../apps/api/src/services/forest-geocoder.js";

/**
 * Build a minimal FCNSW ArcGIS feature response for testing.
 */
const buildFcnswFeatureResponse = (
  features: Array<{
    sfName: string;
    sfNumber: number;
    rings: number[][][];
  }>
) =>
  JSON.stringify({
    features: features.map((feature) => ({
      attributes: { SFName: feature.sfName, SFNo: feature.sfNumber },
      geometry: { rings: feature.rings }
    }))
  });

/** Simple square polygon ring around a given center. */
const squareRing = (
  centerLongitude: number,
  centerLatitude: number,
  halfSide = 0.05
): number[][][] => [
  [
    [centerLongitude - halfSide, centerLatitude - halfSide],
    [centerLongitude + halfSide, centerLatitude - halfSide],
    [centerLongitude + halfSide, centerLatitude + halfSide],
    [centerLongitude - halfSide, centerLatitude + halfSide],
    [centerLongitude - halfSide, centerLatitude - halfSide]
  ]
];

describe("FCNSW ArcGIS geocoder", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves a forest via FCNSW ArcGIS as top priority", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-basic-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const requestedUrls: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const urlString = String(url);
      requestedUrls.push(urlString);
      const parsedUrl = new URL(urlString);

      if (parsedUrl.hostname === "services2.arcgis.com") {
        return new Response(
          buildFcnswFeatureResponse([
            { sfName: "BADJA", sfNumber: 42, rings: squareRing(149.57, -35.89) }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      // Google and Nominatim should not be reached
      return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      expect(result.provider).toBe("FCNSW_ARCGIS");
      expect(result.latitude).toBeCloseTo(-35.89, 1);
      expect(result.longitude).toBeCloseTo(149.57, 1);
      expect(result.displayName).toContain("BADJA");
      expect(result.displayName).toContain("SF42");
      expect(result.confidence).toBe(1);

      // Only FCNSW was contacted — no Google or Nominatim requests
      const googleRequests = requestedUrls.filter((requestUrl) =>
        requestUrl.includes("googleapis.com")
      );
      const nominatimRequests = requestedUrls.filter(
        (requestUrl) =>
          requestUrl.includes("nominatim") || requestUrl.includes("localhost")
      );
      expect(googleRequests).toHaveLength(0);
      expect(nominatimRequests).toHaveLength(0);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("falls back to Google when FCNSW returns no results", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-fallback-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        return new Response(
          JSON.stringify({ features: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        parsedUrl.hostname === "maps.googleapis.com" &&
        parsedUrl.pathname === "/maps/api/geocode/json"
      ) {
        const address = parsedUrl.searchParams.get("address") ?? "";
        if (address.includes("Badja")) {
          return new Response(
            JSON.stringify({
              status: "OK",
              results: [
                {
                  formatted_address: "Badja State Forest, NSW",
                  geometry: {
                    location: { lat: -35.89, lng: 149.57 }
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({ status: "ZERO_RESULTS", results: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      expect(result.provider).toBe("GOOGLE_GEOCODING");
      expect(result.latitude).toBe(-35.89);
      expect(result.longitude).toBe(149.57);

      // FCNSW was attempted first (empty result), then Google succeeded
      const fcnswAttempt = result.attempts?.find(
        (attempt) => attempt.provider === "FCNSW_ARCGIS"
      );
      expect(fcnswAttempt).toBeDefined();
      expect(fcnswAttempt?.outcome).toBe("EMPTY_RESULT");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("falls back to Nominatim when both FCNSW and Google fail", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-nom-fallback-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        return new Response(
          JSON.stringify({ features: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        parsedUrl.hostname === "maps.googleapis.com" &&
        parsedUrl.pathname === "/maps/api/geocode/json"
      ) {
        return new Response(
          JSON.stringify({ status: "ZERO_RESULTS", results: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (parsedUrl.pathname === "/search") {
        return new Response(
          JSON.stringify([
            {
              lat: "-35.91",
              lon: "149.59",
              display_name: "Badja State Forest",
              importance: 0.9
            }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key",
        nominatimBaseUrl: "http://localhost:8080"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      expect(result.provider).toBe("OSM_NOMINATIM");
      expect(result.latitude).toBe(-35.91);
      expect(result.longitude).toBe(149.59);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("handles FCNSW HTTP error gracefully and falls through", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-http-error-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        return new Response("Service Unavailable", { status: 503 });
      }

      if (
        parsedUrl.hostname === "maps.googleapis.com" &&
        parsedUrl.pathname === "/maps/api/geocode/json"
      ) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address: "Badja State Forest, NSW",
                geometry: {
                  location: { lat: -35.89, lng: 149.57 }
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      expect(result.provider).toBe("GOOGLE_GEOCODING");
      expect(result.latitude).toBe(-35.89);

      const fcnswAttempt = result.attempts?.find(
        (attempt) => attempt.provider === "FCNSW_ARCGIS"
      );
      expect(fcnswAttempt).toBeDefined();
      expect(fcnswAttempt?.outcome).toBe("HTTP_ERROR");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("handles FCNSW network failure and falls through", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-network-fail-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    let fetchCallCount = 0;

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      fetchCallCount += 1;

      if (parsedUrl.hostname === "services2.arcgis.com") {
        throw new Error("Network timeout");
      }

      if (
        parsedUrl.hostname === "maps.googleapis.com" &&
        parsedUrl.pathname === "/maps/api/geocode/json"
      ) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address: "Badja State Forest, NSW",
                geometry: {
                  location: { lat: -35.89, lng: 149.57 }
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      expect(result.provider).toBe("GOOGLE_GEOCODING");
      expect(result.latitude).toBe(-35.89);
      expect(fetchCallCount).toBeGreaterThan(1); // FCNSW + Google

      const fcnswAttempt = result.attempts?.find(
        (attempt) => attempt.provider === "FCNSW_ARCGIS"
      );
      expect(fcnswAttempt).toBeDefined();
      expect(fcnswAttempt?.outcome).toBe("REQUEST_FAILED");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("disambiguates multiple FCNSW results by exact name match", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-disambig-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        // Two forests match LIKE '%BADJA%': BADJA and BADJA SWAMPS
        return new Response(
          buildFcnswFeatureResponse([
            { sfName: "BADJA SWAMPS", sfNumber: 100, rings: squareRing(149.50, -35.80) },
            { sfName: "BADJA", sfNumber: 42, rings: squareRing(149.57, -35.89) }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      expect(result.provider).toBe("FCNSW_ARCGIS");
      expect(result.displayName).toContain("BADJA");
      expect(result.displayName).toContain("SF42");
      expect(result.latitude).toBeCloseTo(-35.89, 1);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("reports ambiguity when multiple FCNSW results have no exact match", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-ambiguous-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        return new Response(
          buildFcnswFeatureResponse([
            { sfName: "BADJA SWAMPS", sfNumber: 100, rings: squareRing(149.50, -35.80) },
            { sfName: "BADJA NORTH", sfNumber: 101, rings: squareRing(149.60, -35.70) }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        parsedUrl.hostname === "maps.googleapis.com" &&
        parsedUrl.pathname === "/maps/api/geocode/json"
      ) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address: "Badja State Forest, NSW",
                geometry: {
                  location: { lat: -35.89, lng: 149.57 }
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      // FCNSW is ambiguous, so fallback to Google
      expect(result.provider).toBe("GOOGLE_GEOCODING");
      expect(result.latitude).toBe(-35.89);

      const fcnswAttempt = result.attempts?.find(
        (attempt) => attempt.provider === "FCNSW_ARCGIS"
      );
      expect(fcnswAttempt?.outcome).toBe("FCNSW_MULTIPLE_MATCHES");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("caches FCNSW results and serves from cache on second call", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-cache-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    let arcgisRequestCount = 0;

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        arcgisRequestCount += 1;
        return new Response(
          buildFcnswFeatureResponse([
            { sfName: "BADJA", sfNumber: 42, rings: squareRing(149.57, -35.89) }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      // First call — contacts FCNSW
      const firstResult = await geocoder.geocodeForest("Badja State Forest");
      expect(firstResult.provider).toBe("FCNSW_ARCGIS");
      expect(arcgisRequestCount).toBe(1);

      // Second call — should be served from alias cache
      const secondResult = await geocoder.geocodeForest("Badja State Forest");
      expect(secondResult.provider).toBe("FCNSW_ARCGIS");
      expect(secondResult.latitude).toBeCloseTo(-35.89, 1);

      // ArcGIS was only called once
      expect(arcgisRequestCount).toBe(1);

      // Second call should show a CACHE_HIT attempt
      const cacheAttempt = secondResult.attempts?.find(
        (attempt) => attempt.outcome === "CACHE_HIT"
      );
      expect(cacheAttempt).toBeDefined();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("handles FCNSW ArcGIS error response field gracefully", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-api-error-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        return new Response(
          JSON.stringify({
            error: { code: 400, message: "Invalid SQL syntax" }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (
        parsedUrl.hostname === "maps.googleapis.com" &&
        parsedUrl.pathname === "/maps/api/geocode/json"
      ) {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address: "Badja State Forest, NSW",
                geometry: {
                  location: { lat: -35.89, lng: 149.57 }
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest("Badja State Forest");

      // Should fall back to Google after FCNSW error
      expect(result.provider).toBe("GOOGLE_GEOCODING");

      const fcnswAttempt = result.attempts?.find(
        (attempt) => attempt.provider === "FCNSW_ARCGIS"
      );
      expect(fcnswAttempt?.outcome).toBe("HTTP_ERROR");
      expect(fcnswAttempt?.errorMessage).toContain("Invalid SQL syntax");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("tries directory name variant when primary forest name has no FCNSW match", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-directory-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const arcgisQueries: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        const whereClause = parsedUrl.searchParams.get("where") ?? "";
        arcgisQueries.push(whereClause);

        // "CROFT KNOLL" returns empty, but "CROFTS KNOLL" finds the forest
        if (whereClause.includes("CROFTS KNOLL")) {
          return new Response(
            buildFcnswFeatureResponse([
              { sfName: "CROFTS KNOLL", sfNumber: 77, rings: squareRing(149.1, -33.2) }
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({ features: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const result = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        undefined,
        { directoryForestName: "Crofts Knoll State Forest" }
      );

      expect(result.provider).toBe("FCNSW_ARCGIS");
      expect(result.displayName).toContain("CROFTS KNOLL");
      expect(result.latitude).toBeCloseTo(-33.2, 1);

      // Both the primary name and directory name were attempted
      expect(arcgisQueries.length).toBe(2);
      expect(arcgisQueries[0]).toContain("CROFT KNOLL");
      expect(arcgisQueries[1]).toContain("CROFTS KNOLL");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("does not count FCNSW lookups against Google budget", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-fcnsw-budget-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "services2.arcgis.com") {
        return new Response(
          buildFcnswFeatureResponse([
            { sfName: "BADJA", sfNumber: 42, rings: squareRing(149.57, -35.89) }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new ForestGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        maxNewLookupsPerRun: 0, // Zero Google budget
        googleApiKey: "test-key"
      });

      // Even with zero Google budget, FCNSW should work
      const result = await geocoder.geocodeForest("Badja State Forest");
      expect(result.provider).toBe("FCNSW_ARCGIS");
      expect(result.latitude).toBeCloseTo(-35.89, 1);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
