import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ForestCardContent } from "../../apps/web/src/components/ForestCardContent";
import type { ForestApiResponse } from "../../apps/web/src/lib/api";

const buildForest = (): ForestApiResponse["forests"][number] => ({
  id: "forest-a",
  source: "Forestry Corporation NSW",
  areaName: "Area 1",
  areaUrl: "https://example.com/area-1",
  forestName: "Forest A",
  forestUrl: "https://example.com/forest-a",
  banStatus: "NOT_BANNED",
  banStatusText: "No Solid Fuel Fire Ban",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: "Forest A, NSW",
  geocodeConfidence: 0.85,
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
  travelDurationMinutes: 20
});

describe("ForestCardContent", () => {
  it("renders all closure notices with links", () => {
    const forest = buildForest();

    const html = renderToStaticMarkup(
      <ForestCardContent forest={forest} availableFacilities={[]} />
    );

    expect(html).toContain('data-testid="forest-notice-list"');
    expect(html).toContain("Road access restrictions in Forest A");
    expect(html).toContain("Campground works in Forest A");
    expect(html).toContain("https://example.com/notices/forest-a/road-access");
    expect(html).toContain("https://example.com/notices/forest-a/campground-works");
  });
});