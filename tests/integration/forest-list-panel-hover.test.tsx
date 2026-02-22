// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForestListPanel } from "../../apps/web/src/components/ForestListPanel";
import type { ForestApiResponse } from "../../apps/web/src/lib/api";

afterEach(() => {
  cleanup();
});

const buildForest = (
  id: string,
  forestName: string
): ForestApiResponse["forests"][number] => ({
  id,
  source: "Forestry Corporation NSW",
  areaName: "Area 1",
  areaUrl: "https://example.com/area-1",
  forestName,
  forestUrl: `https://example.com/forests/${id}`,
  banStatus: "NOT_BANNED",
  banStatusText: "No Solid Fuel Fire Ban",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.9,
  longitude: 151.1,
  geocodeName: forestName,
  geocodeConfidence: 0.8,
  facilities: {},
  distanceKm: 10,
  travelDurationMinutes: 15
});

describe("ForestListPanel hover behavior", () => {
  it("emits hovered forest id on mouse enter and null on mouse leave", () => {
    const onHoveredForestIdChange = vi.fn<(hoveredForestId: string | null) => void>();

    render(
      <ForestListPanel
        matchingForests={[buildForest("forest-a", "Forest A")]}
        availableFacilities={[]}
        payload={null}
        avoidTolls={true}
        hoveredForestId={null}
        onHoveredForestIdChange={onHoveredForestIdChange}
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

    render(
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
      />
    );

    const forestSearchInput = screen.getByTestId("forest-search-input");
    fireEvent.change(forestSearchInput, { target: { value: "Forest B" } });

    await waitFor(() => {
      expect(onHoveredForestIdChange).toHaveBeenCalledWith(null);
    });
  });
});
