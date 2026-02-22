export type ForestMarkerInteractionOptions = {
  displayMarkerRadius: number;
  displayMarkerInteractive: boolean;
  clickTargetMarkerRadius: number | null;
};

const UNMATCHED_FOREST_CLICK_TARGET_RADIUS = 9;

export const getForestMarkerInteractionOptions = ({
  matchesFilters,
  displayMarkerRadius
}: {
  matchesFilters: boolean;
  displayMarkerRadius: number;
}): ForestMarkerInteractionOptions => {
  if (matchesFilters) {
    return {
      displayMarkerRadius,
      displayMarkerInteractive: true,
      clickTargetMarkerRadius: null
    };
  }

  return {
    displayMarkerRadius,
    displayMarkerInteractive: false,
    clickTargetMarkerRadius: UNMATCHED_FOREST_CLICK_TARGET_RADIUS
  };
};
