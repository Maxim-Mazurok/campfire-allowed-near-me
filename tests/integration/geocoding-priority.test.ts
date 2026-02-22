import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OSMGeocoder } from "../../apps/api/src/services/osm-geocoder.js";

describe("OSMGeocoder forest lookup priority", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses forest-name-only query before area-guided query", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-priority-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const searchTextQueries: string[] = [];

    globalThis.fetch = vi.fn(async (url, init) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.hostname === "places.googleapis.com") {
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as { textQuery?: string };
        const textQuery = String(requestBody.textQuery ?? "");
        searchTextQueries.push(textQuery);

        if (textQuery === "Badja State Forest, New South Wales, Australia") {
          return new Response(
            JSON.stringify({
              places: [
                {
                  displayName: { text: "Badja State Forest" },
                  formattedAddress: "Badja State Forest, NSW",
                  location: {
                    latitude: -35.89,
                    longitude: 149.57
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ places: [] }), {
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
      const geocoder = new OSMGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const geocodeResult = await geocoder.geocodeForest(
        "Badja State Forest",
        "State forests around Bombala"
      );

      expect(geocodeResult.latitude).toBe(-35.89);
      expect(geocodeResult.longitude).toBe(149.57);
      expect(searchTextQueries[0]).toBe("Badja State Forest, New South Wales, Australia");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("falls back to area-guided forest query only when forest-name-only misses", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-fallback-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const searchTextQueries: string[] = [];

    globalThis.fetch = vi.fn(async (url, init) => {
      const parsedUrl = new URL(String(url));
      if (parsedUrl.hostname === "places.googleapis.com") {
        const requestBody = JSON.parse(String(init?.body ?? "{}")) as { textQuery?: string };
        const textQuery = String(requestBody.textQuery ?? "");
        searchTextQueries.push(textQuery);

        if (textQuery === "Badja State Forest, near State forests around Bombala, New South Wales, Australia") {
          return new Response(
            JSON.stringify({
              places: [
                {
                  displayName: { text: "Badja State Forest" },
                  formattedAddress: "Badja State Forest, NSW",
                  location: {
                    latitude: -35.9,
                    longitude: 149.58
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ places: [] }), {
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
      const geocoder = new OSMGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key"
      });

      const geocodeResult = await geocoder.geocodeForest(
        "Badja State Forest",
        "State forests around Bombala"
      );

      expect(geocodeResult.latitude).toBe(-35.9);
      expect(geocodeResult.longitude).toBe(149.58);
      expect(searchTextQueries).toContain("Badja State Forest, New South Wales, Australia");
      expect(searchTextQueries).toContain(
        "Badja State Forest, near State forests around Bombala, New South Wales, Australia"
      );
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

      return new Response(JSON.stringify({ places: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    try {
      const geocoder = new OSMGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        maxNewLookupsPerRun: 0,
        googleApiKey: "test-key",
        nominatimBaseUrl: "http://localhost:8080"
      });

      const geocodeResult = await geocoder.geocodeForest(
        "Badja State Forest",
        "State forests around Bombala"
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

  it("returns Nominatim first and upgrades to Google from background enrichment", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-background-google-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    let googleRequests = 0;

    globalThis.fetch = vi.fn(async (url, init) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "places.googleapis.com") {
        googleRequests += 1;

        const requestBody = JSON.parse(String(init?.body ?? "{}")) as { textQuery?: string };
        if (requestBody.textQuery?.includes("Badja")) {
          return new Response(
            JSON.stringify({
              places: [
                {
                  displayName: { text: "Badja State Forest" },
                  formattedAddress: "Badja State Forest, NSW",
                  location: {
                    latitude: -35.77,
                    longitude: 149.66
                  }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ places: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
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
      const geocoder = new OSMGeocoder({
        cacheDbPath,
        requestDelayMs: 0,
        requestTimeoutMs: 5000,
        retryAttempts: 1,
        googleApiKey: "test-key",
        nominatimBaseUrl: "http://localhost:8080"
      });

      const firstLookup = await geocoder.geocodeForest(
        "Badja State Forest",
        "State forests around Bombala"
      );

      expect(firstLookup.provider).toBe("OSM_NOMINATIM");
      expect(firstLookup.latitude).toBe(-35.91);
      expect(firstLookup.longitude).toBe(149.59);

      for (let i = 0; i < 30 && googleRequests === 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(googleRequests).toBeGreaterThan(0);

      let secondLookup = await geocoder.geocodeForest(
        "Badja State Forest",
        "State forests around Bombala"
      );

      for (let i = 0; i < 30 && secondLookup.provider !== "GOOGLE_PLACES"; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        secondLookup = await geocoder.geocodeForest(
          "Badja State Forest",
          "State forests around Bombala"
        );
      }

      expect(secondLookup.provider).toBe("GOOGLE_PLACES");
      expect(secondLookup.latitude).toBe(-35.77);
      expect(secondLookup.longitude).toBe(149.66);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
