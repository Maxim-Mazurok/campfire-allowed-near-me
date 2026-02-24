import { describe, expect, it } from "vitest";
import {
  AREA_HIGHLIGHTED_FOREST_MARKER_PATH_OPTIONS,
  getForestMarkerVisualOptions,
  HOVERED_FOREST_MARKER_PATH_OPTIONS,
  MATCHED_FOREST_MARKER_PATH_OPTIONS,
  UNMATCHED_FOREST_MARKER_PATH_OPTIONS
} from "../../apps/web/src/lib/forest-marker-style";

describe("forest marker style", () => {
  it("returns deep-purple highlight style for hovered forests", () => {
    const markerVisualOptions = getForestMarkerVisualOptions({
      matchesFilters: true,
      isHoveredForest: true,
      isAreaHighlighted: false
    });

    expect(markerVisualOptions.markerRadius).toBe(10);
    expect(markerVisualOptions.markerPathOptions).toEqual(
      HOVERED_FOREST_MARKER_PATH_OPTIONS
    );
  });

  it("returns matched style for non-hovered matched forests", () => {
    const markerVisualOptions = getForestMarkerVisualOptions({
      matchesFilters: true,
      isHoveredForest: false,
      isAreaHighlighted: false
    });

    expect(markerVisualOptions.markerRadius).toBe(9);
    expect(markerVisualOptions.markerPathOptions).toEqual(
      MATCHED_FOREST_MARKER_PATH_OPTIONS
    );
  });

  it("returns unmatched style for non-hovered unmatched forests", () => {
    const markerVisualOptions = getForestMarkerVisualOptions({
      matchesFilters: false,
      isHoveredForest: false,
      isAreaHighlighted: false
    });

    expect(markerVisualOptions.markerRadius).toBe(4);
    expect(markerVisualOptions.markerPathOptions).toEqual(
      UNMATCHED_FOREST_MARKER_PATH_OPTIONS
    );
  });

  it("returns orange highlight style for area-highlighted matched forests", () => {
    const markerVisualOptions = getForestMarkerVisualOptions({
      matchesFilters: true,
      isHoveredForest: false,
      isAreaHighlighted: true
    });

    expect(markerVisualOptions.markerRadius).toBe(9);
    expect(markerVisualOptions.markerPathOptions).toEqual(
      AREA_HIGHLIGHTED_FOREST_MARKER_PATH_OPTIONS
    );
  });

  it("returns orange highlight with small radius for area-highlighted unmatched forests", () => {
    const markerVisualOptions = getForestMarkerVisualOptions({
      matchesFilters: false,
      isHoveredForest: false,
      isAreaHighlighted: true
    });

    expect(markerVisualOptions.markerRadius).toBe(4);
    expect(markerVisualOptions.markerPathOptions).toEqual(
      AREA_HIGHLIGHTED_FOREST_MARKER_PATH_OPTIONS
    );
  });

  it("prefers hovered style over area-highlighted style", () => {
    const markerVisualOptions = getForestMarkerVisualOptions({
      matchesFilters: true,
      isHoveredForest: true,
      isAreaHighlighted: true
    });

    expect(markerVisualOptions.markerRadius).toBe(10);
    expect(markerVisualOptions.markerPathOptions).toEqual(
      HOVERED_FOREST_MARKER_PATH_OPTIONS
    );
  });
});
