/**
 * Unit tests for the South Australia (SA) state provider
 */

import { describe, expect, it, vi } from "vitest";
import { SouthAustraliaStateProvider } from "../../pipeline/state-providers/sa/forest-provider.js";
import AdmZip from "adm-zip";

// ---------------------------------------------------------------------------
// Build mock ZIP containing SA GeoJSON
// ---------------------------------------------------------------------------

const buildSaGeoJsonZip = (
  features: Array<{
    name: string;
    restype: string;
    coords?: [number, number][];
  }>
): Buffer => {
  const geojsonFeatures = features.map((f) => ({
    type: "Feature",
    properties: {
      RESNAME: f.name,
      RESNAMETYP: `${f.name} (${f.restype})`,
      RESTYPE: f.restype,
      PARK_ID: 1,
      RESCODE: 1,
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        f.coords ?? [
          [138.6, -35.0],
          [138.7, -35.0],
          [138.7, -34.9],
          [138.6, -34.9],
          [138.6, -35.0],
        ],
      ],
    },
  }));

  const geojson = JSON.stringify({
    type: "FeatureCollection",
    features: geojsonFeatures,
  });

  const zip = new AdmZip();
  zip.addFile("CONSERVATION_NpwsaReserves_GDA2020.geojson", Buffer.from(geojson));
  return zip.toBuffer();
};

const buildBomResponse = (fireDanger = "No Rating") => ({
  features: [
    {
      attributes: {
        DIST_NAME: "Adelaide Metropolitan",
        STATE_CODE: "SA",
        FireDanger: fireDanger,
        Forecast_Period: 1,
        Start_Time: new Date().toISOString(),
      },
      geometry: {
        rings: [
          [
            [138.0, -35.5],
            [139.5, -35.5],
            [139.5, -34.5],
            [138.0, -34.5],
            [138.0, -35.5],
          ],
        ],
      },
    },
  ],
});

const buildMockFetchForSa = (
  features: Array<{ name: string; restype: string }>,
  fireDanger = "No Rating"
): typeof fetch => {
  const zipBuffer = buildSaGeoJsonZip(features);

  return vi.fn().mockImplementation((url: string) => {
    const urlStr = String(url);

    if (urlStr.includes("waterconnect.sa.gov.au")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength),
      });
    }

    if (urlStr.includes("services1.arcgis.com") && urlStr.includes("Fire_Districts")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => buildBomResponse(fireDanger),
      });
    }

    return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
  }) as unknown as typeof fetch;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SouthAustraliaStateProvider", () => {
  it("returns SA state code on all points", async () => {
    const fetchImpl = buildMockFetchForSa([
      { name: "Peebinga", restype: "CP" },
      { name: "Onkaparinga Hills", restype: "NP" },
    ]);
    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.every((p) => p.state === "SA")).toBe(true);
  });

  it("maps NOT_BANNED when fire danger is No Rating", async () => {
    const fetchImpl = buildMockFetchForSa(
      [{ name: "Flinders Chase NP", restype: "NP" }],
      "No Rating"
    );
    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("NOT_BANNED");
    expect(point?.facilities?.["campfireAllowed"]).toBe(true);
  });

  it("maps BANNED when fire danger is Extreme", async () => {
    const fetchImpl = buildMockFetchForSa(
      [{ name: "Coorong NP", restype: "NP" }],
      "Extreme"
    );
    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("BANNED");
    expect(point?.facilities?.["campfireAllowed"]).toBe(false);
  });

  it("maps UNKNOWN when fire danger is Very High", async () => {
    const fetchImpl = buildMockFetchForSa(
      [{ name: "Innamincka RP", restype: "RP" }],
      "Very High"
    );
    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("UNKNOWN");
    expect(point?.facilities?.["campfireAllowed"]).toBeNull();
  });

  it("filters out non-included reserve types (WA type)", async () => {
    const fetchImpl = buildMockFetchForSa([
      { name: "Some Wilderness Area", restype: "WA" },
      { name: "National Park", restype: "NP" },
    ]);
    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    // WA type should be excluded, only NP included
    expect(result.points.length).toBe(1);
    expect(result.points[0]?.forestName).toContain("National Park");
  });

  it("includes CFS warning in all results", async () => {
    const fetchImpl = buildMockFetchForSa([{ name: "Coorong", restype: "NP" }]);
    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.warnings.some((w) => w.includes("CFS"))).toBe(true);
  });

  it("handles waterconnect fetch error gracefully", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes("waterconnect.sa.gov.au")) {
        return Promise.reject(new Error("Connection refused"));
      }
      if (urlStr.includes("services1.arcgis.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => buildBomResponse(),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof fetch;

    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("waterconnect") || w.includes("Connection refused"))).toBe(true);
  });

  it("handles HTTP error from waterconnect gracefully", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes("waterconnect.sa.gov.au")) {
        return Promise.resolve({ ok: false, status: 503 });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => buildBomResponse() });
    }) as unknown as typeof fetch;

    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("503") || w.includes("waterconnect"))).toBe(true);
  });

  it("sets stateCode and stateName correctly", () => {
    const provider = new SouthAustraliaStateProvider();
    expect(provider.stateCode).toBe("SA");
    expect(provider.stateName).toBe("South Australia");
  });

  it("computes centroid from polygon coordinates", async () => {
    const fetchImpl = buildMockFetchForSa([
      {
        name: "Flinders Chase",
        restype: "NP",
      },
    ]);
    const provider = new SouthAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.latitude).not.toBeNull();
    expect(point?.longitude).not.toBeNull();
    // Centroid of the test polygon: lat ~= mean(-35, -35, -34.9, -34.9, -35) = -34.96
    expect(point?.latitude).toBeCloseTo(-34.96, 0);
  });
});
