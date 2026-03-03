import type { ForestPoint } from "../../../shared/contracts.js";

/**
 * Minimum number of forests to include for route calculation,
 * regardless of the distance gap.
 */
const MINIMUM_ROUTE_FORESTS = 5;

/**
 * Maximum number of forests to include for route calculation.
 * Budget cap: 10 forests per user request is a reasonable upper bound to balance route quality vs API cost.
 */
const MAXIMUM_ROUTE_FORESTS = 10;

/**
 * Forests within this multiplier of the MINIMUM_ROUTE_FORESTS-th forest's
 * haversine distance are included. Beyond that, the gap is too large for
 * driving routes to meaningfully change their relative ordering.
 *
 * Example: if the 5th closest forest is 100 km away, forests up to 150 km
 * are included (1.5×). A forest at 200 km is excluded — it's so much farther
 * that real road distance won't change its position relative to the closer group.
 */
const DISTANCE_MULTIPLIER = 1.5;

/**
 * Selects which forests should receive actual driving route calculations.
 * Uses haversine (direct) distance as a heuristic to avoid expensive API
 * calls for forests that are obviously far away.
 *
 * Strategy:
 * 1. Sort geocoded forests by haversine distance (ascending).
 * 2. Always include the MINIMUM_ROUTE_FORESTS closest ones.
 * 3. Continue including forests while their haversine distance is within
 *    DISTANCE_MULTIPLIER × the distance of the MINIMUM_ROUTE_FORESTS-th forest.
 * 4. Never exceed MAXIMUM_ROUTE_FORESTS.
 *
 * Returns forest IDs suitable for passing to the routes API.
 */
export const selectForestIdsForRouting = (
  forests: readonly ForestPoint[]
): string[] => {
  const geocodedForests = forests
    .filter(
      (forest): forest is ForestPoint & { directDistanceKm: number } =>
        forest.directDistanceKm !== null && forest.directDistanceKm >= 0
    )
    .sort((left, right) => left.directDistanceKm - right.directDistanceKm);

  if (geocodedForests.length <= MINIMUM_ROUTE_FORESTS) {
    return geocodedForests.map((forest) => forest.id);
  }

  const thresholdForest = geocodedForests[MINIMUM_ROUTE_FORESTS - 1];
  if (!thresholdForest) {
    return geocodedForests.map((forest) => forest.id);
  }

  const thresholdDistance =
    thresholdForest.directDistanceKm * DISTANCE_MULTIPLIER;

  let count = MINIMUM_ROUTE_FORESTS;
  while (
    count < geocodedForests.length &&
    count < MAXIMUM_ROUTE_FORESTS
  ) {
    const candidate = geocodedForests[count];
    if (!candidate || candidate.directDistanceKm > thresholdDistance) {
      break;
    }
    count++;
  }

  return geocodedForests.slice(0, count).map((forest) => forest.id);
};

/** Exported for testing. */
export const ROUTE_SELECTION_CONSTANTS = {
  MINIMUM_ROUTE_FORESTS,
  MAXIMUM_ROUTE_FORESTS,
  DISTANCE_MULTIPLIER
} as const;
