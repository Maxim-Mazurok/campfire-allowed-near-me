import { describe, expect, it } from "vitest";
import type { ForestPoint } from "../../apps/web/src/lib/api";
import {
  getUnmatchedMarkerLimitForZoom,
  selectClosestForestsToCenter
} from "../../apps/web/src/lib/map-marker-rendering";

const buildForestPoint = (
  id: string,
  latitude: number | null,
  longitude: number | null
): ForestPoint => ({
  id,
  source: "Forestry Corporation NSW",
  areas: [{ areaName: "Test Area", areaUrl: "https://example.com/area", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }],
  forestName: `Forest ${id}`,
  forestUrl: `https://example.com/forest/${id}`,
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude,
  longitude,
  geocodeName: `Forest ${id}`,
  facilities: {},
  distanceKm: null,
  directDistanceKm: null,
  travelDurationMinutes: null
});

describe("map marker rendering helpers", () => {
  it("returns expected unmatched marker budget by zoom tier", () => {
    expect(getUnmatchedMarkerLimitForZoom(5)).toBe(450);
    expect(getUnmatchedMarkerLimitForZoom(6)).toBe(450);
    expect(getUnmatchedMarkerLimitForZoom(7)).toBe(1_200);
    expect(getUnmatchedMarkerLimitForZoom(8)).toBeNull();
  });

  it("returns nearest forests when list exceeds limit", () => {
    const forests = [
      buildForestPoint("far", 10, 10),
      buildForestPoint("near-a", 0.2, 0.2),
      buildForestPoint("near-b", 0.1, 0.1),
      buildForestPoint("middle", 3, 3)
    ];

    const selectedForests = selectClosestForestsToCenter(forests, 0, 0, 2);

    expect(selectedForests.map((forest) => forest.id)).toEqual(["near-b", "near-a"]);
  });

  it("ignores forests without coordinates when selecting closest forests", () => {
    const forests = [
      buildForestPoint("missing-latitude", null, 1),
      buildForestPoint("missing-longitude", 1, null),
      buildForestPoint("nearest", 0.05, 0.05),
      buildForestPoint("second-nearest", 0.2, 0.2)
    ];

    const selectedForests = selectClosestForestsToCenter(forests, 0, 0, 2);

    expect(selectedForests.map((forest) => forest.id)).toEqual([
      "nearest",
      "second-nearest"
    ]);
  });

  it("returns all forests when the limit is greater than available forests", () => {
    const forests = [
      buildForestPoint("alpha", 1, 1),
      buildForestPoint("beta", 2, 2)
    ];

    const selectedForests = selectClosestForestsToCenter(forests, 0, 0, 3);

    expect(selectedForests).toBe(forests);
  });
});
