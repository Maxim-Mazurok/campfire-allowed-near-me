import { describe, expect, it } from "vitest";
import type { ForestApiResponse } from "../../web/src/lib/api";
import {
  buildSolidFuelBanDetailsUrl,
  compareForestsByListSortOption,
  forestBelongsToArea,
  forestHasDrivingRoute,
  formatDirectDistanceSummary,
  sortForestsByListOption
} from "../../web/src/lib/app-domain-forest";

const buildForest = (
  id: string,
  forestName: string,
  distanceKm: number | null,
  travelDurationMinutes: number | null,
  directDistanceKm: number | null = null
): ForestApiResponse["forests"][number] => ({
  id,
  source: "Forestry Corporation NSW",
  areas: [{ areaName: "Area", areaUrl: "https://example.com/area", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }],
  forestName,
  forestUrl: "https://example.com/forest",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: "Forest",
  facilities: {},
  distanceKm,
  directDistanceKm,
  travelDurationMinutes
});

describe("compareForestsByListSortOption", () => {
  it("sorts by driving distance ascending among routed forests", () => {
    const forests = [
      buildForest("forest-b", "Forest B", 20, 30),
      buildForest("forest-a", "Forest A", 10, 15)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_DISTANCE_ASC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B"
    ]);
  });

  it("sorts by driving distance descending among routed forests", () => {
    const forests = [
      buildForest("forest-a", "Forest A", 10, 15),
      buildForest("forest-b", "Forest B", 20, 30)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_DISTANCE_DESC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest B",
      "Forest A"
    ]);
  });

  it("sorts by driving time ascending among routed forests", () => {
    const forests = [
      buildForest("forest-b", "Forest B", 20, 35),
      buildForest("forest-a", "Forest A", 10, 15)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_TIME_ASC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B"
    ]);
  });

  it("sorts by driving time descending among routed forests", () => {
    const forests = [
      buildForest("forest-a", "Forest A", 10, 15),
      buildForest("forest-b", "Forest B", 20, 35)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_TIME_DESC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest B",
      "Forest A"
    ]);
  });

  it("sorts by direct distance ascending", () => {
    const forests = [
      buildForest("forest-b", "Forest B", 10, 8, 50),
      buildForest("forest-a", "Forest A", 200, 120, 5),
      buildForest("forest-c", "Forest C", null, null, 25)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DIRECT_DISTANCE_ASC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest C",
      "Forest B"
    ]);
  });

  it("falls back to name when metrics are equal", () => {
    const forests = [
      buildForest("forest-b", "Forest B", 10, 15, 5),
      buildForest("forest-a", "Forest A", 10, 15, 5)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_DISTANCE_ASC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B"
    ]);
  });
});

describe("sortForestsByListOption", () => {
  it("partitions routed forests before unrouted for driving distance ascending", () => {
    const forests = [
      buildForest("forest-d", "Forest D", null, null, 50),
      buildForest("forest-c", "Forest C", null, null, 30),
      buildForest("forest-b", "Forest B", 20, 30, 25),
      buildForest("forest-a", "Forest A", 10, 15, 8)
    ];

    const sorted = sortForestsByListOption(forests, "DRIVING_DISTANCE_ASC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B",
      "Forest C",
      "Forest D"
    ]);
  });

  it("partitions routed forests before unrouted for driving distance descending", () => {
    const forests = [
      buildForest("forest-d", "Forest D", null, null, 30),
      buildForest("forest-c", "Forest C", null, null, 50),
      buildForest("forest-b", "Forest B", 10, 15, 8),
      buildForest("forest-a", "Forest A", 20, 30, 25)
    ];

    const sorted = sortForestsByListOption(forests, "DRIVING_DISTANCE_DESC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B",
      "Forest C",
      "Forest D"
    ]);
  });

  it("partitions routed forests before unrouted for driving time ascending", () => {
    const forests = [
      buildForest("forest-d", "Forest D", null, null, 50),
      buildForest("forest-c", "Forest C", null, null, 30),
      buildForest("forest-b", "Forest B", 20, 35, 25),
      buildForest("forest-a", "Forest A", 10, 15, 8)
    ];

    const sorted = sortForestsByListOption(forests, "DRIVING_TIME_ASC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B",
      "Forest C",
      "Forest D"
    ]);
  });

  it("partitions routed forests before unrouted for driving time descending", () => {
    const forests = [
      buildForest("forest-d", "Forest D", null, null, 30),
      buildForest("forest-c", "Forest C", null, null, 50),
      buildForest("forest-b", "Forest B", 10, 15, 8),
      buildForest("forest-a", "Forest A", 20, 35, 25)
    ];

    const sorted = sortForestsByListOption(forests, "DRIVING_TIME_DESC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B",
      "Forest C",
      "Forest D"
    ]);
  });

  it("keeps routed forests before unrouted even when unrouted is closer by direct distance", () => {
    const forests = [
      buildForest("close-unrouted", "Close Unrouted", null, null, 5),
      buildForest("far-routed", "Far Routed", 100, 60, 90)
    ];

    const sorted = sortForestsByListOption(forests, "DRIVING_DISTANCE_ASC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Far Routed",
      "Close Unrouted"
    ]);
  });

  it("sorts unrouted partition by direct distance descending for driving desc", () => {
    const forests = [
      buildForest("routed-short", "Routed Short", 20, 15, 18),
      buildForest("unrouted-near", "Unrouted Near", null, null, 10),
      buildForest("unrouted-far", "Unrouted Far", null, null, 200)
    ];

    const sorted = sortForestsByListOption(forests, "DRIVING_DISTANCE_DESC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Routed Short",
      "Unrouted Far",
      "Unrouted Near"
    ]);
  });

  it("sorts unrouted forests by name when direct distance is also null", () => {
    const forests = [
      buildForest("forest-c", "Forest C", null, null, null),
      buildForest("forest-a", "Forest A", null, null, null),
      buildForest("forest-b", "Forest B", 20, 30, 25)
    ];

    const sorted = sortForestsByListOption(forests, "DRIVING_DISTANCE_ASC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Forest B",
      "Forest A",
      "Forest C"
    ]);
  });

  it("does not partition for direct distance sort", () => {
    const forests = [
      buildForest("forest-b", "Forest B", 10, 8, 50),
      buildForest("forest-a", "Forest A", 200, 120, 5),
      buildForest("forest-c", "Forest C", null, null, 25)
    ];

    const sorted = sortForestsByListOption(forests, "DIRECT_DISTANCE_ASC");

    expect(sorted.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest C",
      "Forest B"
    ]);
  });

  it("returns a copy for single-element input", () => {
    const forests = [buildForest("only", "Only Forest", 10, 5, 8)];
    const sorted = sortForestsByListOption(forests, "DRIVING_DISTANCE_ASC");

    expect(sorted).toEqual(forests);
    expect(sorted).not.toBe(forests);
  });

  it("returns empty array for empty input", () => {
    expect(sortForestsByListOption([], "DRIVING_DISTANCE_ASC")).toEqual([]);
  });
});

describe("forestHasDrivingRoute", () => {
  it("returns true when distanceKm is a number", () => {
    expect(forestHasDrivingRoute({ distanceKm: 10 })).toBe(true);
  });

  it("returns false when distanceKm is null", () => {
    expect(forestHasDrivingRoute({ distanceKm: null })).toBe(false);
  });
});

describe("formatDirectDistanceSummary", () => {
  it("formats a valid distance with tilde prefix and straight-line suffix", () => {
    expect(formatDirectDistanceSummary(42.567)).toBe("~42.6 km straight-line");
  });

  it("returns unavailable message for null", () => {
    expect(formatDirectDistanceSummary(null)).toBe("Distance unavailable");
  });

  it("returns unavailable message for non-finite values", () => {
    expect(formatDirectDistanceSummary(Infinity)).toBe("Distance unavailable");
    expect(formatDirectDistanceSummary(NaN)).toBe("Distance unavailable");
  });
});

describe("buildSolidFuelBanDetailsUrl", () => {
  it("builds URL with area name and 'banned' end text for BANNED status", () => {
    const url = buildSolidFuelBanDetailsUrl({
      areas: [{ areaName: "State forests of the Central West around Bathurst, Orange, Oberon, Rylstone, Kandos and Gulgong", areaUrl: "https://example.com/area", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban", banScope: "ALL" }]
    });

    expect(url).toBe(
      "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans" +
      "#:~:text=State%20forests%20of%20the%20Central%20West%20around%20Bathurst%2C%20Orange%2C%20Oberon%2C%20Rylstone%2C%20Kandos%20and%20Gulgong,banned"
    );
  });

  it("builds URL with area name and 'No ban' end text for NOT_BANNED status", () => {
    const url = buildSolidFuelBanDetailsUrl({
      areas: [{ areaName: "Native forests of the North Coast", areaUrl: "https://example.com/area", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }]
    });

    expect(url).toBe(
      "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans" +
      "#:~:text=Native%20forests%20of%20the%20North%20Coast,No%20ban"
    );
  });

  it("returns null for UNKNOWN ban status", () => {
    const url = buildSolidFuelBanDetailsUrl({
      areas: [{ areaName: "Not listed on Solid Fuel Fire Ban pages", areaUrl: "https://example.com/area", banStatus: "UNKNOWN", banStatusText: "Unknown", banScope: "ALL" }]
    });

    expect(url).toBeNull();
  });

  it("returns null for empty area name", () => {
    const url = buildSolidFuelBanDetailsUrl({
      areas: [{ areaName: "  ", areaUrl: "https://example.com/area", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban", banScope: "ALL" }]
    });

    expect(url).toBeNull();
  });
});

describe("forestBelongsToArea", () => {
  it("returns true when areaName matches the primary area", () => {
    const forest = buildForest("forest-1", "Forest One", 10, 15);
    expect(forestBelongsToArea(forest, "Area")).toBe(true);
  });

  it("returns false when areaName does not match any area", () => {
    const forest = buildForest("forest-1", "Forest One", 10, 15);
    expect(forestBelongsToArea(forest, "Nonexistent Area")).toBe(false);
  });

  it("returns false when areaName is null", () => {
    const forest = buildForest("forest-1", "Forest One", 10, 15);
    expect(forestBelongsToArea(forest, null)).toBe(false);
  });

  it("matches any area in the areas array for multi-area forests", () => {
    const forest = {
      ...buildForest("forest-1", "Multi-Area Forest", 10, 15),
      areas: [
        { areaName: "First Area", areaUrl: "https://example.com/first", banStatus: "BANNED" as const, banStatusText: "Banned", banScope: "ALL" as const },
        { areaName: "Second Area", areaUrl: "https://example.com/second", banStatus: "NOT_BANNED" as const, banStatusText: "No ban", banScope: "ALL" as const }
      ]
    };

    expect(forestBelongsToArea(forest, "First Area")).toBe(true);
    expect(forestBelongsToArea(forest, "Second Area")).toBe(true);
    expect(forestBelongsToArea(forest, "Third Area")).toBe(false);
  });

  it("returns false for any area name when areas array is empty", () => {
    const forest = {
      ...buildForest("forest-1", "Fallback Forest", 10, 15),
      areas: [] as ForestApiResponse["forests"][number]["areas"]
    };

    expect(forestBelongsToArea(forest, "Area")).toBe(false);
    expect(forestBelongsToArea(forest, "Other")).toBe(false);
  });
});
