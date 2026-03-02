import { describe, expect, it } from "vitest";
import type { FacilityDefinition, ForestPoint } from "../../shared/contracts";
import { findNearestLegalCampfireWithCamping } from "../../web/src/lib/static-snapshot";

const LOCATION = { latitude: -33.9, longitude: 151.1 };

const buildForest = (overrides: Partial<ForestPoint> = {}): ForestPoint => ({
  id: "forest-a",
  source: "Forestry Corporation NSW",
  areas: [{
    areaName: "Area 1",
    areaUrl: "https://example.com/a",
    banStatus: "NOT_BANNED",
    banStatusText: "No Solid Fuel Fire Ban",
    banScope: "ALL"
  }],
  forestName: "Forest A",
  forestUrl: "https://example.com/a",
  totalFireBanStatus: "NOT_BANNED",
  totalFireBanStatusText: "No Total Fire Ban",
  latitude: -33.91,
  longitude: 151.11,
  geocodeName: "Forest A",
  facilities: {},
  directDistanceKm: null,
  distanceKm: null,
  travelDurationMinutes: null,
  ...overrides
});

const CAMPING_AND_PICNICS_DEFINITIONS: FacilityDefinition[] = [
  { key: "camping_and_picnics", label: "Camping and picnics", paramName: "camping_and_picnics", iconKey: "camping" }
];

const LEGACY_CAMPING_DEFINITIONS: FacilityDefinition[] = [
  { key: "camping", label: "Camping", paramName: "camping", iconKey: "camping" }
];

describe("findNearestLegalCampfireWithCamping", () => {
  it("finds nearest forest with camping_and_picnics facility key", () => {
    const forests = [
      buildForest({
        id: "no-camping",
        forestName: "No Camping Forest",
        facilities: { camping_and_picnics: false },
        latitude: -33.91,
        longitude: 151.11
      }),
      buildForest({
        id: "has-camping",
        forestName: "Has Camping Forest",
        facilities: { camping_and_picnics: true },
        latitude: -34.0,
        longitude: 151.2
      })
    ];

    const result = findNearestLegalCampfireWithCamping(
      forests,
      LOCATION,
      CAMPING_AND_PICNICS_DEFINITIONS
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe("has-camping");
    expect(result?.forestName).toBe("Has Camping Forest");
  });

  it("finds nearest forest with legacy camping facility key", () => {
    const forests = [
      buildForest({
        id: "has-camping",
        forestName: "Has Camping Forest",
        facilities: { camping: true },
        latitude: -33.91,
        longitude: 151.11
      })
    ];

    const result = findNearestLegalCampfireWithCamping(
      forests,
      LOCATION,
      LEGACY_CAMPING_DEFINITIONS
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe("has-camping");
  });

  it("falls back to facilities.camping when no availableFacilities provided", () => {
    const forests = [
      buildForest({
        id: "has-camping",
        forestName: "Has Camping Forest",
        facilities: { camping: true },
        latitude: -33.91,
        longitude: 151.11
      })
    ];

    const result = findNearestLegalCampfireWithCamping(forests, LOCATION);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("has-camping");
  });

  it("returns null when no forest has camping facilities", () => {
    const forests = [
      buildForest({
        id: "no-camping",
        forestName: "No Camping Forest",
        facilities: { camping_and_picnics: false },
        latitude: -33.91,
        longitude: 151.11
      })
    ];

    const result = findNearestLegalCampfireWithCamping(
      forests,
      LOCATION,
      CAMPING_AND_PICNICS_DEFINITIONS
    );

    expect(result).toBeNull();
  });

  it("excludes banned forests even if they have camping", () => {
    const forests = [
      buildForest({
        id: "banned-camping",
        forestName: "Banned With Camping",
        areas: [{
          areaName: "Area 1",
          areaUrl: "https://example.com/a",
          banStatus: "BANNED",
          banStatusText: "Solid Fuel Fire Ban",
          banScope: "ALL"
        }],
        facilities: { camping_and_picnics: true },
        latitude: -33.91,
        longitude: 151.11
      })
    ];

    const result = findNearestLegalCampfireWithCamping(
      forests,
      LOCATION,
      CAMPING_AND_PICNICS_DEFINITIONS
    );

    expect(result).toBeNull();
  });

  it("excludes forests with Total Fire Ban even if they have camping", () => {
    const forests = [
      buildForest({
        id: "tfb-camping",
        forestName: "TFB With Camping",
        totalFireBanStatus: "BANNED",
        facilities: { camping_and_picnics: true },
        latitude: -33.91,
        longitude: 151.11
      })
    ];

    const result = findNearestLegalCampfireWithCamping(
      forests,
      LOCATION,
      CAMPING_AND_PICNICS_DEFINITIONS
    );

    expect(result).toBeNull();
  });

  it("returns closest of multiple legal forests with camping", () => {
    const forests = [
      buildForest({
        id: "far-camping",
        forestName: "Far Camping Forest",
        facilities: { camping_and_picnics: true },
        latitude: -35.0,
        longitude: 150.0
      }),
      buildForest({
        id: "near-camping",
        forestName: "Near Camping Forest",
        facilities: { camping_and_picnics: true },
        latitude: -33.91,
        longitude: 151.11
      })
    ];

    const result = findNearestLegalCampfireWithCamping(
      forests,
      LOCATION,
      CAMPING_AND_PICNICS_DEFINITIONS
    );

    expect(result).not.toBeNull();
    expect(result?.id).toBe("near-camping");
  });

  it("returns separate campfire and campfire+camping results when different forests", () => {
    const forests = [
      buildForest({
        id: "closest-legal",
        forestName: "Closest Legal (no camping)",
        facilities: { camping_and_picnics: false },
        latitude: -33.91,
        longitude: 151.11
      }),
      buildForest({
        id: "camping-legal",
        forestName: "Further Legal + Camping",
        facilities: { camping_and_picnics: true },
        latitude: -34.0,
        longitude: 151.2
      })
    ];

    const campfireWithCamping = findNearestLegalCampfireWithCamping(
      forests,
      LOCATION,
      CAMPING_AND_PICNICS_DEFINITIONS
    );

    expect(campfireWithCamping).not.toBeNull();
    expect(campfireWithCamping?.id).toBe("camping-legal");
    expect(campfireWithCamping?.id).not.toBe("closest-legal");
  });
});
