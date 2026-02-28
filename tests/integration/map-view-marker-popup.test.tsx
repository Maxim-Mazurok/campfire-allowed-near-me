// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  screen
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithMantine } from "../test-utils";
import { MapView } from "../../web/src/components/MapView";
import type { BanStatus, ForestPoint } from "../../web/src/lib/api";

vi.mock("../../web/src/components/PopupShadowContainer", () => ({
  PopupShadowContainer: ({
    children,
    className
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>
}));

const mockedMap = {
  setView: vi.fn(),
  fitBounds: vi.fn(),
  panInside: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getZoom: vi.fn(() => 8),
  getCenter: vi.fn(() => ({ lat: -32.1633, lng: 147.0166 })),
  getBounds: vi.fn(() => ({
    getWest: () => 140,
    getSouth: () => -40,
    getEast: () => 160,
    getNorth: () => -20,
    contains: () => true,
    pad: () => ({
      contains: () => true
    })
  }))
};

vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-map-container">{children}</div>
  ),
  TileLayer: () => null,
  Pane: ({
    children,
    name
  }: {
    children: React.ReactNode;
    name: string;
  }) => <div data-testid={`pane-${name}`}>{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-popup">{children}</div>
  ),
  CircleMarker: ({
    pane,
    interactive,
    eventHandlers
  }: {
    pane?: string;
    interactive?: boolean;
    eventHandlers?: { click?: () => void };
  }) => {
    const paneName = pane ?? "default";
    const markerKind = interactive === false ? "display" : "interactive";

    if (interactive === false) {
      return <div data-testid={`circle-marker-${paneName}-${markerKind}`} />;
    }

    return (
      <button
        type="button"
        data-testid={`circle-marker-${paneName}-${markerKind}`}
        onClick={() => {
          eventHandlers?.click?.();
        }}
      />
    );
  },
  useMap: () => mockedMap
}));

afterEach(() => {
  cleanup();
});

const resetMockedMapSpies = () => {
  mockedMap.setView.mockClear();
  mockedMap.fitBounds.mockClear();
  mockedMap.panInside.mockClear();
  mockedMap.on.mockClear();
  mockedMap.off.mockClear();
};

const buildForestPoint = ({
  id,
  forestName,
  banStatus,
  areaName = "Area 1",
  areaUrl = "https://example.com/area-1"
}: {
  id: string;
  forestName: string;
  banStatus: BanStatus;
  areaName?: string;
  areaUrl?: string;
}): ForestPoint => ({
  id,
  source: "Forestry Corporation NSW",
  areas: [{ areaName, areaUrl, banStatus, banStatusText: banStatus === "BANNED" ? "Solid Fuel Fire Ban" : "No Solid Fuel Fire Ban", banScope: "ALL" }],
  forestName,
  forestUrl: `https://example.com/forests/${id}`,
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -32.1633,
  longitude: 147.0166,
  geocodeName: forestName,
  facilities: {},
  distanceKm: null,
  directDistanceKm: null,
  travelDurationMinutes: null
});

describe("MapView marker popup interactions", () => {
  it("opens popup when clicking a green matched marker", () => {
    resetMockedMapSpies();

    renderWithMantine(
      <MapView
        forests={[
          buildForestPoint({
            id: "forest-green",
            forestName: "Forest Green",
            banStatus: "NOT_BANNED"
          })
        ]}
        matchedForestIds={new Set(["forest-green"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    fireEvent.click(screen.getAllByTestId("circle-marker-matched-forests-interactive")[0]!);

    const forestPopupCard = screen.getByTestId("forest-popup-card");
    expect(forestPopupCard).toBeTruthy();
    expect(forestPopupCard.textContent).toContain("Forest Green");
  });

  it("opens popup when clicking a grey unmatched marker", () => {
    resetMockedMapSpies();

    renderWithMantine(
      <MapView
        forests={[
          buildForestPoint({
            id: "forest-grey",
            forestName: "Forest Grey",
            banStatus: "BANNED"
          })
        ]}
        matchedForestIds={new Set()}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    fireEvent.click(screen.getByTestId("circle-marker-unmatched-forests-interactive"));

    const forestPopupCard = screen.getByTestId("forest-popup-card");
    expect(forestPopupCard).toBeTruthy();
    expect(forestPopupCard.textContent).toContain("Forest Grey");
  });

  it("keeps popup stable during hover-driven rerender", () => {
    resetMockedMapSpies();

    const forests = [
      buildForestPoint({
        id: "forest-a",
        forestName: "Forest A",
        banStatus: "NOT_BANNED"
      }),
      buildForestPoint({
        id: "forest-b",
        forestName: "Forest B",
        banStatus: "NOT_BANNED"
      })
    ];

    const { rerender } = renderWithMantine(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    fireEvent.click(screen.getAllByTestId("circle-marker-matched-forests-interactive")[0]!);
    expect(screen.getByTestId("forest-popup-card").textContent).toContain("Forest A");
    expect(mockedMap.panInside).toHaveBeenCalledTimes(1);

    rerender(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId="forest-b"
        hoveredAreaName={null}
      />
    );

    expect(screen.getByTestId("forest-popup-card").textContent).toContain("Forest A");
    expect(mockedMap.panInside).toHaveBeenCalledTimes(1);
  });

  it("renders hovered forest marker in the hovered-forest pane", () => {
    resetMockedMapSpies();

    const forests = [
      buildForestPoint({
        id: "forest-a",
        forestName: "Forest A",
        banStatus: "NOT_BANNED"
      }),
      buildForestPoint({
        id: "forest-b",
        forestName: "Forest B",
        banStatus: "NOT_BANNED"
      })
    ];

    // Render without hover — both should be in matched-forests pane
    const { rerender } = renderWithMantine(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    const matchedMarkersBefore = screen.getAllByTestId("circle-marker-matched-forests-interactive");
    expect(matchedMarkersBefore.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId("circle-marker-hovered-forest-interactive")).toBeNull();

    // Hover forest-a — it should move to hovered-forest pane
    rerender(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId="forest-a"
        hoveredAreaName={null}
      />
    );

    expect(screen.getByTestId("circle-marker-hovered-forest-interactive")).toBeTruthy();
    expect(screen.getByTestId("pane-hovered-forest")).toBeTruthy();
  });

  it("fires onHoveredAreaNameChange when hovering the area subtitle in the popup", () => {
    resetMockedMapSpies();

    const onHoveredAreaNameChange = vi.fn<(hoveredAreaName: string | null) => void>();

    renderWithMantine(
      <MapView
        forests={[
          buildForestPoint({
            id: "forest-a",
            forestName: "Forest A",
            banStatus: "NOT_BANNED"
          })
        ]}
        matchedForestIds={new Set(["forest-a"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
        onHoveredAreaNameChange={onHoveredAreaNameChange}
      />
    );

    fireEvent.click(screen.getAllByTestId("circle-marker-matched-forests-interactive")[0]!);
    expect(screen.getByTestId("forest-popup-card")).toBeTruthy();

    const areaLink = screen.getByTestId("forest-area-link");
    fireEvent.mouseEnter(areaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith("Area 1");

    fireEvent.mouseLeave(areaLink);
    expect(onHoveredAreaNameChange).toHaveBeenCalledWith(null);
  });

  it("fires onHoveredAreaNameChange with correct area name for each area in multi-area popup", () => {
    resetMockedMapSpies();

    const onHoveredAreaNameChange = vi.fn<(hoveredAreaName: string | null) => void>();

    const multiAreaForest: ForestPoint = {
      ...buildForestPoint({
        id: "forest-multi",
        forestName: "Multi Area Forest",
        banStatus: "NOT_BANNED"
      }),
      areas: [
        { areaName: "Hunter Area", areaUrl: "https://example.com/hunter", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" },
        { areaName: "South Coast Area", areaUrl: "https://example.com/south-coast", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban", banScope: "ALL" }
      ]
    };

    renderWithMantine(
      <MapView
        forests={[multiAreaForest]}
        matchedForestIds={new Set(["forest-multi"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
        onHoveredAreaNameChange={onHoveredAreaNameChange}
      />
    );

    fireEvent.click(screen.getAllByTestId("circle-marker-matched-forests-interactive")[0]!);
    expect(screen.getByTestId("forest-popup-card")).toBeTruthy();

    const areaLinks = screen.getAllByTestId("forest-area-link");
    expect(areaLinks).toHaveLength(2);

    // Hover first area link
    fireEvent.mouseEnter(areaLinks[0]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith("Hunter Area");

    fireEvent.mouseLeave(areaLinks[0]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith(null);

    // Hover second area link
    fireEvent.mouseEnter(areaLinks[1]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith("South Coast Area");

    fireEvent.mouseLeave(areaLinks[1]!);
    expect(onHoveredAreaNameChange).toHaveBeenLastCalledWith(null);
  });

  it("highlights area markers on map when hovering area name in popup", () => {
    resetMockedMapSpies();

    const forests = [
      buildForestPoint({
        id: "forest-a",
        forestName: "Forest A",
        banStatus: "NOT_BANNED",
        areaName: "Hunter Area"
      }),
      buildForestPoint({
        id: "forest-b",
        forestName: "Forest B",
        banStatus: "NOT_BANNED",
        areaName: "Hunter Area"
      }),
      buildForestPoint({
        id: "forest-c",
        forestName: "Forest C",
        banStatus: "NOT_BANNED",
        areaName: "South Coast Area"
      })
    ];

    // Initially all markers are in matched-forests pane, no area highlighting
    const { rerender } = renderWithMantine(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b", "forest-c"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    const matchedMarkersInitial = screen.getAllByTestId("circle-marker-matched-forests-interactive");
    expect(matchedMarkersInitial.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByTestId("circle-marker-area-highlighted-forests-interactive")).toBeNull();

    // Simulate what App does when onHoveredAreaNameChange fires:
    // re-render MapView with hoveredAreaName="Hunter Area"
    rerender(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b", "forest-c"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName="Hunter Area"
      />
    );

    // Hunter Area forests (a, b) should move to area-highlighted pane
    const highlightedMarkers = screen.getAllByTestId("circle-marker-area-highlighted-forests-interactive");
    expect(highlightedMarkers).toHaveLength(2);

    // Forest C (South Coast) should remain in matched-forests pane
    const remainingMatchedMarkers = screen.getAllByTestId("circle-marker-matched-forests-interactive");
    expect(remainingMatchedMarkers).toHaveLength(1);

    // Clear hover — all markers return to matched-forests pane
    rerender(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b", "forest-c"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    expect(screen.queryByTestId("circle-marker-area-highlighted-forests-interactive")).toBeNull();
    const allMatchedFinal = screen.getAllByTestId("circle-marker-matched-forests-interactive");
    expect(allMatchedFinal.length).toBeGreaterThanOrEqual(3);
  });

  it("highlights multi-area forest when hovering either of its area names", () => {
    resetMockedMapSpies();

    const multiAreaForest: ForestPoint = {
      ...buildForestPoint({
        id: "forest-multi",
        forestName: "Multi Area Forest",
        banStatus: "NOT_BANNED"
      }),
      areas: [
        { areaName: "Hunter Area", areaUrl: "https://example.com/hunter", banStatus: "NOT_BANNED", banStatusText: "No Solid Fuel Fire Ban", banScope: "ALL" },
        { areaName: "South Coast Area", areaUrl: "https://example.com/south-coast", banStatus: "BANNED", banStatusText: "Solid Fuel Fire Ban", banScope: "ALL" }
      ]
    };

    const forests: ForestPoint[] = [
      multiAreaForest,
      buildForestPoint({
        id: "forest-hunter-only",
        forestName: "Hunter Only Forest",
        banStatus: "NOT_BANNED",
        areaName: "Hunter Area"
      }),
      buildForestPoint({
        id: "forest-south-only",
        forestName: "South Only Forest",
        banStatus: "NOT_BANNED",
        areaName: "South Coast Area"
      })
    ];

    const allForestIds = new Set(forests.map((forest) => forest.id));

    // Initially: no area highlighting
    const { rerender } = renderWithMantine(
      <MapView
        forests={forests}
        matchedForestIds={allForestIds}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    expect(screen.queryByTestId("circle-marker-area-highlighted-forests-interactive")).toBeNull();
    expect(screen.getAllByTestId("circle-marker-matched-forests-interactive").length).toBeGreaterThanOrEqual(3);

    // Hover "Hunter Area": multi-area forest + hunter-only should be highlighted
    rerender(
      <MapView
        forests={forests}
        matchedForestIds={allForestIds}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName="Hunter Area"
      />
    );

    expect(screen.getAllByTestId("circle-marker-area-highlighted-forests-interactive")).toHaveLength(2);
    expect(screen.getAllByTestId("circle-marker-matched-forests-interactive")).toHaveLength(1);

    // Switch to "South Coast Area": multi-area forest + south-only should be highlighted
    rerender(
      <MapView
        forests={forests}
        matchedForestIds={allForestIds}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName="South Coast Area"
      />
    );

    expect(screen.getAllByTestId("circle-marker-area-highlighted-forests-interactive")).toHaveLength(2);
    expect(screen.getAllByTestId("circle-marker-matched-forests-interactive")).toHaveLength(1);

    // Clear hover: all markers back to matched pane
    rerender(
      <MapView
        forests={forests}
        matchedForestIds={allForestIds}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
        hoveredAreaName={null}
      />
    );

    expect(screen.queryByTestId("circle-marker-area-highlighted-forests-interactive")).toBeNull();
    expect(screen.getAllByTestId("circle-marker-matched-forests-interactive").length).toBeGreaterThanOrEqual(3);
  });
});
