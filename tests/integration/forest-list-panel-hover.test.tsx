// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../test-utils";
import { ForestListPanel } from "../../web/src/components/ForestListPanel";
import type { ForestApiResponse } from "../../web/src/lib/api";

afterEach(() => {
  cleanup();
});

const buildForest = (
  id: string,
  forestName: string
): ForestApiResponse["forests"][number] => ({
  id,
  source: "Forestry Corporation NSW",
  areas: [{ areaName: "Area 1", areaUrl: "https://example.com/area-1", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" }],
  forestName,
  forestUrl: `https://example.com/forests/${id}`,
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: forestName,
  facilities: {},
  distanceKm: 10,
  directDistanceKm: null,
  travelDurationMinutes: 15
});

describe("ForestListPanel hover behavior", () => {
  it("emits hovered forest id on mouse enter and null on mouse leave", () => {
    const onHoveredForestIdChange = vi.fn<(hoveredForestId: string | null) => void>();

    renderWithMantine(
      <ForestListPanel
        matchingForests={[buildForest("forest-a", "Forest A")]}
        availableFacilities={[]}
        payload={null}
        avoidTolls={true}
        hoveredForestId={null}
        onHoveredForestIdChange={onHoveredForestIdChange}
        hoveredAreaName={null}
        onHoveredAreaNameChange={() => {}}
        forestListSortOption="DRIVING_DISTANCE_ASC"
        onForestListSortOptionChange={() => {}}
        hasUserLocation={true}
        hasDrivingRoutes={true}
      />
    );

    const forestRow = screen.getByTestId("forest-row");
    fireEvent.mouseEnter(forestRow);
    fireEvent.mouseLeave(forestRow);

    expect(onHoveredForestIdChange).toHaveBeenNthCalledWith(1, "forest-a");
    expect(onHoveredForestIdChange).toHaveBeenNthCalledWith(2, null);
  });

  it("clears hovered forest id when the hovered forest is filtered out", async () => {
    const onHoveredForestIdChange = vi.fn<(hoveredForestId: string | null) => void>();

    renderWithMantine(
      <ForestListPanel
        matchingForests={[
          buildForest("forest-a", "Forest A"),
          buildForest("forest-b", "Forest B")
        ]}
        availableFacilities={[]}
        payload={null}
        avoidTolls={true}
        hoveredForestId="forest-a"
        onHoveredForestIdChange={onHoveredForestIdChange}
        hoveredAreaName={null}
        onHoveredAreaNameChange={() => {}}
        forestListSortOption="DRIVING_DISTANCE_ASC"
        onForestListSortOptionChange={() => {}}
        hasUserLocation={true}
        hasDrivingRoutes={true}
      />
    );

    const forestSearchInput = screen.getByPlaceholderText("Filter by forest name");
    fireEvent.change(forestSearchInput, { target: { value: "Forest B" } });

    await waitFor(() => {
      expect(onHoveredForestIdChange).toHaveBeenCalledWith(null);
    });
  });

  it("fires onHoveredAreaNameChange with correct area name for each area in multi-area forest row", () => {
    const onHoveredAreaNameChange = vi.fn<(hoveredAreaName: string | null) => void>();

    const multiAreaForest: ForestApiResponse["forests"][number] = {
      ...buildForest("forest-multi", "Multi Area Forest"),
      areas: [
        { areaName: "Hunter Area", areaUrl: "https://example.com/hunter", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" },
        { areaName: "South Coast Area", areaUrl: "https://example.com/south-coast", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban", banScope: "ALL" }
      ]
    };

    renderWithMantine(
      <ForestListPanel
        matchingForests={[multiAreaForest]}
        availableFacilities={[]}
        payload={null}
        avoidTolls={true}
        hoveredForestId={null}
        onHoveredForestIdChange={() => {}}
        hoveredAreaName={null}
        onHoveredAreaNameChange={onHoveredAreaNameChange}
        forestListSortOption="DRIVING_DISTANCE_ASC"
        onForestListSortOptionChange={() => {}}
        hasUserLocation={true}
        hasDrivingRoutes={true}
      />
    );

    const areaLinks = screen.getAllByTestId("forest-area-link");
    expect(areaLinks).toHaveLength(2);

    // Hover first area
    fireEvent.mouseEnter(areaLinks[0]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith("Hunter Area");

    fireEvent.mouseLeave(areaLinks[0]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith(null);

    // Hover second area
    fireEvent.mouseEnter(areaLinks[1]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith("South Coast Area");

    fireEvent.mouseLeave(areaLinks[1]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith(null);
  });
});
