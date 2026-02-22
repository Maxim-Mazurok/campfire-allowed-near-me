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
  opacity: 0.55
} as const;

export const HOVERED_FOREST_MARKER_PATH_OPTIONS = {
  color: "#581c87",
  fillColor: "#c084fc",
  fillOpacity: 0.95,
  opacity: 1,
  weight: 3
} as const;

export type ForestMarkerVisualOptions = {
  markerRadius: number;
  markerPathOptions:
    | typeof MATCHED_FOREST_MARKER_PATH_OPTIONS
    | typeof UNMATCHED_FOREST_MARKER_PATH_OPTIONS
    | typeof HOVERED_FOREST_MARKER_PATH_OPTIONS;
};

export const getForestMarkerVisualOptions = ({
  matchesFilters,
  isHoveredForest
}: {
  matchesFilters: boolean;
  isHoveredForest: boolean;
}): ForestMarkerVisualOptions => {
  if (isHoveredForest) {
    return {
      markerRadius: 10,
      markerPathOptions: HOVERED_FOREST_MARKER_PATH_OPTIONS
    };
  }

  if (matchesFilters) {
    return {
      markerRadius: 9,
      markerPathOptions: MATCHED_FOREST_MARKER_PATH_OPTIONS
    };
  }

  return {
    markerRadius: 4,
    markerPathOptions: UNMATCHED_FOREST_MARKER_PATH_OPTIONS
  };
};
