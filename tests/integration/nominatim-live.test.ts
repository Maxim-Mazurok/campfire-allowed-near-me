import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OSMGeocoder } from "../../apps/api/src/services/osm-geocoder.js";

const shouldRunLiveNominatimTest = process.env.NOMINATIM_LIVE_TEST !== "0";
const describeLiveNominatim = shouldRunLiveNominatimTest ? describe : describe.skip;

const nominatimBaseUrl = process.env.NOMINATIM_BASE_URL ?? "http://localhost:8080";

describeLiveNominatim("live Nominatim integration", () => {
  it("returns sensible NSW coordinates for known area and forest", async () => {
    const temporaryDirectoryPath = mkdtempSync(
      join(process.cwd(), ".tmp_nominatim-live-test-")
    );
    const cacheDbPath = join(temporaryDirectoryPath, "coordinates.sqlite");

    const geocoder = new OSMGeocoder({
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
      const areaResult = await geocoder.geocodeArea(
        "Riverina, New South Wales",
        "https://example.com/riverina-new-south-wales-live-test"
      );

      expect(areaResult.provider).toBe("OSM_NOMINATIM");
      expect(areaResult.latitude).not.toBeNull();
      expect(areaResult.longitude).not.toBeNull();
      expect(areaResult.displayName).toContain("New South Wales");

      const forestResult = await geocoder.geocodeForest(
        "Belanglo State Forest",
        "South Coast"
      );

      expect(forestResult.provider).toBe("OSM_NOMINATIM");
      expect(forestResult.latitude).not.toBeNull();
      expect(forestResult.longitude).not.toBeNull();
      expect(forestResult.displayName).toContain("New South Wales");

      const areaLatitude = areaResult.latitude as number;
      const areaLongitude = areaResult.longitude as number;
      const forestLatitude = forestResult.latitude as number;
      const forestLongitude = forestResult.longitude as number;

      expect(areaLatitude).toBeGreaterThan(-38);
      expect(areaLatitude).toBeLessThan(-28);
      expect(areaLongitude).toBeGreaterThan(140);
      expect(areaLongitude).toBeLessThan(154);

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

    const geocoder = new OSMGeocoder({
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
        "Brewombenia State Forest",
        "Cypress pine forests"
      );
      console.log("Brewombenia geocoding result:", brewombeniaResult);

      expect((brewombeniaResult.attempts ?? []).length).toBeGreaterThan(0);
      expect(
        (brewombeniaResult.attempts ?? []).some((attempt) =>
          attempt.query.includes("Brewombenia State Forest")
        )
      ).toBe(true);

      expect(brewombeniaResult.provider).toBe("OSM_NOMINATIM");
      expect(brewombeniaResult.latitude).not.toBeNull();
      expect(brewombeniaResult.longitude).not.toBeNull();
      expect(brewombeniaResult.latitude as number).toBeGreaterThan(-38);
      expect(brewombeniaResult.latitude as number).toBeLessThan(-28);
      expect(brewombeniaResult.longitude as number).toBeGreaterThan(140);
      expect(brewombeniaResult.longitude as number).toBeLessThan(154);
    } finally {
      rmSync(temporaryDirectoryPath, { recursive: true, force: true });
    }
  });
});
