import { describe, expect, it } from "vitest";
import { TasmaniaStateProvider } from "../../pipeline/state-providers/tas/index.js";
import { fetchTasFireBans } from "../../pipeline/state-providers/tas/fire-ban-provider.js";

// ---------------------------------------------------------------------------
// Mock ArcGIS response helpers
// ---------------------------------------------------------------------------

const CAMPGROUND_URL_PATTERN = "PWSPublic/MapServer/20";
const BAN_AREA_URL_PATTERN = "PWSPublic/MapServer/18";
const TFS_URL_PATTERN = "colFireBan";

const makeCampgroundFeature = (
  name: string,
  cfRules: string | null,
  x: number,
  y: number
) => ({
  attributes: { NAME: name, CF_ALLOWED: null, CF_RULES: cfRules },
  geometry: { x, y },
});

const makeBanAreaRings = (lat: number, lng: number, size = 0.1) => ({
  geometry: {
    rings: [
      [
        [lng - size, lat - size],
        [lng + size, lat - size],
        [lng + size, lat + size],
        [lng - size, lat + size],
        [lng - size, lat - size],
      ],
    ],
  },
});

const buildMockFetch = (options: {
  campgrounds: ReturnType<typeof makeCampgroundFeature>[];
  banAreaPolygons: ReturnType<typeof makeBanAreaRings>[];
  tfbPageText?: string;
}): typeof fetch => {
  return async (input) => {
    const url = String(input);

    if (url.includes(CAMPGROUND_URL_PATTERN)) {
      return new Response(
        JSON.stringify({ features: options.campgrounds }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.includes(BAN_AREA_URL_PATTERN)) {
      return new Response(
        JSON.stringify({ features: options.banAreaPolygons }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url.includes(TFS_URL_PATTERN)) {
      return new Response(
        options.tfbPageText ?? "<html><body>No Total Fire Ban in force today.</body></html>",
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }

    throw new Error(`Unexpected URL in mock: ${url}`);
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TasmaniaStateProvider", () => {
  it("marks campgrounds with CF_RULES 'Fuel Stove Only' as BANNED", async () => {
    const fetchImpl = buildMockFetch({
      campgrounds: [
        makeCampgroundFeature("Test Campground A", "Fuel Stove Only", 146.0, -42.0),
      ],
      banAreaPolygons: [],
    });

    const provider = new TasmaniaStateProvider(fetchImpl);
    const { points, warnings } = await provider.fetchPoints();

    expect(points).toHaveLength(1);
    expect(points[0]!.totalFireBanStatus).toBe("BANNED");
    expect(points[0]!.totalFireBanStatusText).toMatch(/fuel stove only/i);
    expect(warnings.some((w) => w.toLowerCase().includes("error"))).toBe(false);
  });

  it("marks campgrounds with 'Fires permitted in BYO Fire Pots' as NOT_BANNED", async () => {
    const fetchImpl = buildMockFetch({
      campgrounds: [
        makeCampgroundFeature("Test Campground B", "Fires permitted in BYO Fire Pots", 145.5, -41.5),
      ],
      banAreaPolygons: [],
    });

    const provider = new TasmaniaStateProvider(fetchImpl);
    const { points } = await provider.fetchPoints();

    expect(points[0]!.totalFireBanStatus).toBe("NOT_BANNED");
  });

  it("overrides NOT_BANNED with BANNED when campground is in a real-time ban area", async () => {
    // Campground at (-42.0, 146.0)
    const campgroundLat = -42.0;
    const campgroundLng = 146.0;

    const fetchImpl = buildMockFetch({
      campgrounds: [
        makeCampgroundFeature("Affected Campground", "Campfires Permitted (use provided fire pits where available)", campgroundLng, campgroundLat),
      ],
      // Ban area polygon contains the campground
      banAreaPolygons: [makeBanAreaRings(campgroundLat, campgroundLng, 1.0)],
    });

    const provider = new TasmaniaStateProvider(fetchImpl);
    const { points } = await provider.fetchPoints();

    expect(points[0]!.totalFireBanStatus).toBe("BANNED");
    expect(points[0]!.totalFireBanStatusText).toMatch(/campfire ban in force/i);
  });

  it("marks campground as BANNED when TFS total fire ban is active", async () => {
    const fetchImpl = buildMockFetch({
      campgrounds: [
        makeCampgroundFeature("TFB Affected", "Fires permitted in provided fire pits/structures", 145.0, -41.0),
      ],
      banAreaPolygons: [],
      tfbPageText: "<html><body>Total Fire Ban is currently in force statewide.</body></html>",
    });

    const provider = new TasmaniaStateProvider(fetchImpl);
    const { points } = await provider.fetchPoints();

    expect(points[0]!.totalFireBanStatus).toBe("BANNED");
    expect(points[0]!.totalFireBanStatusText).toMatch(/total fire ban declared/i);
  });

  it("returns empty results (with warning) when campground fetch fails", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes(CAMPGROUND_URL_PATTERN)) {
        throw new Error("Network error");
      }
      return new Response("ok", { status: 200 });
    };

    const provider = new TasmaniaStateProvider(fetchImpl);
    const { points, warnings } = await provider.fetchPoints();

    expect(points).toHaveLength(0);
    expect(warnings.some((w) => w.includes("campground"))).toBe(true);
  });

  it("sets correct state code and source fields", async () => {
    const fetchImpl = buildMockFetch({
      campgrounds: [
        makeCampgroundFeature("Mt Field Campground", "Fires permitted in BYO Fire Pots", 146.7, -42.7),
      ],
      banAreaPolygons: [],
    });

    const provider = new TasmaniaStateProvider(fetchImpl);
    const { points } = await provider.fetchPoints();

    expect(points[0]!.state).toBe("TAS");
    expect(points[0]!.source).toContain("Tasmania");
    expect(points[0]!.latitude).toBe(-42.7);
    expect(points[0]!.longitude).toBe(146.7);
  });
});

// ---------------------------------------------------------------------------
// TAS fire ban scraper tests
// ---------------------------------------------------------------------------

describe("fetchTasFireBans", () => {
  it("detects no ban from TFS page text", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        "<html><body>No Total Fire Ban in force today. Have a nice day.</body></html>",
        { status: 200, headers: { "content-type": "text/html" } }
      );

    const result = await fetchTasFireBans(fetchImpl);
    expect(result.anyBanActive).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("detects active ban from TFS page text", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        "<html><body>Total fire ban is currently in force across Tasmania.</body></html>",
        { status: 200, headers: { "content-type": "text/html" } }
      );

    const result = await fetchTasFireBans(fetchImpl);
    expect(result.anyBanActive).toBe(true);
  });

  it("returns warning on network error", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("timeout");
    };
    const result = await fetchTasFireBans(fetchImpl);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.anyBanActive).toBe(false);
  });
});
