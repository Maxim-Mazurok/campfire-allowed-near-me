import type {
  GeocodeProvider,
  GeocodeLookupAttempt,
  GeocodeLookupOutcome,
  GeocodeHit,
  GeocodeResponse,
} from "./geocode-types.js";

/**
 * Round a coordinate to 6 decimal places (~11 cm precision).
 * Different Nominatim instances (local Docker vs public) return coordinates
 * with varying precision. Using 6dp eliminates rounding disagreements while
 * retaining more than enough accuracy for forest-level geocoding.
 */
export const roundCoordinate = (value: number): number =>
  Math.round(value * 1e6) / 1e6;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message.trim();
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Unknown error";
};

export const shouldRetryHttpStatus = (httpStatus: number): boolean =>
  httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;

/**
 * Common words that appear in forest/area names and geocode results but
 * carry no identifying value for matching.
 */
const GEOCODE_STOP_WORDS = new Set([
  "state", "forest", "forests", "national", "park", "reserve", "new", "south",
  "wales", "australia", "nsw", "near", "around", "the", "of", "and", "pine",
  "native", "region", "road", "council", "shire", "city", "area"
]);

/**
 * Extract significant words from forest names, excluding common stop words,
 * very short tokens, and parenthetical qualifiers (e.g. "(pine plantations)").
 */
export const extractSignificantWords = (
  forestNameWithoutStateForest: string,
  directoryNameWithoutStateForest: string | null
): Set<string> => {
  const stripParenthetical = (text: string): string =>
    text.replace(/\s*\([^)]*\)/g, "").trim();

  const cleanedForestName = stripParenthetical(forestNameWithoutStateForest);
  const cleanedDirectoryName = directoryNameWithoutStateForest
    ? stripParenthetical(directoryNameWithoutStateForest)
    : null;

  const combined = cleanedDirectoryName
    ? `${cleanedForestName} ${cleanedDirectoryName}`
    : cleanedForestName;

  return new Set(
    combined
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !GEOCODE_STOP_WORDS.has(word))
  );
};

/**
 * Check whether a geocode result's displayName shares ALL significant
 * words with the queried forest name.
 */
export const isPlausibleForestMatch = (
  displayName: string,
  significantWords: Set<string>
): boolean => {
  if (significantWords.size === 0) {
    return true;
  }

  const displayNameLower = displayName.toLowerCase();
  for (const word of significantWords) {
    if (!displayNameLower.includes(word)) {
      return false;
    }
  }

  return true;
};

/**
 * Display-name substrings that always indicate a false-positive geocode result.
 */
const GEOCODE_BLACKLISTED_NAMES = [
  "forestry corporation",
];

export const isBlacklistedGeocodeResult = (displayName: string): boolean => {
  const lower = displayName.toLowerCase();
  return GEOCODE_BLACKLISTED_NAMES.some((blacklisted) => lower.includes(blacklisted));
};

/**
 * Google Geocoding result types that indicate a street-level or premise-level
 * feature. These are never correct for forest lookups.
 */
const REJECTED_GOOGLE_RESULT_TYPES = new Set([
  "street_address",
  "route",
  "intersection",
  "premise",
  "subpremise",
  "floor",
  "room",
  "post_box",
  "parking",
  "bus_station",
  "train_station",
  "transit_station",
  "airport",
]);

export const isStreetLevelGoogleResult = (types: string[]): boolean =>
  types.some((type) => REJECTED_GOOGLE_RESULT_TYPES.has(type));

/**
 * Derive a confidence score from Google Geocoding result types.
 */
export const deriveGoogleConfidence = (types: string[]): number => {
  const exactMatchTypes = new Set([
    "natural_feature",
    "park",
    "point_of_interest",
    "establishment",
    "campground",
  ]);
  if (types.some((type) => exactMatchTypes.has(type))) return 1;

  const broadAreaTypes = new Set([
    "locality",
    "sublocality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "administrative_area_level_3",
    "administrative_area_level_4",
    "postal_code",
    "colloquial_area",
    "neighborhood",
  ]);
  if (types.some((type) => broadAreaTypes.has(type))) return 0.5;

  return 0.3;
};

export const isLocalNominatimBaseUrl = (baseUrl: string): boolean => {
  try {
    const parsedUrl = new URL(baseUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "host.docker.internal"
    );
  } catch {
    return false;
  }
};

export const resolvePreferredNominatimBaseUrl = (): string => {
  const configuredBaseUrl = process.env.NOMINATIM_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const nominatimPort = process.env.NOMINATIM_PORT?.trim() || "8080";
  return `http://localhost:${nominatimPort}`;
};

export const buildAttempt = (
  provider: GeocodeProvider | "CACHE",
  query: string,
  aliasKey: string | null,
  cacheKey: string,
  outcome: GeocodeLookupOutcome,
  options?: {
    httpStatus?: number | null;
    resultCount?: number | null;
    errorMessage?: string | null;
  }
): GeocodeLookupAttempt => ({
  provider,
  query,
  aliasKey,
  cacheKey,
  outcome,
  httpStatus: options?.httpStatus ?? null,
  resultCount: options?.resultCount ?? null,
  errorMessage: options?.errorMessage ?? null,
});

export const toGeocodeResponse = (
  hit: GeocodeHit,
  attempts: GeocodeLookupAttempt[],
  warnings?: string[]
): GeocodeResponse => ({
  latitude: hit.latitude,
  longitude: hit.longitude,
  displayName: hit.displayName,
  confidence: hit.importance,
  provider: hit.provider,
  warnings,
  attempts,
});

export const normalizeKey = (raw: string): string =>
  raw.toLowerCase().trim().replace(/\s+/g, " ");

/**
 * Strip common suffixes like "State Forest" from a forest name to produce
 * a core name suitable for FCNSW SFName LIKE matching.
 */
export const extractCoreName = (forestName: string): string =>
  forestName
    .replace(/\bstate\s+forest\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
