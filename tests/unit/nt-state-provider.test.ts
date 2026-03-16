/**
 * Unit tests for the Northern Territory (NT) state provider
 */

import { describe, expect, it, vi } from "vitest";
import { NorthernTerritoryStateProvider } from "../../pipeline/state-providers/nt/forest-provider.js";

const buildBomResponse = (fireDanger = "No Rating") => ({
  features: [
    {
      attributes: {
        DIST_NAME: "Central Australia",
        STATE_CODE: "NT",
        FireDanger: fireDanger,
        Forecast_Period: 1,
        Start_Time: new Date().toISOString(),
      },
      geometry: {
        rings: [
          [
            [130.0, -25.0],
            [135.0, -25.0],
            [135.0, -12.0],
            [130.0, -12.0],
            [130.0, -25.0],
          ],
        ],
      },
    },
  ],
});

const buildOsmResponse = (
  campgrounds: Array<{ name: string; lat: number; lon: number }>
) => ({
  elements: campgrounds.map((cg, i) => ({
    id: i + 1,
    type: "node",
    lat: cg.lat,
    lon: cg.lon,
    tags: { name: cg.name, tourism: "camp_site" },
  })),
});

const buildMockFetch = (
  campgrounds: Array<{ name: string; lat: number; lon: number }>,
  fireDanger = "No Rating"
): typeof fetch => {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = String(url);

    if (urlStr.includes("overpass-api.de")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => buildOsmResponse(campgrounds),
      });
    }

    if (urlStr.includes("services1.arcgis.com") && urlStr.includes("Fire_Districts")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => buildBomResponse(fireDanger),
      });
    }

    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }) as unknown as typeof fetch;
};

describe("NorthernTerritoryStateProvider", () => {
  it("returns NT state code on all points", async () => {
    const fetchImpl = buildMockFetch([
      { name: "Ormiston Gorge Campground", lat: -23.6, lon: 132.7 },
      { name: "Glen Helen Campground", lat: -23.7, lon: 132.6 },
    ]);
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.every((p) => p.state === "NT")).toBe(true);
  });

  it("maps NOT_BANNED when fire danger is No Rating", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Ormiston Gorge", lat: -23.6, lon: 132.7 }],
      "No Rating"
    );
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("NOT_BANNED");
    expect(point?.facilities?.campfireAllowed).toBe(true);
  });

  it("maps BANNED when fire danger is Catastrophic", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Glen Helen", lat: -23.7, lon: 132.6 }],
      "Catastrophic"
    );
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("BANNED");
    expect(point?.facilities?.campfireAllowed).toBe(false);
  });

  it("maps UNKNOWN for Very High fire danger", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Nitmiluk Campground", lat: -14.3, lon: 132.5 }],
      "Very High"
    );
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("UNKNOWN");
    expect(point?.facilities?.campfireAllowed).toBeNull();
  });

  it("includes SecureNT warning in all results", async () => {
    const fetchImpl = buildMockFetch([
      { name: "Test Camp", lat: -12.0, lon: 131.0 },
    ]);
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.warnings.some((w) => w.includes("securent.nt.gov.au"))).toBe(true);
  });

  it("handles OSM 429 rate limit gracefully", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("overpass-api.de")) {
        return Promise.resolve({ ok: false, status: 429 });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => buildBomResponse(),
      });
    }) as unknown as typeof fetch;
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("429") || w.includes("rate limited"))).toBe(true);
  });

  it("handles OSM fetch error gracefully", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("overpass-api.de")) {
        return Promise.reject(new Error("Timeout"));
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => buildBomResponse() });
    }) as unknown as typeof fetch;
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Timeout") || w.includes("OSM"))).toBe(true);
  });

  it("sets stateCode and stateName correctly", () => {
    const provider = new NorthernTerritoryStateProvider();
    expect(provider.stateCode).toBe("NT");
    expect(provider.stateName).toBe("Northern Territory");
  });

  it("includes latitude and longitude on each point", async () => {
    const fetchImpl = buildMockFetch([
      { name: "Redbank Gorge Campground", lat: -23.59, lon: 132.51 },
    ]);
    const provider = new NorthernTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.latitude).toBeCloseTo(-23.59);
    expect(point?.longitude).toBeCloseTo(132.51);
  });
});
