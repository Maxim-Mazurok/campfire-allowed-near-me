// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapView } from "../../apps/web/src/components/MapView";
import type { ForestPoint } from "../../apps/web/src/lib/api";

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
  banStatus
}: {
  id: string;
  forestName: string;
  banStatus: ForestPoint["banStatus"];
}): ForestPoint => ({
  id,
  source: "Forestry Corporation NSW",
  areaName: "Area 1",
  areaUrl: "https://example.com/area-1",
  forestName,
  forestUrl: `https://example.com/forests/${id}`,
  banStatus,
  banStatusText: banStatus === "BANNED" ? "Solid Fuel Fire Ban" : "No Solid Fuel Fire Ban",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -32.1633,
  longitude: 147.0166,
  geocodeName: forestName,
  geocodeConfidence: 0.8,
  facilities: {},
  distanceKm: null,
  travelDurationMinutes: null
});

describe("MapView marker popup interactions", () => {
  it("opens popup when clicking a green matched marker", () => {
    resetMockedMapSpies();

    render(
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
      />
    );

    fireEvent.click(screen.getAllByTestId("circle-marker-matched-forests-interactive")[0]);

    const forestPopupCard = screen.getByTestId("forest-popup-card");
    expect(forestPopupCard).toBeTruthy();
    expect(forestPopupCard.textContent).toContain("Forest Green");
  });

  it("opens popup when clicking a grey unmatched marker", () => {
    resetMockedMapSpies();

    render(
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

    const { rerender } = render(
      <MapView
        forests={forests}
        matchedForestIds={new Set(["forest-a", "forest-b"])}
        userLocation={null}
        availableFacilities={[]}
        avoidTolls={true}
        hoveredForestId={null}
      />
    );

    fireEvent.click(screen.getAllByTestId("circle-marker-matched-forests-interactive")[0]);
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
      />
    );

    expect(screen.getByTestId("forest-popup-card").textContent).toContain("Forest A");
    expect(mockedMap.panInside).toHaveBeenCalledTimes(1);
  });
});
