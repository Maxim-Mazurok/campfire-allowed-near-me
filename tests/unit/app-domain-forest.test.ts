import { describe, expect, it } from "vitest";
import type { ForestApiResponse } from "../../web/src/lib/api";
import { buildSolidFuelBanDetailsUrl, compareForestsByListSortOption, forestBelongsToArea } from "../../web/src/lib/app-domain-forest";

const buildForest = (
  id: string,
  forestName: string,
  distanceKm: number | null,
  travelDurationMinutes: number | null
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
  directDistanceKm: null,
  travelDurationMinutes
});

describe("compareForestsByListSortOption", () => {
  it("sorts by driving distance ascending with unknown distances last", () => {
    const forests = [
      buildForest("forest-c", "Forest C", null, null),
      buildForest("forest-b", "Forest B", 20, 30),
      buildForest("forest-a", "Forest A", 10, 15)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_DISTANCE_ASC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B",
      "Forest C"
    ]);
  });

  it("sorts by driving distance descending", () => {
    const forests = [
      buildForest("forest-c", "Forest C", null, null),
      buildForest("forest-b", "Forest B", 20, 30),
      buildForest("forest-a", "Forest A", 10, 15)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_DISTANCE_DESC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest B",
      "Forest A",
      "Forest C"
    ]);
  });

  it("sorts by driving time ascending", () => {
    const forests = [
      buildForest("forest-c", "Forest C", null, null),
      buildForest("forest-b", "Forest B", 20, 35),
      buildForest("forest-a", "Forest A", 10, 15)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_TIME_ASC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest A",
      "Forest B",
      "Forest C"
    ]);
  });

  it("sorts by driving time descending", () => {
    const forests = [
      buildForest("forest-c", "Forest C", null, null),
      buildForest("forest-b", "Forest B", 20, 35),
      buildForest("forest-a", "Forest A", 10, 15)
    ];

    const sortedForests = [...forests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, "DRIVING_TIME_DESC")
    );

    expect(sortedForests.map((forest) => forest.forestName)).toEqual([
      "Forest B",
      "Forest A",
      "Forest C"
    ]);
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
