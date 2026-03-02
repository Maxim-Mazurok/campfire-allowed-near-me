// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { renderWithMantine } from "../test-utils";
import { LocationStatusPanels } from "../../web/src/components/LocationStatusPanels";
import type { ForestApiResponse, NearestForest } from "../../shared/contracts";

const buildPayload = (): ForestApiResponse => ({
  fetchedAt: "2026-02-21T10:00:00.000Z",
  stale: false,
  sourceName: "Forestry Corporation NSW",
  availableFacilities: [],
  matchDiagnostics: { unmatchedFacilitiesForests: [], fuzzyMatches: [] },
  forests: [],
  nearestLegalSpot: null,
  warnings: []
});

const buildNearestForest = (overrides: Partial<NearestForest> = {}): NearestForest => ({
  id: "forest-a",
  forestName: "Forest Alpha",
  distanceKm: 42,
  travelDurationMinutes: 55,
  ...overrides
});

const buildAllForests = (): ForestApiResponse["forests"] => [
  {
    id: "forest-a",
    source: "Forestry Corporation NSW",
    areas: [{
      areaName: "Area 1",
      areaUrl: "https://example.com/a",
      banStatus: "NOT_BANNED",
      banStatusText: "No Solid Fuel Fire Ban",
      banScope: "ALL"
    }],
    forestName: "Forest Alpha",
    forestUrl: "https://example.com/forest-alpha",
    totalFireBanStatus: "NOT_BANNED",
    totalFireBanStatusText: "No Total Fire Ban",
    latitude: -33.9,
    longitude: 151.1,
    geocodeName: "Forest Alpha",
    facilities: {},
    directDistanceKm: null,
    distanceKm: 42,
    travelDurationMinutes: 55
  },
  {
    id: "forest-b",
    source: "Forestry Corporation NSW",
    areas: [{
      areaName: "Area 2",
      areaUrl: "https://example.com/b",
      banStatus: "NOT_BANNED",
      banStatusText: "No Solid Fuel Fire Ban",
      banScope: "ALL"
    }],
    forestName: "Forest Beta",
    forestUrl: "https://example.com/forest-beta",
    totalFireBanStatus: "NOT_BANNED",
    totalFireBanStatusText: "No Total Fire Ban",
    latitude: -34.5,
    longitude: 150.5,
    geocodeName: "Forest Beta",
    facilities: {},
    directDistanceKm: null,
    distanceKm: 120,
    travelDurationMinutes: 90
  }
];

describe("LocationStatusPanels", () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    loading: false,
    payload: buildPayload(),
    userLocation: { latitude: -33.9, longitude: 151.1 },
    locationSource: "DEFAULT_SYDNEY" as const,
    onRequestLocation: vi.fn(),
    allForests: buildAllForests(),
    avoidTolls: true
  };

  it("shows both campfire-only and campfire+camping when different forests", () => {
    const nearestLegalCampfire = buildNearestForest({
      id: "forest-a",
      forestName: "Forest Alpha",
      distanceKm: 42,
      travelDurationMinutes: 55
    });

    const nearestLegalCampfireWithCamping = buildNearestForest({
      id: "forest-b",
      forestName: "Forest Beta",
      distanceKm: 120,
      travelDurationMinutes: 90
    });

    renderWithMantine(
      <LocationStatusPanels
        {...defaultProps}
        nearestLegalCampfire={nearestLegalCampfire}
        nearestLegalCampfireWithCamping={nearestLegalCampfireWithCamping}
      />
    );

    expect(screen.getByText(/Closest legal campfire:/)).toBeDefined();
    expect(screen.getByText("Forest Alpha")).toBeDefined();
    expect(screen.getByText(/Closest legal campfire \+ camping:/)).toBeDefined();
    expect(screen.getByText("Forest Beta")).toBeDefined();
  });

  it("shows campfire line and camping note when same forest", () => {
    const sameForest = buildNearestForest({
      id: "forest-a",
      forestName: "Forest Alpha",
      distanceKm: 42,
      travelDurationMinutes: 55
    });

    renderWithMantine(
      <LocationStatusPanels
        {...defaultProps}
        nearestLegalCampfire={sameForest}
        nearestLegalCampfireWithCamping={sameForest}
      />
    );

    expect(screen.getByText(/Closest legal campfire:/)).toBeDefined();
    expect(screen.getByText("Forest Alpha")).toBeDefined();
    expect(screen.getByText(/also has camping/)).toBeDefined();
    // Should NOT show a second "Closest legal campfire + camping:" line
    expect(screen.queryByText(/Closest legal campfire \+ camping:/)).toBeNull();
  });

  it("shows only campfire when no camping forest available", () => {
    const nearestLegalCampfire = buildNearestForest({
      id: "forest-a",
      forestName: "Forest Alpha"
    });

    renderWithMantine(
      <LocationStatusPanels
        {...defaultProps}
        nearestLegalCampfire={nearestLegalCampfire}
        nearestLegalCampfireWithCamping={null}
      />
    );

    expect(screen.getByText(/Closest legal campfire:/)).toBeDefined();
    expect(screen.getByText("Forest Alpha")).toBeDefined();
    expect(screen.queryByText(/camping/i)).toBeNull();
  });

  it("shows empty state when no legal campfire spot exists", () => {
    renderWithMantine(
      <LocationStatusPanels
        {...defaultProps}
        nearestLegalCampfire={null}
        nearestLegalCampfireWithCamping={null}
      />
    );

    expect(screen.getByTestId("nearest-empty")).toBeDefined();
    expect(screen.getByText(/No legal campfire spot/)).toBeDefined();
  });

  it("renders nothing while loading", () => {
    const { container } = renderWithMantine(
      <LocationStatusPanels
        {...defaultProps}
        loading={true}
        nearestLegalCampfire={null}
        nearestLegalCampfireWithCamping={null}
      />
    );

    // The component returns null while loading, so no location-panel should exist.
    // (The container still has Mantine's injected <style> tags.)
    expect(container.querySelector("[data-testid='location-panel']")).toBeNull();
  });
});
