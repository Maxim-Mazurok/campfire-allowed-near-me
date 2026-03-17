/**
 * Unit tests for the Australian Capital Territory (ACT) state provider
 */

import { describe, expect, it, vi } from "vitest";
import { AustralianCapitalTerritoryStateProvider } from "../../pipeline/state-providers/act/forest-provider.js";

const buildRfsResponse = (tobanToday: string, ratingToday = "MODERATE") =>
  JSON.stringify([
    { areaId: "1", areaName: "Greater Sydney", ratingToday, tobanToday: "No" },
    { areaId: "8", areaName: "ACT", ratingToday, tobanToday },
    { areaId: "9", areaName: "Southern Ranges", ratingToday: "LOW", tobanToday: "No" },
  ]);

const buildMockFetch = (
  tobanToday: string,
  ratingToday = "MODERATE"
): typeof fetch => {
  return vi.fn().mockImplementation((url: string) => {
    if (String(url).includes("rfs.nsw.gov.au")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => buildRfsResponse(tobanToday, ratingToday),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  }) as unknown as typeof fetch;
};

describe("AustralianCapitalTerritoryStateProvider", () => {
  it("returns ACT state code on all points", async () => {
    const fetchImpl = buildMockFetch("No");
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.every((p) => p.state === "ACT")).toBe(true);
  });

  it("returns 6 campgrounds (static list)", async () => {
    const fetchImpl = buildMockFetch("No");
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(6);
  });

  it("maps NOT_BANNED when tobanToday is No", async () => {
    const fetchImpl = buildMockFetch("No");
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    // All campfire-allowed sites should be NOT_BANNED
    const campfireSites = result.points.filter(
      (p) => p.id !== "act-tidbinbilla"
    );
    expect(campfireSites.every((p) => p.totalFireBanStatus === "NOT_BANNED")).toBe(true);
  });

  it("maps BANNED when tobanToday is Yes", async () => {
    const fetchImpl = buildMockFetch("Yes");
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    // All campfire-allowed sites should be BANNED when TFB declared
    const campfireSites = result.points.filter(
      (p) => p.id !== "act-tidbinbilla"
    );
    expect(campfireSites.every((p) => p.totalFireBanStatus === "BANNED")).toBe(true);
  });

  it("Tidbinbilla always shows BANNED (no campfires normally)", async () => {
    const fetchImpl = buildMockFetch("No"); // No fire ban
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const tidbinbilla = result.points.find((p) => p.id === "act-tidbinbilla");
    expect(tidbinbilla?.totalFireBanStatus).toBe("BANNED");
    expect(tidbinbilla?.facilities?.campfireAllowed).toBe(false);
  });

  it("Cotter Campground and Namadgi sites have campfireAllowed when no TFB", async () => {
    const fetchImpl = buildMockFetch("No");
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    const cotter = result.points.find((p) => p.id === "act-cotter-campground");
    expect(cotter?.facilities?.campfireAllowed).toBe(true);
  });

  it("handles RFS fetch error gracefully", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error("Network error")
    ) as unknown as typeof fetch;
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    // Should still return 6 points (static data) but with UNKNOWN ban status
    expect(result.points).toHaveLength(6);
    expect(result.warnings.some((w) => w.includes("Network error") || w.includes("RFS"))).toBe(true);
  });

  it("handles HTTP error from RFS gracefully", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch;
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    expect(result.points).toHaveLength(6);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("sets stateCode and stateName correctly", () => {
    const provider = new AustralianCapitalTerritoryStateProvider();
    expect(provider.stateCode).toBe("ACT");
    expect(provider.stateName).toBe("Australian Capital Territory");
  });

  it("all points have valid coordinates", async () => {
    const fetchImpl = buildMockFetch("No");
    const provider = new AustralianCapitalTerritoryStateProvider(fetchImpl);
    const result = await provider.fetchPoints();
    for (const point of result.points) {
      expect(point.latitude).toBeGreaterThan(-37);
      expect(point.latitude).toBeLessThan(-35);
      expect(point.longitude).toBeGreaterThan(148);
      expect(point.longitude).toBeLessThan(150);
    }
  });
});
