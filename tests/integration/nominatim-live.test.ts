import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ForestGeocoder } from "../../pipeline/services/forest-geocoder.js";

const shouldRunLiveNominatimTest = process.env.NOMINATIM_LIVE_TEST !== "0";
const describeLiveNominatim = shouldRunLiveNominatimTest ? describe : describe.skip;

const nominatimBaseUrl = process.env.NOMINATIM_BASE_URL ?? "http://localhost:8080";

describeLiveNominatim("live Nominatim integration", () => {
  it("returns sensible NSW coordinates for known area and forest", async () => {
    const temporaryDirectoryPath = mkdtempSync(
      join(process.cwd(), ".tmp_nominatim-live-test-")
    );
    const cacheDbPath = join(temporaryDirectoryPath, "coordinates.sqlite");

    const geocoder = new ForestGeocoder({
      cacheDbPath,
      nominatimBaseUrl,
      googleApiKey: null,
      maxNewLookupsPerRun: 0,
      requestDelayMs: 0,
      requestTimeoutMs: 20_000,
      retryAttempts: 2,
      retryBaseDelayMs: 200
    });

    try {
      const forestResult = await geocoder.geocodeForest(
        "Belanglo State Forest"
      );

      // FCNSW ArcGIS is preferred; Nominatim is only used as fallback
      expect(["FCNSW_ARCGIS", "OSM_NOMINATIM"]).toContain(forestResult.provider);
      expect(forestResult.latitude).not.toBeNull();
      expect(forestResult.longitude).not.toBeNull();

      // FCNSW display names use UPPERCASE + SF number format rather than full address
      if (forestResult.provider === "FCNSW_ARCGIS") {
        expect(forestResult.displayName).toContain("BELANGLO");
      } else {
        expect(forestResult.displayName).toContain("New South Wales");
      }

      const forestLatitude = forestResult.latitude as number;
      const forestLongitude = forestResult.longitude as number;

      expect(forestLatitude).toBeGreaterThan(-38);
      expect(forestLatitude).toBeLessThan(-28);
      expect(forestLongitude).toBeGreaterThan(140);
      expect(forestLongitude).toBeLessThan(154);
    } finally {
      rmSync(temporaryDirectoryPath, { recursive: true, force: true });
    }
  });

  it("attempts geocoding Brewombenia State Forest and captures diagnostics", { timeout: 30_000 }, async () => {
    const temporaryDirectoryPath = mkdtempSync(
      join(process.cwd(), ".tmp_nominatim-brewombenia-live-test-")
    );
    const cacheDbPath = join(temporaryDirectoryPath, "coordinates.sqlite");

    const geocoder = new ForestGeocoder({
      cacheDbPath,
      nominatimBaseUrl,
      googleApiKey: null,
      maxNewLookupsPerRun: 0,
      requestDelayMs: 0,
      requestTimeoutMs: 20_000,
      retryAttempts: 2,
      retryBaseDelayMs: 200
    });

    try {
      const brewombeniaResult = await geocoder.geocodeForest(
        "Brewombenia State Forest"
      );
      console.log("Brewombenia geocoding result:", brewombeniaResult);

      // Verify that lookup attempts were made for this forest
      expect((brewombeniaResult.attempts ?? []).length).toBeGreaterThan(0);
      expect(
        (brewombeniaResult.attempts ?? []).some((attempt) =>
          attempt.query.includes("Brewombenia State Forest")
        )
      ).toBe(true);

      // Brewombenia may or may not be in the local Nominatim database.
      // FCNSW ArcGIS may also resolve it (as BEREWOMBENIA).
      // If resolved, verify coordinates are within NSW bounds.
      if (brewombeniaResult.latitude !== null) {
        expect(["FCNSW_ARCGIS", "OSM_NOMINATIM"]).toContain(brewombeniaResult.provider);
        expect(brewombeniaResult.latitude as number).toBeGreaterThan(-38);
        expect(brewombeniaResult.latitude as number).toBeLessThan(-28);
        expect(brewombeniaResult.longitude as number).toBeGreaterThan(140);
        expect(brewombeniaResult.longitude as number).toBeLessThan(154);
      }
    } finally {
      rmSync(temporaryDirectoryPath, { recursive: true, force: true });
    }
  });
});
