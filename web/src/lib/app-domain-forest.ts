import type { ForestApiResponse } from "./api";
import { getForestBanStatus, getForestPrimaryAreaName } from "./api";
import type { ForestListSortOption } from "./app-domain-types";
import { FORESTRY_BASE_URL, SOLID_FUEL_FIRE_BAN_SOURCE_URL, TOTAL_FIRE_BAN_SOURCE_URL } from "./app-domain-constants";

export const isHttpUrl = (value?: string | null): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

export const forestBelongsToArea = (
  forest: Pick<ForestApiResponse["forests"][number], "areas">,
  areaName: string | null
): boolean => {
  if (areaName === null) {
    return false;
  }

  return forest.areas.some((area) => area.areaName === areaName);
};

export const forestHasCoordinates = (
  forest: Pick<ForestApiResponse["forests"][number], "latitude" | "longitude">
): boolean =>
  typeof forest.latitude === "number" &&
  Number.isFinite(forest.latitude) &&
  typeof forest.longitude === "number" &&
  Number.isFinite(forest.longitude);

export const sortForestsByDistance = (
  left: ForestApiResponse["forests"][number],
  right: ForestApiResponse["forests"][number]
): number => {
  if (left.distanceKm === null && right.distanceKm === null) {
    return left.forestName.localeCompare(right.forestName);
  }

  if (left.distanceKm === null) {
    return 1;
  }

  if (right.distanceKm === null) {
    return -1;
  }

  return left.distanceKm - right.distanceKm;
};

const sortWithNullableMetric = (
  leftValue: number | null,
  rightValue: number | null,
  sortDirection: "asc" | "desc"
): number => {
  if (leftValue === null && rightValue === null) {
    return 0;
  }

  if (leftValue === null) {
    return 1;
  }

  if (rightValue === null) {
    return -1;
  }

  const metricDifference = leftValue - rightValue;
  return sortDirection === "asc" ? metricDifference : -metricDifference;
};

/**
 * Whether the forest has a driving route estimate (distanceKm populated by the Routes API).
 */
export const forestHasDrivingRoute = (
  forest: Pick<ForestApiResponse["forests"][number], "distanceKm">
): boolean => forest.distanceKm !== null;

/**
 * Comparator for a single metric + direction, falling back to forest name.
 */
const compareByMetricThenName = (
  left: ForestApiResponse["forests"][number],
  right: ForestApiResponse["forests"][number],
  leftValue: number | null,
  rightValue: number | null,
  sortDirection: "asc" | "desc"
): number => {
  const metricComparison = sortWithNullableMetric(leftValue, rightValue, sortDirection);
  if (metricComparison !== 0) {
    return metricComparison;
  }
  return left.forestName.localeCompare(right.forestName);
};

export const compareForestsByListSortOption = (
  left: ForestApiResponse["forests"][number],
  right: ForestApiResponse["forests"][number],
  forestListSortOption: ForestListSortOption
): number => {
  switch (forestListSortOption) {
    case "DIRECT_DISTANCE_ASC":
      return compareByMetricThenName(left, right, left.directDistanceKm, right.directDistanceKm, "asc");
    case "DIRECT_DISTANCE_DESC":
      return compareByMetricThenName(left, right, left.directDistanceKm, right.directDistanceKm, "desc");
    case "DRIVING_DISTANCE_ASC":
      return compareByMetricThenName(left, right, left.distanceKm, right.distanceKm, "asc");
    case "DRIVING_DISTANCE_DESC":
      return compareByMetricThenName(left, right, left.distanceKm, right.distanceKm, "desc");
    case "DRIVING_TIME_ASC":
      return compareByMetricThenName(left, right, left.travelDurationMinutes, right.travelDurationMinutes, "asc");
    case "DRIVING_TIME_DESC":
      return compareByMetricThenName(left, right, left.travelDurationMinutes, right.travelDurationMinutes, "desc");
    default:
      return left.forestName.localeCompare(right.forestName);
  }
};

/**
 * Returns the sort direction extracted from a driving sort option.
 */
const drivingSortDirection = (option: ForestListSortOption): "asc" | "desc" =>
  option.endsWith("_DESC") ? "desc" : "asc";

/**
 * Whether the sort option is a driving-based sort (distance or time).
 */
const isDrivingSortOption = (option: ForestListSortOption): boolean =>
  option.startsWith("DRIVING_");

/**
 * Sorts forests with an explicit routed-first partition for driving sort options.
 *
 * For driving sorts:
 * 1. Partition forests into routed (have distanceKm) and unrouted (no distanceKm).
 * 2. Sort routed forests by the driving metric.
 * 3. Sort unrouted forests by directDistanceKm in the same direction.
 * 4. Concatenate: routed first, then unrouted.
 *
 * For direct-distance sorts, no partition is needed — just sort by the metric.
 */
export const sortForestsByListOption = (
  forests: readonly ForestApiResponse["forests"][number][],
  forestListSortOption: ForestListSortOption
): ForestApiResponse["forests"][number][] => {
  if (forests.length <= 1) {
    return [...forests];
  }

  if (!isDrivingSortOption(forestListSortOption)) {
    return [...forests].sort((left, right) =>
      compareForestsByListSortOption(left, right, forestListSortOption)
    );
  }

  const direction = drivingSortDirection(forestListSortOption);
  const routedForests: ForestApiResponse["forests"][number][] = [];
  const unroutedForests: ForestApiResponse["forests"][number][] = [];

  for (const forest of forests) {
    if (forestHasDrivingRoute(forest)) {
      routedForests.push(forest);
    } else {
      unroutedForests.push(forest);
    }
  }

  routedForests.sort((left, right) =>
    compareForestsByListSortOption(left, right, forestListSortOption)
  );

  unroutedForests.sort((left, right) =>
    compareByMetricThenName(left, right, left.directDistanceKm, right.directDistanceKm, direction)
  );

  return [...routedForests, ...unroutedForests];
};

const formatDriveDuration = (durationMinutes: number | null): string => {
  if (durationMinutes === null || !Number.isFinite(durationMinutes)) {
    return "Drive time unavailable";
  }

  const roundedMinutes = Math.max(1, Math.round(durationMinutes));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
};

export const formatDriveSummary = (
  distanceKm: number | null,
  durationMinutes: number | null
): string => {
  if (distanceKm === null) {
    return "Drive distance unavailable";
  }

  if (durationMinutes === null) {
    return `${distanceKm.toFixed(1)} km`;
  }

  return `${distanceKm.toFixed(1)} km, ${formatDriveDuration(durationMinutes)}`;
};

export const formatDirectDistanceSummary = (
  directDistanceKm: number | null
): string => {
  if (directDistanceKm === null || !Number.isFinite(directDistanceKm)) {
    return "Distance unavailable";
  }

  return `~${directDistanceKm.toFixed(1)} km straight-line`;
};

const slugifyPathSegment = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");

export const buildFacilitiesForestUrl = (forestName: string): string =>
  `${FORESTRY_BASE_URL}/visit/forests/${slugifyPathSegment(forestName)}`;

export const normalizeForestName = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

export const buildTextHighlightUrl = (baseUrl: string, textToHighlight: string): string => {
  const normalizedTextToHighlight = textToHighlight.trim();
  if (!normalizedTextToHighlight) {
    return baseUrl;
  }

  const encodedTextToHighlight = encodeURIComponent(normalizedTextToHighlight);
  if (baseUrl.includes(":~:text=")) {
    return baseUrl;
  }

  if (baseUrl.includes("#")) {
    return `${baseUrl}:~:text=${encodedTextToHighlight}`;
  }

  return `${baseUrl}#:~:text=${encodedTextToHighlight}`;
};

export const buildSolidFuelBanDetailsUrl = (
  forest: Pick<ForestApiResponse["forests"][number], "areas">
): string | null => {
  const banStatus = getForestBanStatus(forest.areas);
  const areaName = getForestPrimaryAreaName(forest.areas).trim();
  if (!areaName || banStatus === "UNKNOWN") {
    return null;
  }

  const endText = banStatus === "BANNED" ? "banned" : "No ban";
  const fragment = `#:~:text=${encodeURIComponent(areaName)},${encodeURIComponent(endText)}`;
  return `${SOLID_FUEL_FIRE_BAN_SOURCE_URL}${fragment}`;
};

export const buildTotalFireBanDetailsUrl = (
  forest: ForestApiResponse["forests"][number]
): string => {
  const fullAddress = forest.geocodeName?.trim() ? forest.geocodeName : " ";
  const placeIdentifier = " ";
  const latitude =
    typeof forest.latitude === "number" && Number.isFinite(forest.latitude)
      ? String(forest.latitude)
      : " ";
  const longitude =
    typeof forest.longitude === "number" && Number.isFinite(forest.longitude)
      ? String(forest.longitude)
      : " ";

  return `${TOTAL_FIRE_BAN_SOURCE_URL}?fullAddress=${encodeURIComponent(fullAddress)}&lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}&placeId=${encodeURIComponent(placeIdentifier)}`;
};

export const buildGoogleMapsDrivingNavigationUrl = (
  forest: ForestApiResponse["forests"][number]
): string => {
  const destination = forestHasCoordinates(forest)
    ? `${forest.latitude},${forest.longitude}`
    : `${forest.forestName}, ${getForestPrimaryAreaName(forest.areas)}, NSW`;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
};
