import { describe, expect, it } from "vitest";
import type { ForestApiResponse } from "../../apps/web/src/lib/api";
import { compareForestsByListSortOption } from "../../apps/web/src/lib/app-domain-forest";

const buildForest = (
  id: string,
  forestName: string,
  distanceKm: number | null,
  travelDurationMinutes: number | null
): ForestApiResponse["forests"][number] => ({
  id,
  source: "Forestry Corporation NSW",
  areaName: "Area",
  areaUrl: "https://example.com/area",
  forestName,
  forestUrl: "https://example.com/forest",
  banStatus: "NOT_BANNED",
  banStatusText: "No Solid Fuel Fire Ban",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: "Forest",
  geocodeConfidence: 0.9,
  facilities: {},
  distanceKm,
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
