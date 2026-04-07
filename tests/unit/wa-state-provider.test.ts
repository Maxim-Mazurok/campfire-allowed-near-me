/**
 * Unit tests for the Western Australia (WA) state provider
 */

import { describe, expect, it, vi } from "vitest";
import { WesternAustraliaStateProvider } from "../../pipeline/state-providers/wa/forest-provider.js";
import {
  parseCampfireStatus,
  fetchWaCampgrounds,
} from "../../pipeline/state-providers/wa/ratis-scraper.js";
import {
  buildOsmIndex,
  matchCampgroundToOsm,
} from "../../pipeline/state-providers/wa/osm-geocoder.js";

// ---------------------------------------------------------------------------
// Helpers: RATIS page HTML builder
// ---------------------------------------------------------------------------

const buildRatisPage = (
  rows: Array<{ name: string; park: string; status: string }>,
  currentPage = 1,
  totalPages = 1
): string => {
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td>${r.name}</td><td>${r.park}</td><td>${r.status}</td><td></td></tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head><title>Campfire Status</title></head>
<body>
<form method="post" action="">
<input type="hidden" id="__VIEWSTATE" value="abc123" />
<input type="hidden" id="__VIEWSTATEGENERATOR" value="XYZ" />
<input type="hidden" id="__EVENTVALIDATION" value="def456" />
<table>
<tr><th>Campground</th><th>Park</th><th>Campfire status</th><th>Firewood</th></tr>
${rowsHtml}
</table>
<div id="GridView1_GridViewPager1_LabelNumberOfPages">of ${totalPages}</div>
<input name="GridView1$ctl23$GridViewPager1$TextBoxPage" type="text" value="${currentPage}" />
<input name="GridView1$ctl23$GridViewPager1$DropDownListPageSize" />
<input name="GridView1$ctl23$GridViewPager1$ImageButtonNext.x" type="image" />
<input name="GridView1$ctl23$GridViewPager1$ImageButtonNext.y" type="image" />
</form>
</body>
</html>`;
};

const buildBomResponse = (fireDanger = "No Rating") => ({
  features: [
    {
      attributes: {
        DIST_NAME: "Swan Coastal",
        STATE_CODE: "WA",
        FireDanger: fireDanger,
        Forecast_Period: 1,
        Start_Time: new Date().toISOString(),
      },
      geometry: {
        rings: [
          [
            [115.5, -32.5],
            [116.5, -32.5],
            [116.5, -31.5],
            [115.5, -31.5],
            [115.5, -32.5],
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

// ---------------------------------------------------------------------------
// Unit tests: parseCampfireStatus
// ---------------------------------------------------------------------------

describe("parseCampfireStatus", () => {
  it("maps 'Campfires permitted' → PERMITTED", () => {
    expect(parseCampfireStatus("Campfires permitted")).toBe("PERMITTED");
  });
  it("maps 'No campfires' → NO_CAMPFIRES", () => {
    expect(parseCampfireStatus("No campfires")).toBe("NO_CAMPFIRES");
  });
  it("maps 'Campfire ban' → BANNED", () => {
    expect(parseCampfireStatus("Campfire ban")).toBe("BANNED");
  });
  it("maps unknown text → UNKNOWN", () => {
    expect(parseCampfireStatus("TBD")).toBe("UNKNOWN");
  });
  it("is case-insensitive for permitted", () => {
    expect(parseCampfireStatus("CAMPFIRES PERMITTED")).toBe("PERMITTED");
  });
});

// ---------------------------------------------------------------------------
// Unit tests: OSM name matching
// ---------------------------------------------------------------------------

describe("matchCampgroundToOsm", () => {
  const osmCampgrounds = [
    { name: "Baden Powell Camp Site", latitude: -31.9, longitude: 116.1, osmId: 1 },
    { name: "Crystal Springs Campground", latitude: -34.6, longitude: 116.8, osmId: 2 },
    { name: "Walyunga Campground", latitude: -31.7, longitude: 116.1, osmId: 3 },
  ];

  it("matches exactly by normalised name", () => {
    const index = buildOsmIndex(osmCampgrounds);
    const m = matchCampgroundToOsm("Walyunga Campground", index);
    expect(m).not.toBeNull();
    expect(m?.latitude).toBeCloseTo(-31.7);
  });

  it("matches with suffix stripping (camp site → camp)", () => {
    const index = buildOsmIndex(osmCampgrounds);
    const m = matchCampgroundToOsm("Baden Powell", index);
    expect(m).not.toBeNull();
    expect(m?.latitude).toBeCloseTo(-31.9);
  });

  it("matches with containment", () => {
    const index = buildOsmIndex(osmCampgrounds);
    const m = matchCampgroundToOsm("Crystal Springs", index);
    expect(m).not.toBeNull();
    expect(m?.latitude).toBeCloseTo(-34.6);
  });

  it("returns null for no match", () => {
    const index = buildOsmIndex(osmCampgrounds);
    expect(matchCampgroundToOsm("Nonexistent Place XYZ", index)).toBeNull();
  });

  it("buildOsmIndex creates correct map", () => {
    const index = buildOsmIndex(osmCampgrounds);
    expect(index.size).toBe(3);
    // Normalised key for "Baden Powell Camp Site"
    expect(index.has("baden powell camp site")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: RATIS scraper (mocked fetch)
// ---------------------------------------------------------------------------

describe("fetchWaCampgrounds", () => {
  it("parses single-page RATIS result", async () => {
    const html = buildRatisPage([
      { name: "Yalgorup", park: "Yalgorup National Park", status: "Campfires permitted" },
      { name: "Baden Powell", park: "Lane Poole Reserve", status: "No campfires" },
    ], 1, 1);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    }) as unknown as typeof fetch;

    const { campgrounds, warnings } = await fetchWaCampgrounds(fetchImpl);
    expect(campgrounds).toHaveLength(2);
    expect(campgrounds[0]?.name).toBe("Yalgorup");
    expect(campgrounds[0]?.campfireStatus).toBe("PERMITTED");
    expect(campgrounds[1]?.campfireStatus).toBe("NO_CAMPFIRES");
    expect(warnings).toHaveLength(0);
  });

  it("paginates across multiple pages", async () => {
    const page1 = buildRatisPage(
      [{ name: "Campground A", park: "Park A", status: "Campfires permitted" }],
      1, 2
    );
    const page2 = buildRatisPage(
      [{ name: "Campground B", park: "Park B", status: "No campfires" }],
      2, 2
    );

    let callCount = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => (callCount === 1 ? page1 : page2),
      });
    }) as unknown as typeof fetch;

    const { campgrounds } = await fetchWaCampgrounds(fetchImpl);
    expect(campgrounds).toHaveLength(2);
    expect(campgrounds.map((c) => c.name)).toEqual(["Campground A", "Campground B"]);
  });

  it("handles fetch error gracefully", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
    const { campgrounds, warnings } = await fetchWaCampgrounds(fetchImpl);
    expect(campgrounds).toHaveLength(0);
    expect(warnings.some((w) => w.includes("Network error") || w.includes("campfire status"))).toBe(true);
  });

  it("handles HTTP error gracefully", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "",
    }) as unknown as typeof fetch;
    const { campgrounds, warnings } = await fetchWaCampgrounds(fetchImpl);
    expect(campgrounds).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: WesternAustraliaStateProvider
// ---------------------------------------------------------------------------

describe("WesternAustraliaStateProvider", () => {
  const buildMockFetch = (
    campgrounds: Array<{ name: string; park: string; status: string }>,
    osmCampgrounds: Array<{ name: string; lat: number; lon: number }> = [],
    fireDanger = "No Rating"
  ): typeof fetch => {
    const ratisHtml = buildRatisPage(campgrounds, 1, 1);

    return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("ratisweb.dpaw.wa.gov.au")) {
        return Promise.resolve({ ok: true, status: 200, text: async () => ratisHtml });
      }

      if (urlStr.includes("overpass-api.de")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => buildOsmResponse(osmCampgrounds),
        });
      }

      if (urlStr.includes("services1.arcgis.com") && urlStr.includes("Fire_Districts")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => buildBomResponse(fireDanger),
        });
      }

      // DBCA ArcGIS fallback
      if (urlStr.includes("slip.wa.gov.au")) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({
            features: [{
              attributes: { leg_name: "Test Park", leg_purpose: "National Park" },
              geometry: { rings: [[[115.5, -32.0], [116.0, -32.0], [116.0, -31.5], [115.5, -31.5], [115.5, -32.0]]] },
            }],
          }),
        });
      }

      return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
    }) as unknown as typeof fetch;
  };

  it("returns WA state code on all points", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Yalgorup", park: "Yalgorup National Park", status: "Campfires permitted" }],
      [{ name: "Yalgorup", lat: -32.7, lon: 115.6 }]
    );
    const provider = new WesternAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.every((p) => p.state === "WA")).toBe(true);
  });

  it("maps PERMITTED campfire status to NOT_BANNED", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Yalgorup", park: "Yalgorup NP", status: "Campfires permitted" }],
      [{ name: "Yalgorup", lat: -32.7, lon: 115.6 }]
    );
    const provider = new WesternAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("NOT_BANNED");
    expect(point?.facilities?.campfireAllowed).toBe(true);
  });

  it("maps NO_CAMPFIRES status to BANNED", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Baden Powell", park: "Lane Poole Reserve", status: "No campfires" }],
      [{ name: "Baden Powell Camp Site", lat: -31.9, lon: 116.1 }]
    );
    const provider = new WesternAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points[0];
    expect(point?.totalFireBanStatus).toBe("BANNED");
    expect(point?.facilities?.campfireAllowed).toBe(false);
  });

  it("falls back to DBCA ArcGIS for unmatched campgrounds", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Remote Campground", park: "Remote National Park", status: "Campfires permitted" }],
      [] // No OSM matches
    );
    const provider = new WesternAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    // Should use DBCA fallback and still produce a point
    expect(result.points.length).toBe(1);
  });

  it("includes DFES warning in all results", async () => {
    const fetchImpl = buildMockFetch(
      [{ name: "Test Camp", park: "Test Park", status: "Campfires permitted" }],
      [{ name: "Test Camp", lat: -32.0, lon: 116.0 }]
    );
    const provider = new WesternAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.warnings.some((w) => w.includes("DFES") || w.includes("dfes.wa.gov.au"))).toBe(true);
  });

  it("handles RATIS fetch error gracefully", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes("ratisweb.dpaw.wa.gov.au")) {
        return Promise.reject(new Error("Connection refused"));
      }
      if (urlStr.includes("services1.arcgis.com")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => buildBomResponse() });
      }
      if (urlStr.includes("overpass-api.de")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ elements: [] }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }) as unknown as typeof fetch;

    const provider = new WesternAustraliaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Connection refused") || w.includes("campfire status") || w.includes("RATIS"))).toBe(true);
  });

  it("sets stateCode and stateName correctly", () => {
    const provider = new WesternAustraliaStateProvider();
    expect(provider.stateCode).toBe("WA");
    expect(provider.stateName).toBe("Western Australia");
  });
});
