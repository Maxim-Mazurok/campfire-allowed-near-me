/**
 * Unit tests for the Victoria (VIC) state provider
 *
 * Tests cover:
 * - CFA RSS fire ban parsing (YES / NO / RESTRICTIONS MAY APPLY)
 * - DataVic campsites feature processing (coordinates, BBQ fields)
 * - BOM district lookup integration (ban status via district name match)
 * - Network errors → empty results + warnings, not throws
 * - State code and source fields correctly set to VIC
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchCfaFireBans } from "../../pipeline/state-providers/vic/fire-ban-provider.js";
import { VictoriaStateProvider } from "../../pipeline/state-providers/vic/forest-provider.js";
import { BomFireDistrictService } from "../../pipeline/state-providers/bom-fire-districts.js";

// ---------------------------------------------------------------------------
// CFA RSS feed test fixtures
// ---------------------------------------------------------------------------

const buildCfaRss = (districts: Array<{ name: string; ban: string; fdr?: string }>) => {
  const banLines = districts.map((d) => `${d.name}: ${d.ban}`).join("&#10;");
  const fdrLines = districts
    .filter((d) => d.fdr)
    .map((d) => `${d.name}: ${d.fdr}`)
    .join("&#10;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Today's Fire Danger Rating Forecast</title>
      <description><![CDATA[Total Fire Ban
${districts.map((d) => `${d.name}: ${d.ban}`).join("\n")}
Fire Danger Rating
${districts
  .filter((d) => d.fdr)
  .map((d) => `${d.name}: ${d.fdr}`)
  .join("\n")}
]]></description>
    </item>
  </channel>
</rss>`;
};

const mockFetch = (responseText: string, status = 200): typeof fetch => {
  return vi.fn().mockResolvedValue({
    ok: status === 200,
    status,
    text: async () => responseText,
    json: async () => JSON.parse(responseText),
  }) as unknown as typeof fetch;
};

// ---------------------------------------------------------------------------
// CFA fire ban provider tests
// ---------------------------------------------------------------------------

describe("fetchCfaFireBans", () => {
  it("parses NO (not banned) status for a district", async () => {
    const xml = buildCfaRss([
      { name: "Central", ban: "NO - RESTRICTIONS MAY APPLY", fdr: "High" },
    ]);
    const result = await fetchCfaFireBans(mockFetch(xml));
    const central = result.districts.find((d) => d.name === "Central");
    expect(central?.banStatus).toBe("NOT_BANNED");
  });

  it("parses YES (banned) status for a district", async () => {
    const xml = buildCfaRss([{ name: "Mallee", ban: "YES", fdr: "Extreme" }]);
    const result = await fetchCfaFireBans(mockFetch(xml));
    const mallee = result.districts.find((d) => d.name === "Mallee");
    expect(mallee?.banStatus).toBe("BANNED");
  });

  it("returns all 9 VIC districts even when some are missing from feed", async () => {
    const xml = buildCfaRss([{ name: "Central", ban: "NO - RESTRICTIONS MAY APPLY" }]);
    const result = await fetchCfaFireBans(mockFetch(xml));
    expect(result.districts).toHaveLength(9);
    const missing = result.districts.find((d) => d.name === "Mallee");
    expect(missing?.banStatus).toBe("UNKNOWN");
  });

  it("handles HTTP error gracefully with warning", async () => {
    const result = await fetchCfaFireBans(mockFetch("", 503));
    expect(result.districts).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("503"))).toBe(true);
  });

  it("handles network errors gracefully", async () => {
    const failFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const result = await fetchCfaFireBans(failFetch);
    expect(result.warnings.some((w) => w.includes("ECONNREFUSED"))).toBe(true);
    expect(result.districts).toHaveLength(0);
  });

  it("captures fire danger rating when present", async () => {
    const xml = buildCfaRss([
      { name: "East Gippsland", ban: "NO - RESTRICTIONS MAY APPLY", fdr: "Severe" },
    ]);
    const result = await fetchCfaFireBans(mockFetch(xml));
    const eg = result.districts.find((d) => d.name === "East Gippsland");
    expect(eg?.fireDangerRating).toBe("Severe");
  });
});

// ---------------------------------------------------------------------------
// VictoriaStateProvider integration tests
// ---------------------------------------------------------------------------

const CAMPSITES_RESPONSE = JSON.stringify({
  features: [
    {
      attributes: {
        NAME: "Howqua Hills Historic Area",
        LATITUDE: -37.143,
        LONGITUDE: 146.223,
        SITE_CLASS: "State Forest",
        DIS_ACCESS: null,
        ACCESS_DSC: "2WD",
        CAMPING_C: "Campfires permitted in designated areas",
        CLOS_STAT: null,
        CLOS_DESC: null,
        MAINTAINED_BY: "DEECA",
        BBQ_WOOD: "Y",
        BBQ_PIT: "N",
        BBQ_GAS: "N",
        BBQ_ELEC: "N",
      },
    },
    {
      attributes: {
        NAME: "No Coordinates Camp",
        LATITUDE: null,
        LONGITUDE: null,
        SITE_CLASS: null,
        DIS_ACCESS: null,
        ACCESS_DSC: null,
        CAMPING_C: null,
        CLOS_STAT: null,
        CLOS_DESC: null,
        MAINTAINED_BY: null,
        BBQ_WOOD: null,
        BBQ_PIT: null,
        BBQ_GAS: null,
        BBQ_ELEC: null,
      },
    },
  ],
});

const buildMockFetchForVic = (
  cfa_xml: string,
  campsites = CAMPSITES_RESPONSE,
  bomDistricts?: Record<string, unknown>
): typeof fetch => {
  return vi.fn().mockImplementation((url: string) => {
    const urlStr = String(url);
    if (urlStr.includes("cfa.vic.gov.au")) {
      return Promise.resolve({ ok: true, status: 200, text: async () => cfa_xml });
    }
    if (urlStr.includes("services6.arcgis.com") && urlStr.includes("Campsites_and_Picnic_Grounds")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(campsites) });
    }
    if (urlStr.includes("services1.arcgis.com") && urlStr.includes("Fire_Districts")) {
      const mockBom = bomDistricts ?? {
        features: [
          {
            attributes: {
              DIST_NAME: "North East",
              STATE_CODE: "VIC",
              FireDanger: "High",
              Forecast_Period: 1,
              Start_Time: new Date().toISOString(),
            },
            geometry: {
              rings: [
                [
                  [145.0, -37.5],
                  [147.5, -37.5],
                  [147.5, -36.0],
                  [145.0, -36.0],
                  [145.0, -37.5],
                ],
              ],
            },
          },
        ],
      };
      return Promise.resolve({ ok: true, status: 200, json: async () => mockBom });
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  }) as unknown as typeof fetch;
};

describe("VictoriaStateProvider", () => {
  it("returns VIC state code on all points", async () => {
    const cfaXml = buildCfaRss([
      { name: "North East", ban: "NO - RESTRICTIONS MAY APPLY", fdr: "High" },
    ]);
    const fetchImpl = buildMockFetchForVic(cfaXml);
    const provider = new VictoriaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const validPoints = result.points.filter(
      (p) => p.latitude !== null && p.longitude !== null
    );
    expect(validPoints.length).toBeGreaterThan(0);
    expect(validPoints.every((p) => p.state === "VIC")).toBe(true);
  });

  it("maps NOT_BANNED for a district with no TFB", async () => {
    const cfaXml = buildCfaRss([
      { name: "North East", ban: "NO - RESTRICTIONS MAY APPLY", fdr: "High" },
    ]);
    const fetchImpl = buildMockFetchForVic(cfaXml);
    const provider = new VictoriaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const howqua = result.points.find((p) =>
      p.forestName.toLowerCase().includes("howqua")
    );
    expect(howqua).toBeDefined();
    expect(howqua?.totalFireBanStatus).toBe("NOT_BANNED");
  });

  it("maps BANNED when CFA district has TFB declared", async () => {
    const cfaXml = buildCfaRss([{ name: "North East", ban: "YES", fdr: "Extreme" }]);
    const fetchImpl = buildMockFetchForVic(cfaXml);
    const provider = new VictoriaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const howqua = result.points.find((p) =>
      p.forestName.toLowerCase().includes("howqua")
    );
    expect(howqua?.totalFireBanStatus).toBe("BANNED");
  });

  it("skips entries missing latitude/longitude", async () => {
    const cfaXml = buildCfaRss([
      { name: "North East", ban: "NO - RESTRICTIONS MAY APPLY" },
    ]);
    const fetchImpl = buildMockFetchForVic(cfaXml);
    const provider = new VictoriaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points.every((p) => p.latitude !== null)).toBe(true);
    expect(result.points.every((p) => p.longitude !== null)).toBe(true);
  });

  it("records bbqWood facility from MAINTAINED_BY attribute", async () => {
    const cfaXml = buildCfaRss([
      { name: "North East", ban: "NO - RESTRICTIONS MAY APPLY" },
    ]);
    const fetchImpl = buildMockFetchForVic(cfaXml);
    const provider = new VictoriaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const howqua = result.points.find((p) =>
      p.forestName.toLowerCase().includes("howqua")
    );
    expect(howqua?.facilities?.["bbqWood"]).toBe(true);
  });

  it("handles campsites fetch error gracefully", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes("services6.arcgis.com")) {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => "" });
    }) as unknown as typeof fetch;

    const provider = new VictoriaStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("Network error"))).toBe(true);
  });

  it("sets stateCode and stateName correctly", () => {
    const provider = new VictoriaStateProvider();
    expect(provider.stateCode).toBe("VIC");
    expect(provider.stateName).toBe("Victoria");
  });
});
