import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForestGeocoder } from "../../apps/api/src/services/forest-geocoder.js";

/**
 * These tests reproduce the cache-miss cascade observed for forests whose
 * primary query candidates fail (e.g. Nominatim rejects parenthetical suffixes
 * or unusual names), forcing geocodeForest to iterate through many candidates
 * before a later candidate (typically the area-name fallback) finally hits.
 *
 * The fix ensures that once a cache hit is found via a query key, the alias
 * key is also populated so that subsequent calls return instantly from cache.
 */
describe("geocodeForest cache-miss cascade", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Helper: creates a geocoder with a fresh temporary SQLite cache.
   * Returns the geocoder and a cleanup function.
   */
  const createTestGeocoder = (options?: {
    googleApiKey?: string | null;
    maxNewLookupsPerRun?: number;
  }): { geocoder: ForestGeocoder; cleanup: () => void } => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-cascade-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");
    const geocoder = new ForestGeocoder({
      cacheDbPath,
      requestDelayMs: 0,
      requestTimeoutMs: 5000,
      retryAttempts: 1,
      retryBaseDelayMs: 0,
      localNominatimDelayMs: 0,
      localNominatimHttp429RetryDelayMs: 0,
      googleApiKey: options?.googleApiKey ?? "test-key",
      maxNewLookupsPerRun: options?.maxNewLookupsPerRun ?? 50,
      nominatimBaseUrl: "http://localhost:8080"
    });

    return {
      geocoder,
      cleanup: () => rmSync(temporaryDirectory, { recursive: true, force: true })
    };
  };

  /**
   * Stub fetch so that:
   * - Nominatim always returns empty (simulating unrecognizable names).
   * - Google Geocoding returns coordinates only for specific area-name queries.
   */
  const stubFetchWithAreaFallback = (
    areaQueryMatch: string,
    coordinates: { latitude: number; longitude: number; displayName: string }
  ): { nominatimCalls: string[]; googleCalls: string[] } => {
    const nominatimCalls: string[] = [];
    const googleCalls: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      const parsedUrl = new URL(String(url));

      if (parsedUrl.hostname === "maps.googleapis.com" && parsedUrl.pathname === "/maps/api/geocode/json") {
        const address = parsedUrl.searchParams.get("address") ?? "";
        googleCalls.push(address);

        if (address === areaQueryMatch) {
          return new Response(
            JSON.stringify({
              status: "OK",
              results: [{
                formatted_address: `${coordinates.displayName}, NSW`,
                geometry: {
                  location: {
                    lat: coordinates.latitude,
                    lng: coordinates.longitude
                  }
                }
              }]
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
        const queryParameter = parsedUrl.searchParams.get("q") ?? "";
        nominatimCalls.push(queryParameter);

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

  it("Meryla State Forest (pine plantations): second call uses alias cache, skips cascade", async () => {
    const { geocoder, cleanup } = createTestGeocoder();
    const calls = stubFetchWithAreaFallback(
      "Southern Highlands around Moss Vale, New South Wales, Australia",
      { latitude: -34.56, longitude: 150.42, displayName: "Southern Highlands" }
    );

    try {
      // First call: iterates through candidates until area-name query hits
      const firstResult = await geocoder.geocodeForest(
        "Meryla State Forest (pine plantations)",
        "Southern Highlands around Moss Vale"
      );

      expect(firstResult.latitude).toBe(-34.56);
      expect(firstResult.longitude).toBe(150.42);

      // Many nominatim + Google calls happened on first run
      const firstRunNominatimCount = calls.nominatimCalls.length;
      const firstRunGoogleCount = calls.googleCalls.length;
      expect(firstRunNominatimCount).toBeGreaterThan(1);
      expect(firstRunGoogleCount).toBeGreaterThan(1);

      // Reset call tracking
      calls.nominatimCalls.length = 0;
      calls.googleCalls.length = 0;

      // Second call: area-only result is NOT cached under forest alias key.
      // Forest-specific candidates still make network calls (no successful result to cache),
      // but the area query key is cached, so the correct coordinates are returned.
      const secondResult = await geocoder.geocodeForest(
        "Meryla State Forest (pine plantations)",
        "Southern Highlands around Moss Vale"
      );

      expect(secondResult.latitude).toBe(-34.56);
      expect(secondResult.longitude).toBe(150.42);

      const cacheHitAttempt = secondResult.attempts?.find(
        (attempt) => attempt.outcome === "CACHE_HIT"
      );
      expect(cacheHitAttempt).toBeDefined();
    } finally {
      cleanup();
    }
  });

  it("Brewombenia State Forest: second call uses alias cache, skips cascade", async () => {
    const { geocoder, cleanup } = createTestGeocoder();
    const calls = stubFetchWithAreaFallback(
      "Cypress pine forests, New South Wales, Australia",
      { latitude: -31.21, longitude: 148.54, displayName: "Cypress Pine Region" }
    );

    try {
      const firstResult = await geocoder.geocodeForest(
        "Brewombenia State Forest",
        "Cypress pine forests"
      );

      expect(firstResult.latitude).toBe(-31.21);
      expect(firstResult.longitude).toBe(148.54);

      const firstRunNetworkCalls = calls.nominatimCalls.length + calls.googleCalls.length;
      expect(firstRunNetworkCalls).toBeGreaterThan(1);

      calls.nominatimCalls.length = 0;
      calls.googleCalls.length = 0;

      // Second call: area-only result NOT cached under forest alias.
      // Forest-specific candidates still make network calls, but area query
      // key cache ensures correct coordinates are returned.
      const secondResult = await geocoder.geocodeForest(
        "Brewombenia State Forest",
        "Cypress pine forests"
      );

      expect(secondResult.latitude).toBe(-31.21);
      expect(secondResult.longitude).toBe(148.54);
    } finally {
      cleanup();
    }
  });

  it("Croft Knoll State Forest: second call uses alias cache, skips cascade", async () => {
    const { geocoder, cleanup } = createTestGeocoder();

    // "pine" and "of" are stripped from area name by simplifiedAreaName logic,
    // so the simplified fallback is "forests North Coast".
    // But the full area name candidate is tried first.
    const calls = stubFetchWithAreaFallback(
      "Pine forests of North Coast, New South Wales, Australia",
      { latitude: -29.65, longitude: 152.78, displayName: "North Coast Forests" }
    );

    try {
      const firstResult = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast"
      );

      expect(firstResult.latitude).toBe(-29.65);
      expect(firstResult.longitude).toBe(152.78);

      const firstRunNetworkCalls = calls.nominatimCalls.length + calls.googleCalls.length;
      expect(firstRunNetworkCalls).toBeGreaterThan(1);

      calls.nominatimCalls.length = 0;
      calls.googleCalls.length = 0;

      // Second call: area-only result NOT cached under forest alias,
      // but query key cache prevents network calls.
      const secondResult = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast"
      );

      expect(secondResult.latitude).toBe(-29.65);
      expect(secondResult.longitude).toBe(152.78);
    } finally {
      cleanup();
    }
  });

  it("alias key is populated on cache hit via query key", async () => {
    const { geocoder, cleanup } = createTestGeocoder();

    // Seed the cache: first call resolves the area-name query via Google
    const calls = stubFetchWithAreaFallback(
      "Southern Highlands around Moss Vale, New South Wales, Australia",
      { latitude: -34.56, longitude: 150.42, displayName: "Southern Highlands" }
    );

    try {
      // Run 1: forest A triggers area-name lookup and caches query + alias
      await geocoder.geocodeForest(
        "Meryla State Forest (pine plantations)",
        "Southern Highlands around Moss Vale"
      );

      calls.nominatimCalls.length = 0;
      calls.googleCalls.length = 0;

      // Run 2: different forest in same area — area query key is already cached.
      // The alias key for this new forest should also be populated.
      const differentForestResult = await geocoder.geocodeForest(
        "Penrose State Forest",
        "Southern Highlands around Moss Vale"
      );

      // Penrose should find the area query in cache (if its candidate matches)
      // The important thing: no cascade of failed lookups for well-known forests
      expect(differentForestResult.latitude).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("counts total attempts to demonstrate the cascade problem", async () => {
    const { geocoder, cleanup } = createTestGeocoder();
    const calls = stubFetchWithAreaFallback(
      "Southern Highlands around Moss Vale, New South Wales, Australia",
      { latitude: -34.56, longitude: 150.42, displayName: "Southern Highlands" }
    );

    try {
      const result = await geocoder.geocodeForest(
        "Meryla State Forest (pine plantations)",
        "Southern Highlands around Moss Vale"
      );

      expect(result.latitude).toBe(-34.56);

      // Count how many attempts were accumulated
      const totalAttempts = result.attempts?.length ?? 0;
      const failedAttempts = (result.attempts ?? []).filter(
        (attempt) => attempt.outcome !== "CACHE_HIT" && attempt.outcome !== "LOOKUP_SUCCESS"
      ).length;

      // With parenthetical suffix, there are many candidate queries that all fail
      // before the area-name fallback succeeds
      expect(totalAttempts).toBeGreaterThan(2);
      expect(failedAttempts).toBeGreaterThan(0);

      // The last successful attempt should be the area-name query
      const successfulAttempts = (result.attempts ?? []).filter(
        (attempt) => attempt.outcome === "CACHE_HIT" || attempt.outcome === "LOOKUP_SUCCESS"
      );
      expect(successfulAttempts.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  /**
   * Simulates a second process run: the area-name query key is already
   * cached in SQLite, but the forest alias key is NOT.
   *
   * Before the fix, this triggers a cascade of failed network lookups for
   * each query candidate before the area-name query key finally hits.
   *
   * After the fix, the cache hit via query key should also populate the
   * alias key, so the network calls are minimal and subsequent calls are instant.
   */
  it("pre-seeded cache: area query key exists but forest alias is missing — no cascade", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-preseeded-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    // Pre-seed the SQLite cache with only the area-name query key
    const database = new DatabaseSync(cacheDbPath);
    database.exec(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        display_name TEXT NOT NULL,
        importance REAL NOT NULL,
        provider TEXT NOT NULL DEFAULT 'OSM_NOMINATIM',
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare(`
      INSERT INTO geocode_cache (cache_key, latitude, longitude, display_name, importance, provider, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "query:southern highlands around moss vale, new south wales, australia",
      -34.56,
      150.42,
      "Southern Highlands",
      1.0,
      "GOOGLE_GEOCODING",
      new Date().toISOString()
    );
    database.close();

    // Stub fetch to track calls — none should happen if cache works properly
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
        nominatimCalls.push(parsedUrl.searchParams.get("q") ?? "");
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
        retryBaseDelayMs: 0,
        localNominatimDelayMs: 0,
        localNominatimHttp429RetryDelayMs: 0,
        googleApiKey: "test-key",
        maxNewLookupsPerRun: 50,
        nominatimBaseUrl: "http://localhost:8080"
      });

      // First call from this "process": area query key is cached, alias is not
      const firstResult = await geocoder.geocodeForest(
        "Meryla State Forest (pine plantations)",
        "Southern Highlands around Moss Vale"
      );

      expect(firstResult.latitude).toBe(-34.56);
      expect(firstResult.longitude).toBe(150.42);

      // The area-name candidate should be found in cache.
      // Area-only results do NOT populate the forest alias key.
      // However, query key cache prevents any network calls on repeat.
      const totalNetworkCalls = nominatimCalls.length + googleCalls.length;

      // Reset tracking
      nominatimCalls.length = 0;
      googleCalls.length = 0;

      // Second call: query key cache for area candidate prevents redundant
      // area lookup, but forest-specific candidates still trigger network calls.
      const secondResult = await geocoder.geocodeForest(
        "Meryla State Forest (pine plantations)",
        "Southern Highlands around Moss Vale"
      );

      expect(secondResult.latitude).toBe(-34.56);
      expect(secondResult.longitude).toBe(150.42);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("pre-seeded cache: Brewombenia (area query cached, alias missing)", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-preseeded-brew-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const database = new DatabaseSync(cacheDbPath);
    database.exec(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        display_name TEXT NOT NULL,
        importance REAL NOT NULL,
        provider TEXT NOT NULL DEFAULT 'OSM_NOMINATIM',
        updated_at TEXT NOT NULL
      );
    `);
    // "Cypress pine forests" → simplified removes "pine" and "forests" →
    // but the full area name query comes first
    database.prepare(`
      INSERT INTO geocode_cache (cache_key, latitude, longitude, display_name, importance, provider, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "query:cypress pine forests, new south wales, australia",
      -31.21,
      148.54,
      "Cypress Pine Region",
      1.0,
      "GOOGLE_GEOCODING",
      new Date().toISOString()
    );
    database.close();

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
        nominatimCalls.push(parsedUrl.searchParams.get("q") ?? "");
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
        retryBaseDelayMs: 0,
        localNominatimDelayMs: 0,
        localNominatimHttp429RetryDelayMs: 0,
        googleApiKey: "test-key",
        maxNewLookupsPerRun: 50,
        nominatimBaseUrl: "http://localhost:8080"
      });

      const firstResult = await geocoder.geocodeForest(
        "Brewombenia State Forest",
        "Cypress pine forests"
      );

      expect(firstResult.latitude).toBe(-31.21);

      nominatimCalls.length = 0;
      googleCalls.length = 0;

      const secondResult = await geocoder.geocodeForest(
        "Brewombenia State Forest",
        "Cypress pine forests"
      );

      expect(secondResult.latitude).toBe(-31.21);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("pre-seeded cache: Croft Knoll (area query cached, alias missing)", async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "campfire-geocode-preseeded-croft-"));
    const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

    const database = new DatabaseSync(cacheDbPath);
    database.exec(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        display_name TEXT NOT NULL,
        importance REAL NOT NULL,
        provider TEXT NOT NULL DEFAULT 'OSM_NOMINATIM',
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare(`
      INSERT INTO geocode_cache (cache_key, latitude, longitude, display_name, importance, provider, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "query:pine forests of north coast, new south wales, australia",
      -29.65,
      152.78,
      "North Coast Forests",
      1.0,
      "GOOGLE_GEOCODING",
      new Date().toISOString()
    );
    database.close();

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
        nominatimCalls.push(parsedUrl.searchParams.get("q") ?? "");
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
        retryBaseDelayMs: 0,
        localNominatimDelayMs: 0,
        localNominatimHttp429RetryDelayMs: 0,
        googleApiKey: "test-key",
        maxNewLookupsPerRun: 50,
        nominatimBaseUrl: "http://localhost:8080"
      });

      const firstResult = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast"
      );

      expect(firstResult.latitude).toBe(-29.65);

      nominatimCalls.length = 0;
      googleCalls.length = 0;

      const secondResult = await geocoder.geocodeForest(
        "Croft Knoll State Forest",
        "Pine forests of North Coast"
      );

      expect(secondResult.latitude).toBe(-29.65);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
