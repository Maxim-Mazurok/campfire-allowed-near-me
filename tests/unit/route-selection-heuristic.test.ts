import { describe, expect, it } from "vitest";
import {
  selectForestIdsForRouting,
  ROUTE_SELECTION_CONSTANTS
} from "../../web/src/lib/route-selection-heuristic";
import type { ForestPoint } from "../../shared/contracts";

const { MINIMUM_ROUTE_FORESTS, MAXIMUM_ROUTE_FORESTS, DISTANCE_MULTIPLIER } =
  ROUTE_SELECTION_CONSTANTS;

/** Minimal valid ForestPoint with the fields the heuristic actually reads. */
const makeForest = (
  id: string,
  directDistanceKm: number | null
): ForestPoint =>
  ({
    id,
    directDistanceKm,
    distanceKm: directDistanceKm,
    travelDurationMinutes: null,
    latitude: directDistanceKm !== null ? -33.8 : null,
    longitude: directDistanceKm !== null ? 151.2 : null,
    source: "test",
    areas: [],
    forestName: id,
    totalFireBanStatus: "UNKNOWN",
    totalFireBanStatusText: "",
    geocodeName: null,
    facilities: {}
  }) as ForestPoint;

describe("selectForestIdsForRouting", () => {
  it("returns empty array for empty input", () => {
    expect(selectForestIdsForRouting([])).toEqual([]);
  });

  it("returns all forests when fewer than MINIMUM_ROUTE_FORESTS", () => {
    const forests = Array.from({ length: 5 }, (_, index) =>
      makeForest(`forest-${index}`, (index + 1) * 10)
    );
    const ids = selectForestIdsForRouting(forests);
    expect(ids).toHaveLength(5);
  });

  it("returns at least MINIMUM_ROUTE_FORESTS when available", () => {
    const forests = Array.from({ length: 20 }, (_, index) =>
      makeForest(`forest-${index}`, (index + 1) * 10)
    );
    const ids = selectForestIdsForRouting(forests);
    expect(ids.length).toBeGreaterThanOrEqual(MINIMUM_ROUTE_FORESTS);
  });

  it("includes forests within DISTANCE_MULTIPLIER of the threshold forest", () => {
    // 10 forests at 10 km each (threshold = 100 km), then one at 140 km (within 1.5×)
    const closeForests = Array.from({ length: MINIMUM_ROUTE_FORESTS }, (_, index) =>
      makeForest(`close-${index}`, (index + 1) * 10)
    );
    const thresholdDistance = closeForests[MINIMUM_ROUTE_FORESTS - 1]!.directDistanceKm!;
    const midForest = makeForest(
      "mid",
      thresholdDistance * DISTANCE_MULTIPLIER - 1
    );
    const ids = selectForestIdsForRouting([...closeForests, midForest]);
    expect(ids).toContain("mid");
  });

  it("excludes forests beyond DISTANCE_MULTIPLIER of the threshold forest", () => {
    const closeForests = Array.from({ length: MINIMUM_ROUTE_FORESTS }, (_, index) =>
      makeForest(`close-${index}`, (index + 1) * 10)
    );
    const thresholdDistance = closeForests[MINIMUM_ROUTE_FORESTS - 1]!.directDistanceKm!;
    const farForest = makeForest(
      "far",
      thresholdDistance * DISTANCE_MULTIPLIER + 100
    );
    const ids = selectForestIdsForRouting([...closeForests, farForest]);
    expect(ids).not.toContain("far");
  });

  it("never exceeds MAXIMUM_ROUTE_FORESTS", () => {
    // All forests at the same distance → all within multiplier threshold
    const forests = Array.from({ length: 200 }, (_, index) =>
      makeForest(`forest-${index}`, 50)
    );
    const ids = selectForestIdsForRouting(forests);
    expect(ids.length).toBeLessThanOrEqual(MAXIMUM_ROUTE_FORESTS);
  });

  it("excludes forests with null directDistanceKm", () => {
    const forests = [
      makeForest("has-distance", 10),
      makeForest("no-distance", null)
    ];
    const ids = selectForestIdsForRouting(forests);
    expect(ids).toEqual(["has-distance"]);
  });

  it("returns forests sorted by haversine distance (closest first)", () => {
    const forests = [
      makeForest("far", 200),
      makeForest("close", 10),
      makeForest("mid", 80)
    ];
    const ids = selectForestIdsForRouting(forests);
    expect(ids[0]).toBe("close");
    if (ids.length > 1) {
      expect(ids[1]).toBe("mid");
    }
  });

  it("has a gap-based cutoff in a realistic scenario", () => {
    // 8 forests clustered at 30–44 km, then 5 at 500+ km.
    // 5th forest distance = 38 km → threshold = 38 × 1.5 = 57 km.
    // All 8 cluster forests (30–44) are within 57 km and under MAXIMUM_ROUTE_FORESTS.
    const clusterForests = Array.from({ length: 8 }, (_, index) =>
      makeForest(`cluster-${index}`, 30 + index * 2)
    );
    const distantForests = Array.from({ length: 5 }, (_, index) =>
      makeForest(`distant-${index}`, 500 + index * 50)
    );
    const ids = selectForestIdsForRouting([...clusterForests, ...distantForests]);

    // All cluster forests should be included (8 ≤ MAXIMUM_ROUTE_FORESTS)
    for (const forest of clusterForests) {
      expect(ids).toContain(forest.id);
    }
    // Distant forests should be excluded (500 km >> 57 km threshold)
    for (const forest of distantForests) {
      expect(ids).not.toContain(forest.id);
    }
  });

  it("caps at MAXIMUM_ROUTE_FORESTS even when all are within threshold", () => {
    // 15 tightly-clustered forests — all within multiplier threshold,
    // but the max cap should still limit the result.
    const forests = Array.from({ length: 15 }, (_, index) =>
      makeForest(`dense-${index}`, 30 + index * 2)
    );
    const ids = selectForestIdsForRouting(forests);
    expect(ids.length).toBeLessThanOrEqual(MAXIMUM_ROUTE_FORESTS);
    expect(ids.length).toBeGreaterThanOrEqual(MINIMUM_ROUTE_FORESTS);
  });
});
