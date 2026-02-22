import type { ForestApiResponse } from "./api";
import { FORESTRY_BASE_URL, TOTAL_FIRE_BAN_SOURCE_URL } from "./app-domain-constants";

export const isHttpUrl = (value?: string | null): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

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
  const hasCoordinates =
    typeof forest.latitude === "number" &&
    Number.isFinite(forest.latitude) &&
    typeof forest.longitude === "number" &&
    Number.isFinite(forest.longitude);

  const destination = hasCoordinates
    ? `${forest.latitude},${forest.longitude}`
    : `${forest.forestName}, ${forest.areaName}, NSW`;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
};
