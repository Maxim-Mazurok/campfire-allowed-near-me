import { describe, expect, it } from "vitest";
import { OSMGeocoder } from "../../apps/api/src/services/osm-geocoder.js";

const shouldRunLiveNominatimTest = process.env.NOMINATIM_LIVE_TEST === "1";
const describeLiveNominatim = shouldRunLiveNominatimTest ? describe : describe.skip;

const nominatimBaseUrl = process.env.NOMINATIM_BASE_URL ?? "http://localhost:8080";

describeLiveNominatim("live Nominatim integration", () => {
  it("returns sensible NSW coordinates for known area and forest", async () => {
    const geocoder = new OSMGeocoder({
      nominatimBaseUrl,
      googleApiKey: null,
      maxNewLookupsPerRun: 0,
      requestDelayMs: 0,
      requestTimeoutMs: 20_000,
      retryAttempts: 2,
      retryBaseDelayMs: 200
    });

    const areaResult = await geocoder.geocodeArea(
      "South Coast",
      "https://example.com/south-coast"
    );

    expect(areaResult.provider).toBe("OSM_NOMINATIM");
    expect(areaResult.latitude).not.toBeNull();
    expect(areaResult.longitude).not.toBeNull();

    const forestResult = await geocoder.geocodeForest("Belanglo State Forest", "South Coast");

    expect(forestResult.provider).toBe("OSM_NOMINATIM");
    expect(forestResult.latitude).not.toBeNull();
    expect(forestResult.longitude).not.toBeNull();

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
  });
});
