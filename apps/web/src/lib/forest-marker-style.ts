export const MATCHED_FOREST_MARKER_PATH_OPTIONS = {
  color: "#166534",
  fillColor: "#4ade80",
  fillOpacity: 0.95,
  opacity: 1,
  weight: 2
} as const;

export const UNMATCHED_FOREST_MARKER_PATH_OPTIONS = {
  color: "#7f8690",
  fillColor: "#7f8690",
  fillOpacity: 0.32,
  opacity: 0.55,
  weight: 1
} as const;

export const HOVERED_FOREST_MARKER_PATH_OPTIONS = {
  color: "#581c87",
  fillColor: "#c084fc",
  fillOpacity: 0.95,
  opacity: 1,
  weight: 3
} as const;

export const AREA_HIGHLIGHTED_FOREST_MARKER_PATH_OPTIONS = {
  color: "#9a3412",
  fillColor: "#fb923c",
  fillOpacity: 0.95,
  opacity: 1,
  weight: 2
} as const;

const MATCHED_MARKER_RADIUS = 9;
const UNMATCHED_MARKER_RADIUS = 4;
const HOVERED_MARKER_RADIUS = 10;

export type ForestMarkerVisualOptions = {
  markerRadius: number;
  markerPathOptions:
    | typeof MATCHED_FOREST_MARKER_PATH_OPTIONS
    | typeof UNMATCHED_FOREST_MARKER_PATH_OPTIONS
    | typeof HOVERED_FOREST_MARKER_PATH_OPTIONS
    | typeof AREA_HIGHLIGHTED_FOREST_MARKER_PATH_OPTIONS;
};

export const getForestMarkerVisualOptions = ({
  matchesFilters,
  isHoveredForest,
  isAreaHighlighted
}: {
  matchesFilters: boolean;
  isHoveredForest: boolean;
  isAreaHighlighted: boolean;
}): ForestMarkerVisualOptions => {
  if (isHoveredForest) {
    return {
      markerRadius: HOVERED_MARKER_RADIUS,
      markerPathOptions: HOVERED_FOREST_MARKER_PATH_OPTIONS
    };
  }

  if (isAreaHighlighted) {
    return {
      markerRadius: matchesFilters ? MATCHED_MARKER_RADIUS : UNMATCHED_MARKER_RADIUS,
      markerPathOptions: AREA_HIGHLIGHTED_FOREST_MARKER_PATH_OPTIONS
    };
  }

  if (matchesFilters) {
    return {
      markerRadius: MATCHED_MARKER_RADIUS,
      markerPathOptions: MATCHED_FOREST_MARKER_PATH_OPTIONS
    };
  }

  return {
    markerRadius: UNMATCHED_MARKER_RADIUS,
    markerPathOptions: UNMATCHED_FOREST_MARKER_PATH_OPTIONS
  };
};
