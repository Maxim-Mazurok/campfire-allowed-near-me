import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForestGeocoder } from "../../apps/api/src/services/forest-geocoder.js";

describe("ForestGeocoder forest lookup priority", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses forest-name-only query before area-guided query", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-priority-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const searchTextQueries: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        const address = parsedUrl.searchParams.get("address") ?? "";
        searchTextQueries.push(address);

        if (address === "Badja State Forest, New South Wales, Australia") {
          return new Response(
            JSON.stringify({
              status: "OK",
              results: [
                {
                  formatted_address: "Badja State Forest, NSW",
                  geometry: {
                    location: {
                      lat: -35.89,
                      lng: 149.57
                    }
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
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

      const geocodeResult = await geocoder.geocodeForest(
        "Badja State Forest"
      );

      expect(geocodeResult.latitude).toBe(-35.89);
      expect(geocodeResult.longitude).toBe(149.57);
      expect(searchTextQueries[0]).toBe("Badja State Forest, New South Wales, Australia");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("falls back to local Nominatim when Google lookup limit is reached", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-limit-fallback-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const requestedHosts: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      requestedHosts.push(parsedUrl.host);

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
        maxNewLookupsPerRun: 0,
        googleApiKey: "test-key",
        nominatimBaseUrl: "http://localhost:8080"
      });

      const geocodeResult = await geocoder.geocodeForest(
        "Badja State Forest"
      );

      expect(geocodeResult.latitude).toBe(-35.91);
      expect(geocodeResult.longitude).toBe(149.59);
      expect(geocodeResult.provider).toBe("OSM_NOMINATIM");
      expect(
        geocodeResult.attempts?.some(
          (attempt) =>
            attempt.provider === "OSM_NOMINATIM" && attempt.outcome === "LOOKUP_SUCCESS"
        )
      ).toBe(true);
      expect(requestedHosts).toContain("localhost:8080");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("prefers localhost Nominatim by default and falls back to public OSM", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-local-default-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const originalNominatimBaseUrl = process.env.NOMINATIM_BASE_URL;
    const originalNominatimPort = process.env.NOMINATIM_PORT;
    delete process.env.NOMINATIM_BASE_URL;
    process.env.NOMINATIM_PORT = "8080";

    const requestedHosts: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      requestedHosts.push(parsedUrl.host);

      if (parsedUrl.host === "localhost:8080" && parsedUrl.pathname === "/search") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (
        parsedUrl.host === "nominatim.openstreetmap.org" &&
        parsedUrl.pathname === "/search"
      ) {
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

      const geocodeResult = await geocoder.geocodeForest(
        "Badja State Forest"
      );

      expect(geocodeResult.latitude).toBe(-35.91);
      expect(geocodeResult.longitude).toBe(149.59);
      expect(requestedHosts).toContain("localhost:8080");
      expect(requestedHosts).toContain("nominatim.openstreetmap.org");
      expect(requestedHosts.indexOf("localhost:8080")).toBeLessThan(
        requestedHosts.indexOf("nominatim.openstreetmap.org")
      );
    } finally {
      if (originalNominatimBaseUrl === undefined) {
        delete process.env.NOMINATIM_BASE_URL;
      } else {
        process.env.NOMINATIM_BASE_URL = originalNominatimBaseUrl;
      }

      if (originalNominatimPort === undefined) {
        delete process.env.NOMINATIM_PORT;
      } else {
        process.env.NOMINATIM_PORT = originalNominatimPort;
      }

      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("prefers Google Geocoding over Nominatim when both can resolve", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-google-preferred-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    let googleRequests = 0;
    let nominatimRequests = 0;

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        googleRequests += 1;

        const address = parsedUrl.searchParams.get("address") ?? "";
        if (address.includes("Badja")) {
          return new Response(
            JSON.stringify({
              status: "OK",
              results: [
                {
                  formatted_address: "Badja State Forest, NSW",
                  geometry: {
                    location: {
                      lat: -35.77,
                      lng: 149.66
                    }
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (parsedUrl.pathname === "/search") {
        nominatimRequests += 1;
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

      const result = await geocoder.geocodeForest(
        "Badja State Forest"
      );

      // Google is the primary source of truth
      expect(result.provider).toBe("GOOGLE_GEOCODING");
      expect(result.latitude).toBe(-35.77);
      expect(result.longitude).toBe(149.66);

      // Google was called, Nominatim was NOT needed
      expect(googleRequests).toBeGreaterThan(0);
      expect(nominatimRequests).toBe(0);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("retries previously limited Google lookups after budget reset", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-budget-reset-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    let googleRequestCount = 0;

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        googleRequestCount += 1;

        if (googleRequestCount === 1) {
          return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

        return new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address: "Brewombenia State Forest, NSW",
                geometry: {
                  location: {
                    lat: -31.21,
                    lng: 148.54
                  }
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (parsedUrl.pathname === "/search") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
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
        maxNewLookupsPerRun: 1,
        googleApiKey: "test-key"
      });

      const firstMiss = await geocoder.geocodeForest(
        "Brewombenia State Forest"
      );

      expect(firstMiss.latitude).toBeNull();
      expect(
        firstMiss.attempts?.some(
          (attempt) =>
            attempt.provider === "GOOGLE_GEOCODING" && attempt.outcome === "EMPTY_RESULT"
        )
      ).toBe(true);

      const secondLimited = await geocoder.geocodeForest(
        "Another Missing Forest"
      );

      expect(
        secondLimited.attempts?.some(
          (attempt) =>
            attempt.provider === "GOOGLE_GEOCODING" && attempt.outcome === "LIMIT_REACHED"
        )
      ).toBe(true);

      geocoder.resetLookupBudgetForRun();

      const thirdRetried = await geocoder.geocodeForest(
        "Brewombenia State Forest"
      );

      expect(thirdRetried.latitude).toBe(-31.21);
      expect(thirdRetried.longitude).toBe(148.54);
      expect(thirdRetried.provider).toBe("GOOGLE_GEOCODING");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects Google results with street-level types (e.g. route)", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-street-reject-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        return new Response(
          JSON.stringify({
            status: "OK",
            results: [{
              formatted_address: "Cypress Pine Ln, Daruka NSW 2340, Australia",
              types: ["route"],
              geometry: {
                location: { lat: -31.28, lng: 151.12 }
              }
            }]
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

      const result = await geocoder.geocodeForest(
        "Brewombenia State Forest"
      );

      expect(result.latitude).toBeNull();
      expect(result.longitude).toBeNull();
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("assigns lower confidence for locality-type Google results", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-confidence-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        const address = parsedUrl.searchParams.get("address") ?? "";
        if (address.includes("Badja")) {
          return new Response(
            JSON.stringify({
              status: "OK",
              results: [{
                formatted_address: "Badja State Forest, NSW, Australia",
                types: ["natural_feature", "establishment"],
                geometry: {
                  location: { lat: -35.89, lng: 149.57 }
                }
              }]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
          status: 200, headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200, headers: { "Content-Type": "application/json" }
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
      expect(result.latitude).toBe(-35.89);
      expect(result.confidence).toBe(1);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("does not include area name in any geocoding query", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-no-area-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const allQueries: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        const address = parsedUrl.searchParams.get("address") ?? "";
        allQueries.push(address);
        return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (parsedUrl.pathname === "/search") {
        const queryParameter = parsedUrl.searchParams.get("q") ?? "";
        allQueries.push(queryParameter);
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
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

      // Pass an area name — it should be completely ignored
      const result = await geocoder.geocodeForest(
        "Badja State Forest",
        "Cypress pine forests"
      );

      // All queries should have been attempted (result will be null since everything returns empty)
      expect(result.latitude).toBeNull();
      expect(allQueries.length).toBeGreaterThan(0);

      // No query should contain the area name
      for (const query of allQueries) {
        expect(query.toLowerCase()).not.toContain("cypress");
        expect(query.toLowerCase()).not.toContain("pine forests");
      }

      // All attempt queries should reference the forest name, never the area
      const attemptQueries = (result.attempts ?? []).map(
        (attempt) => attempt.query
      );
      expect(attemptQueries.length).toBeGreaterThan(0);
      for (const attemptQuery of attemptQueries) {
        expect(attemptQuery.toLowerCase()).toContain("badja");
        expect(attemptQuery.toLowerCase()).not.toContain("cypress");
      }
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("uses double-colon alias key format without area name", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-alias-key-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
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
        return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
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

      // First call populates the cache under the alias key
      await geocoder.geocodeForest("Badja State Forest", "Some Area Name");

      // Second call should hit the alias cache
      const cachedResult = await geocoder.geocodeForest("Badja State Forest", "Some Area Name");

      expect(cachedResult.latitude).toBe(-35.89);

      // The cache hit preserves the original provider but the attempt records CACHE_HIT
      const cacheAttempt = cachedResult.attempts?.find(
        (attempt) => attempt.outcome === "CACHE_HIT"
      );
      expect(cacheAttempt).toBeDefined();

      // The alias key should use double-colon format without area name
      expect(cacheAttempt?.aliasKey).toBe("alias:forest::badja state forest");
      expect(cacheAttempt?.aliasKey).not.toContain("some area");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
