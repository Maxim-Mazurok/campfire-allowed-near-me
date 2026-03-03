import type { ForestApiResponse } from "../../web/src/lib/api";

export const buildForestCardFixture = (overrides?: Partial<ForestApiResponse["forests"][number]>): ForestApiResponse["forests"][number] => ({
  id: "forest-a",
  source: "Forestry Corporation NSW",
  areas: [{ areaName: "Area 1", areaUrl: "https://example.com/area-1", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }],
  forestName: "Forest A",
  forestUrl: "https://example.com/forest-a",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: "Forest A, NSW",
  facilities: {},
  closureStatus: "PARTIAL",
  closureNotices: [
    {
      id: "notice-1",
      title: "Road access restrictions in Forest A",
      detailUrl: "https://example.com/notices/forest-a/road-access",
      listedAt: null,
      listedAtText: null,
      untilAt: null,
      untilText: null,
      forestNameHint: "Forest A",
      status: "PARTIAL",
      tags: ["ROAD_ACCESS"]
    },
    {
      id: "notice-2",
      title: "Campground works in Forest A",
      detailUrl: "https://example.com/notices/forest-a/campground-works",
      listedAt: null,
      listedAtText: null,
      untilAt: null,
      untilText: null,
      forestNameHint: "Forest A",
      status: "NOTICE",
      tags: ["CAMPING"]
    }
  ],
  distanceKm: 14.2,
  directDistanceKm: null,
  travelDurationMinutes: 20,
  ...overrides
});
