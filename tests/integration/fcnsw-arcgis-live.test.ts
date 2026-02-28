import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ForestGeocoder } from "../../pipeline/services/forest-geocoder.js";

/**
 * Live integration tests against the FCNSW ArcGIS Feature Server.
 *
 * These tests call the real public ArcGIS REST API and verify that the
 * geocoder returns accurate polygon-centroid coordinates for well-known
 * NSW state forests.
 *
 * Set FCNSW_LIVE_TEST=0 to skip these when offline or in CI without
 * outbound network access.
 */
const shouldRunFcnswLiveTest = process.env.FCNSW_LIVE_TEST !== "0";
const describeFcnswLive = shouldRunFcnswLiveTest ? describe : describe.skip;

describeFcnswLive("live FCNSW ArcGIS integration", () => {
  it(
    "resolves Belanglo State Forest with polygon centroid",
    { timeout: 30_000 },
    async () => {
      const temporaryDirectory = mkdtempSync(
        join(process.cwd(), ".tmp_fcnsw-live-belanglo-")
      );
      const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

      const geocoder = new ForestGeocoder({
        cacheDbPath,
        googleApiKey: null,
        maxNewLookupsPerRun: 0,
        requestDelayMs: 0,
        requestTimeoutMs: 20_000,
        retryAttempts: 2,
        retryBaseDelayMs: 500
      });

      try {
        const result = await geocoder.geocodeForest("Belanglo State Forest");

        expect(result.provider).toBe("FCNSW_ARCGIS");
        expect(result.latitude).not.toBeNull();
        expect(result.longitude).not.toBeNull();
        expect(result.displayName).toContain("BELANGLO");
        expect(result.confidence).toBe(1);

        const latitude = result.latitude as number;
        const longitude = result.longitude as number;

        // Belanglo is approximately -34.5S, 150.1E — verify within ±1 degree
        expect(latitude).toBeGreaterThan(-35.5);
        expect(latitude).toBeLessThan(-33.5);
        expect(longitude).toBeGreaterThan(149.1);
        expect(longitude).toBeLessThan(151.1);

        // FCNSW attempt should be present
        const fcnswAttempt = result.attempts?.find(
          (attempt) => attempt.provider === "FCNSW_ARCGIS"
        );
        expect(fcnswAttempt).toBeDefined();
        expect(fcnswAttempt?.outcome).toBe("LOOKUP_SUCCESS");
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  );

  it(
    "resolves Badja State Forest with polygon centroid",
    { timeout: 30_000 },
    async () => {
      const temporaryDirectory = mkdtempSync(
        join(process.cwd(), ".tmp_fcnsw-live-badja-")
      );
      const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

      const geocoder = new ForestGeocoder({
        cacheDbPath,
        googleApiKey: null,
        maxNewLookupsPerRun: 0,
        requestDelayMs: 0,
        requestTimeoutMs: 20_000,
        retryAttempts: 2,
        retryBaseDelayMs: 500
      });

      try {
        const result = await geocoder.geocodeForest("Badja State Forest");

        expect(result.provider).toBe("FCNSW_ARCGIS");
        expect(result.latitude).not.toBeNull();
        expect(result.longitude).not.toBeNull();
        expect(result.displayName).toContain("BADJA");

        const latitude = result.latitude as number;
        const longitude = result.longitude as number;

        // Badja is approximately -36S, 149.5E
        expect(latitude).toBeGreaterThan(-37);
        expect(latitude).toBeLessThan(-35);
        expect(longitude).toBeGreaterThan(148.5);
        expect(longitude).toBeLessThan(150.5);
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  );

  it(
    "returns empty for a non-existent forest name",
    { timeout: 30_000 },
    async () => {
      const temporaryDirectory = mkdtempSync(
        join(process.cwd(), ".tmp_fcnsw-live-nonexistent-")
      );
      const cacheDbPath = join(temporaryDirectory, "coordinates.sqlite");

      const geocoder = new ForestGeocoder({
        cacheDbPath,
        googleApiKey: null,
        maxNewLookupsPerRun: 0,
        requestDelayMs: 0,
        requestTimeoutMs: 20_000,
        retryAttempts: 2,
        retryBaseDelayMs: 500
      });

      try {
        const result = await geocoder.geocodeForest(
          "Nonexistent Zzz Xyz Forest"
        );

        // FCNSW should return empty, and since Google key is null and budget
        // is 0 there will be no fallback coordinates
        const fcnswAttempt = result.attempts?.find(
          (attempt) => attempt.provider === "FCNSW_ARCGIS"
        );
        expect(fcnswAttempt).toBeDefined();
        expect(fcnswAttempt?.outcome).toBe("EMPTY_RESULT");
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    }
  );
});
