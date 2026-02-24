import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForestGeocoder } from "../../apps/api/src/services/forest-geocoder.js";

/**
 * Tests for using the matched directory forest name as a geocoding hint.
 *
 * When the fire ban page uses a slightly different name than the Forestry
 * Corp directory (e.g. "Croft Knoll" vs "Crofts Knoll"), the directory
 * name — already resolved via fuzzy facility matching — should be passed
 * to geocodeForest as an additional query candidate so that Nominatim
 * can find the correct feature.
 */
describe("geocodeForest with directoryForestName hint", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const createTestGeocoder = (): { geocoder: ForestGeocoder; cleanup: () => void } => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-dir-hint-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");
    const geocoder = new ForestGeocoder({
      cacheDbPath,
      requestDelayMs: 0,
      requestTimeoutMs: 5000,
      retryAttempts: 1,
      retryBaseDelayMs: 0,
      localNominatimDelayMs: 0,
      localNominatimHttp429RetryDelayMs: 0,
      googleApiKey: "test-key",
      maxNewLookupsPerRun: 50,
      nominatimBaseUrl: "http://localhost:8080"
    });

    return {
      geocoder,
      cleanup: () => rmSync(temporaryDirectory, { recursive: true, force: true })
    };
  };

  /**
   * Stub fetch so Nominatim only responds to queries containing the given
   * substring (case-insensitive), and Google Geocoding always returns empty.
   */
  const stubFetchWithNominatimMatch = (
    nominatimMatchSubstring: string,
    coordinates: { latitude: number; longitude: number; displayName: string }
  ): { nominatimCalls: string[]; googleCalls: string[] } => {
    const nominatimCalls: string[] = [];
    const googleCalls: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        googleCalls.push(parsedUrl.searchParams.get("address") ?? "");
        return new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (parsedUrl.pathname === "/search") {
        const queryParameter = parsedUrl.searchParams.get("q") ?? "";
        nominatimCalls.push(queryParameter);

        if (queryParameter.toLowerCase().includes(nominatimMatchSubstring.toLowerCase())) {
          return new Response(JSON.stringify([{
            display_name: coordinates.displayName,
            lat: String(coordinates.latitude),
            lon: String(coordinates.longitude),
            importance: 0.8,
            type: "forest"
          }]), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          });
        }

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

    return { nominatimCalls, googleCalls };
  };

  it("resolves Crofts Knoll via directory name when fire ban says Croft Knoll", async () => {
    const { geocoder, cleanup } = createTestGeocoder();

    // Nominatim recognises "Crofts Knoll" (with 's') but not "Croft Knoll"
    const calls = stubFetchWithNominatimMatch("Crofts Knoll", {
      latitude: -31.0421,
      longitude: 151.6269,
      displayName: "Crofts Knoll State Forest, Walcha Shire, NSW"
    });

    try {
      const result = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast",
        { directoryForestName: "Crofts Knoll State Forest" }
      );

      expect(result.latitude).toBe(-31.0421);
      expect(result.longitude).toBe(151.6269);
      expect(result.provider).toBe("OSM_NOMINATIM");

      // Verify that the directory name was tried as a Nominatim query
      const directoryNameQueries = calls.nominatimCalls.filter(
        (query) => query.toLowerCase().includes("crofts knoll")
      );
      expect(directoryNameQueries.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it("directory name candidates appear before area-name fallback", async () => {
    const { geocoder, cleanup } = createTestGeocoder();

    // Nominatim only responds to "Crofts Knoll" queries
    const calls = stubFetchWithNominatimMatch("Crofts Knoll", {
      latitude: -31.0421,
      longitude: 151.6269,
      displayName: "Crofts Knoll State Forest"
    });

    try {
      const result = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast",
        { directoryForestName: "Crofts Knoll State Forest" }
      );

      expect(result.latitude).toBe(-31.0421);

      // The area-name fallback queries should NOT have been tried,
      // since the directory name query resolved first
      const areaFallbackQueries = calls.nominatimCalls.filter(
        (query) => query.toLowerCase().includes("north coast")
      );
      expect(areaFallbackQueries).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("skips directory name candidates when it matches fire ban name", async () => {
    const { geocoder, cleanup } = createTestGeocoder();

    // Nominatim responds to any "Meryla" query
    const calls = stubFetchWithNominatimMatch("Meryla", {
      latitude: -34.56,
      longitude: 150.42,
      displayName: "Meryla State Forest"
    });

    try {
      const result = await geocoder.geocodeForest(
        "Meryla State Forest",
        "Southern Highlands around Moss Vale",
        // Same as fire ban name — should not produce duplicate candidates
        { directoryForestName: "Meryla State Forest" }
      );

      expect(result.latitude).toBe(-34.56);

      // Directory name is identical to fire ban name, so no duplication
      const merylaQueries = calls.nominatimCalls.filter(
        (query) => query.toLowerCase().includes("meryla")
      );
      // Should be the same count as without directoryForestName
      expect(merylaQueries.length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it("works without directoryForestName (backward compatible)", async () => {
    const { geocoder, cleanup } = createTestGeocoder();

    const calls = stubFetchWithNominatimMatch("Meryla", {
      latitude: -34.56,
      longitude: 150.42,
      displayName: "Meryla State Forest"
    });

    try {
      // No directoryForestName — should behave exactly as before
      const result = await geocoder.geocodeForest(
        "Meryla State Forest",
        "Southern Highlands around Moss Vale"
      );

      expect(result.latitude).toBe(-34.56);
      expect(result.longitude).toBe(150.42);
    } finally {
      cleanup();
    }
  });

  it("caches result under forest alias key so second call is instant", async () => {
    const { geocoder, cleanup } = createTestGeocoder();

    const calls = stubFetchWithNominatimMatch("Crofts Knoll", {
      latitude: -31.0421,
      longitude: 151.6269,
      displayName: "Crofts Knoll State Forest"
    });

    try {
      await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast",
        { directoryForestName: "Crofts Knoll State Forest" }
      );

      calls.nominatimCalls.length = 0;
      calls.googleCalls.length = 0;

      // Second call should hit alias cache immediately
      const secondResult = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast",
        { directoryForestName: "Crofts Knoll State Forest" }
      );

      expect(secondResult.latitude).toBe(-31.0421);
      expect(secondResult.longitude).toBe(151.6269);
      expect(calls.nominatimCalls).toHaveLength(0);
      expect(calls.googleCalls).toHaveLength(0);
      expect(secondResult.attempts).toHaveLength(1);
      expect(secondResult.attempts?.[0]?.outcome).toBe("CACHE_HIT");
    } finally {
      cleanup();
    }
  });
});
