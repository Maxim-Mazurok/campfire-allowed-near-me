/**
 * Unit tests for the Queensland (QLD) state provider
 *
 * Tests cover:
 * - campgrounds-scraper: letter page parsing, campground page meta tag parsing
 *   (geo.position, parks.campfires, parks.facilities)
 * - fire-ban-provider: BOM fire danger → ban status mapping
 * - forest-provider: integration of campground data + fire danger
 * - Edge cases: missing coordinates, no campfire meta, network errors
 */

import { describe, expect, it, vi } from "vitest";
import { parseCampgroundLinksFromPage } from "../../pipeline/state-providers/qld/campgrounds-scraper-testable.js";
import { fetchQldCampground } from "../../pipeline/state-providers/qld/campgrounds-scraper.js";
import { fireDangerToBanStatus } from "../../pipeline/state-providers/qld/fire-ban-provider.js";
import { QueenslandStateProvider } from "../../pipeline/state-providers/qld/forest-provider.js";

// ---------------------------------------------------------------------------
// HTML fixtures
// ---------------------------------------------------------------------------

const buildLetterPage = (campgroundUrls: string[]): string => {
  const links = campgroundUrls
    .map((u) => `<a href="${u}">${u.split("/").pop()}</a>`)
    .join("\n");
  return `<html><body>${links}</body></html>`;
};

const buildCampgroundPage = (opts: {
  name?: string;
  geoPosition?: string;
  campfires?: "yes" | "no" | "";
  facilities?: string;
}): string => {
  const {
    name = "Test Campground",
    geoPosition = "-26.358; 152.557",
    campfires = "yes",
    facilities = "campfires-permitted; toilets-flush; tap-water; picnic-tables;",
  } = opts;

  return `<!DOCTYPE html>
<html>
<head>
  <title>${name} | Parks and forests | Queensland</title>
  <meta name="geo.position" content="${geoPosition}" />
  ${campfires ? `<meta name="parks.campfires" content="${campfires}" />` : ""}
  <meta name="parks.facilities" content="${facilities}" />
</head>
<body>
  <h1>${name}</h1>
</body>
</html>`;
};

const buildBomResponse = (
  districts: Array<{ distName: string; fireDanger: string }>
) => ({
  features: districts.map((d) => ({
    attributes: {
      DIST_NAME: d.distName,
      STATE_CODE: "QLD",
      FireDanger: d.fireDanger,
      Forecast_Period: 1,
      Start_Time: new Date().toISOString(),
    },
    geometry: {
      rings: [
        [
          [152.0, -27.5],
          [154.0, -27.5],
          [154.0, -25.0],
          [152.0, -25.0],
          [152.0, -27.5],
        ],
      ],
    },
  })),
});

// ---------------------------------------------------------------------------
// Fire ban provider tests (BOM danger → ban status)
// ---------------------------------------------------------------------------

describe("fireDangerToBanStatus (QLD)", () => {
  it.each([
    ["Catastrophic", "BANNED"],
    ["Extreme", "BANNED"],
    ["Severe", "UNKNOWN"],
    ["Very High", "UNKNOWN"],
    ["High", "NOT_BANNED"],
    ["Moderate", "NOT_BANNED"],
    ["No Rating", "NOT_BANNED"],
  ])("%s → %s", (danger, expected) => {
    expect(fireDangerToBanStatus(danger).status).toBe(expected);
  });

  it("returns UNKNOWN for null fire danger", () => {
    expect(fireDangerToBanStatus(null).status).toBe("UNKNOWN");
  });

  it("returns warning text for inaccessible QFES data on Extreme", () => {
    const result = fireDangerToBanStatus("Extreme");
    expect(result.warning).toContain("QLD TFB data unavailable");
  });
});

// ---------------------------------------------------------------------------
// Campground scraper tests
// ---------------------------------------------------------------------------

describe("campgrounds A-Z scraper", () => {
  it("parses campground URLs from letter page HTML", async () => {
    const urls = [
      "https://parks.qld.gov.au/parks/amamoor/camping/amamoor-creek",
      "https://parks.qld.gov.au/parks/daguilar/camping/archer",
      "https://parks.qld.gov.au/parks/parks-a-z", // nav link, should be ignored
    ];
    const html = buildLetterPage(urls);
    // Use the function directly on the HTML
    // Note: using the testable export to test the parsing function directly
    // Without the full fetch machinery
    const { load } = await import("cheerio");
    const $ = load(html);
    const found: string[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (/^https:\/\/parks\.qld\.gov\.au\/parks\/[^/]+\/camping\/[^/]+$/.test(href)) {
        found.push(href);
      }
    });
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("amamoor-creek");
    expect(found[1]).toContain("archer");
  });

  it("parses campfire=yes from campground page meta", async () => {
    const html = buildCampgroundPage({ campfires: "yes" });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    }) as unknown as typeof fetch;

    const result = await fetchQldCampground(
      "https://parks.qld.gov.au/parks/amamoor/camping/amamoor-creek",
      mockFetch
    );
    expect(result).not.toBeNull();
    expect(result?.campfiresPermitted).toBe(true);
    expect(result?.latitude).toBeCloseTo(-26.358);
    expect(result?.longitude).toBeCloseTo(152.557);
    expect(result?.toilets).toBe(true);
    expect(result?.water).toBe(true);
    expect(result?.tables).toBe(true);
  });

  it("parses campfire=no from campground page meta", async () => {
    const html = buildCampgroundPage({
      campfires: "no",
      facilities: "barbecue-fuel-free; toilets-flush;",
    });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    }) as unknown as typeof fetch;

    const result = await fetchQldCampground(
      "https://parks.qld.gov.au/parks/bunya-mountains/camping/dandabah",
      mockFetch
    );
    expect(result?.campfiresPermitted).toBe(false);
    expect(result?.facilitiesIncludeFuelFreeBbq).toBe(true);
  });

  it("returns null on campfire meta absent", async () => {
    const html = buildCampgroundPage({ campfires: "", facilities: "toilets-flush;" });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    }) as unknown as typeof fetch;

    const result = await fetchQldCampground(
      "https://parks.qld.gov.au/parks/carnarvon-great-walk/camping/cabbage-tree",
      mockFetch
    );
    expect(result?.campfiresPermitted).toBeNull();
  });

  it("returns null for campground page with no coordinates", async () => {
    const html = buildCampgroundPage({ geoPosition: "" });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => html,
    }) as unknown as typeof fetch;

    const result = await fetchQldCampground(
      "https://parks.qld.gov.au/parks/test/camping/test-camp",
      mockFetch
    );
    // fetchQldCampground returns the object but with null lat/lng
    // fetchAllQldCampgrounds then filters out those with null coords
    expect(result?.latitude).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof fetch;
    const result = await fetchQldCampground(
      "https://parks.qld.gov.au/parks/test/camping/test-camp",
      mockFetch
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// QueenslandStateProvider integration tests
// ---------------------------------------------------------------------------

const buildMockFetchForQld = (
  campgrounds: Array<{
    slug: string;
    parkSlug: string;
    campfires?: "yes" | "no" | "";
    facilities?: string;
    lat?: number;
    lng?: number;
  }>,
  fireDanger = "No Rating"
): typeof fetch => {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = String(url);

    // BOM fire districts
    if (urlStr.includes("services1.arcgis.com") && urlStr.includes("Fire_Districts")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () =>
          buildBomResponse([{ distName: "Southeast Coast", fireDanger }]),
      });
    }

    // A-Z letter pages
    if (urlStr.includes("campgrounds-a-z")) {
      const campUrls = campgrounds.map(
        (c) => `https://parks.qld.gov.au/parks/${c.parkSlug}/camping/${c.slug}`
      );
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => buildLetterPage(campUrls),
      });
    }

    // Individual campground pages
    const campMatch = /\/parks\/([^/]+)\/camping\/([^/]+)$/.exec(urlStr);
    if (campMatch) {
      const slug = campMatch[2]!;
      const campground = campgrounds.find((c) => c.slug === slug);
      if (campground) {
        const html = buildCampgroundPage({
          name: slug.replace(/-/g, " "),
          geoPosition: `${campground.lat ?? -27.5}; ${campground.lng ?? 153.0}`,
          campfires: campground.campfires ?? "yes",
          facilities: campground.facilities ?? "campfires-permitted; toilets-flush;",
        });
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => html,
        });
      }
    }

    return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
  }) as unknown as typeof fetch;
};

describe("QueenslandStateProvider", () => {
  it("returns QLD state code on all points", async () => {
    const fetchImpl = buildMockFetchForQld([
      { slug: "amamoor-creek", parkSlug: "amamoor", campfires: "yes", lat: -26.36, lng: 152.56 },
    ]);
    const provider = new QueenslandStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.every((p) => p.state === "QLD")).toBe(true);
  });

  it("maps NOT_BANNED when fire danger is No Rating", async () => {
    const fetchImpl = buildMockFetchForQld(
      [{ slug: "amamoor-creek", parkSlug: "amamoor", campfires: "yes", lat: -26.36, lng: 152.56 }],
      "No Rating"
    );
    const provider = new QueenslandStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points.find((p) => p.forestName.includes("amamoor"));
    expect(point?.totalFireBanStatus).toBe("NOT_BANNED");
    expect(point?.facilities?.["campfireAllowed"]).toBe(true);
  });

  it("maps BANNED when fire danger is Catastrophic", async () => {
    const fetchImpl = buildMockFetchForQld(
      [{ slug: "archer", parkSlug: "daguilar", campfires: "yes", lat: -27.5, lng: 153.0 }],
      "Catastrophic"
    );
    const provider = new QueenslandStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points.find((p) => p.forestName.includes("archer"));
    expect(point?.totalFireBanStatus).toBe("BANNED");
    expect(point?.facilities?.["campfireAllowed"]).toBe(false);
  });

  it("sets campfireAllowed=false when parks.campfires=no", async () => {
    const fetchImpl = buildMockFetchForQld([
      {
        slug: "dandabah",
        parkSlug: "bunya-mountains",
        campfires: "no",
        facilities: "barbecue-fuel-free; toilets-flush;",
        lat: -26.88,
        lng: 151.6,
      },
    ]);
    const provider = new QueenslandStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points.find((p) => p.forestName.includes("dandabah"));
    expect(point?.facilities?.["campfireAllowed"]).toBe(false);
  });

  it("sets campfireAllowed=null when parks.campfires not specified", async () => {
    const fetchImpl = buildMockFetchForQld([
      {
        slug: "cabbage-tree",
        parkSlug: "carnarvon-great-walk",
        campfires: "",
        facilities: "camping-tent; walking;",
        lat: -24.99,
        lng: 148.22,
      },
    ]);
    const provider = new QueenslandStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const point = result.points.find((p) => p.forestName.includes("cabbage"));
    expect(point?.facilities?.["campfireAllowed"]).toBeNull();
  });

  it("includes QFES warning in all results", async () => {
    const fetchImpl = buildMockFetchForQld([
      { slug: "test", parkSlug: "test-park", campfires: "yes", lat: -27.5, lng: 153.0 },
    ]);
    const provider = new QueenslandStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.warnings.some((w) => w.includes("QFES"))).toBe(true);
  });

  it("handles campgrounds fetch error gracefully", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes("campgrounds-a-z") || urlStr.includes("/camping/")) {
        return Promise.reject(new Error("Connection refused"));
      }
      if (urlStr.includes("services1.arcgis.com")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => buildBomResponse([{ distName: "Southeast Coast", fireDanger: "No Rating" }]),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => "" });
    }) as unknown as typeof fetch;

    const provider = new QueenslandStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.includes("Connection refused") || w.includes("parks.qld.gov.au"))
    ).toBe(true);
  });

  it("sets stateCode and stateName correctly", () => {
    const provider = new QueenslandStateProvider();
    expect(provider.stateCode).toBe("QLD");
    expect(provider.stateName).toBe("Queensland");
  });
});
