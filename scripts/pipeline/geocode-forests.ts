/**
 * Pipeline Stage 2: Geocode forests.
 *
 * Reads scrape-forestry output, resolves coordinates for each forest name
 * using the geocoding service (Nominatim + Google fallback).
 *
 * Requires: data/pipeline/scrape-forestry.json
 * Produces: data/pipeline/geocoded-forests.json
 */
import { ForestGeocoder, type GeocodeResponse } from "../../apps/api/src/services/forest-geocoder.js";
import type { ForestGeocodeDiagnostics } from "../../apps/api/src/types/domain.js";
import { normalizeForestLabel } from "../../packages/shared/src/text-utils.js";
import { findBestForestNameMatch, normalizeForestNameForMatch } from "../../packages/shared/src/fuzzy-forest-match.js";
import {
  PIPELINE_PATHS,
  SCRAPE_FORESTRY_STAGE,
  SCRAPE_FORESTRY_VERSION,
  GEOCODE_FORESTS_STAGE,
  GEOCODE_FORESTS_VERSION,
  createStageOutput,
  type ScrapeForestryData,
  type GeocodedForestEntry,
  type GeocodeForestData
} from "../../packages/shared/src/pipeline-types.js";
import { readPipelineFile, writePipelineFile } from "./pipeline-io.js";
import {
  GEOCODE_CACHE_PATH,
  GOOGLE_MAPS_API_KEY,
  MAX_GEOCODE_LOOKUPS_PER_RUN,
  NOMINATIM_BASE_URL,
} from "./pipeline-config.js";

// ---------------------------------------------------------------------------
// Geocode diagnostics builder (extracted from LiveForestDataService)
// ---------------------------------------------------------------------------

type GeocodeLookupAttempt = NonNullable<GeocodeResponse["attempts"]>[number];

const selectGeocodeFailureReason = (attempts: GeocodeLookupAttempt[]): string => {
  if (attempts.some((attempt) => attempt.outcome === "LIMIT_REACHED")) {
    return "Geocoding lookup limit reached before coordinates were resolved.";
  }

  if (attempts.some((attempt) => attempt.outcome === "GOOGLE_API_KEY_MISSING")) {
    return "Google Geocoding is unavailable because GOOGLE_MAPS_API_KEY is missing.";
  }

  if (
    attempts.some(
      (attempt) => attempt.outcome === "HTTP_ERROR" || attempt.outcome === "REQUEST_FAILED"
    )
  ) {
    return "Geocoding request failed before coordinates were resolved.";
  }

  if (
    attempts.some(
      (attempt) =>
        attempt.outcome === "EMPTY_RESULT" || attempt.outcome === "INVALID_COORDINATES"
    )
  ) {
    return "No usable geocoding results were returned for this forest.";
  }

  return "Coordinates were unavailable after forest geocoding.";
};

const buildGeocodeDiagnostics = (
  geocode: GeocodeResponse
): ForestGeocodeDiagnostics | null => {
  if (geocode.latitude !== null && geocode.longitude !== null) {
    return null;
  }

  const attempts = geocode.attempts ?? [];
  const debug = attempts.map((attempt) => {
    const details: string[] = [
      `Forest lookup: ${attempt.outcome}`,
      `provider=${attempt.provider}`,
      `query=${attempt.query}`
    ];
    if (attempt.httpStatus !== null) details.push(`http=${attempt.httpStatus}`);
    if (attempt.resultCount !== null) details.push(`results=${attempt.resultCount}`);
    if (attempt.errorMessage) details.push(`error=${attempt.errorMessage}`);
    return details.join(" | ");
  });

  if (!debug.length) {
    debug.push("No geocoding attempt diagnostics were captured in this snapshot.");
  }

  return {
    reason: selectGeocodeFailureReason(attempts),
    debug
  };
};

// ---------------------------------------------------------------------------
// Build facility directory name match (for geocode hints)
// ---------------------------------------------------------------------------

const FACILITY_MATCH_THRESHOLD = 0.62;

const buildDirectoryForestNameMap = (
  forestryData: ScrapeForestryData
): Map<string, string> => {
  const directoryNames = forestryData.directory.forests.map(
    (entry) => entry.forestName
  );
  const fireBanNames = [
    ...new Set(
      forestryData.areas.flatMap((area) =>
        area.forests.map((forest) => forest.trim()).filter(Boolean)
      )
    )
  ];

  const result = new Map<string, string>();
  const availableDirectoryNames = new Set(directoryNames);

  // Exact match pass
  for (const fireBanName of fireBanNames) {
    const normalized = normalizeForestNameForMatch(fireBanName);
    const exactMatch = [...availableDirectoryNames].find(
      (directoryName) => normalizeForestNameForMatch(directoryName) === normalized
    );
    if (exactMatch) {
      result.set(fireBanName, exactMatch);
      availableDirectoryNames.delete(exactMatch);
    }
  }

  // Fuzzy match pass for remaining
  for (const fireBanName of fireBanNames) {
    if (result.has(fireBanName)) continue;
    const candidates = [...availableDirectoryNames];
    const fuzzy = findBestForestNameMatch(fireBanName, candidates);
    if (fuzzy && fuzzy.score >= FACILITY_MATCH_THRESHOLD) {
      result.set(fireBanName, fuzzy.candidateName);
      availableDirectoryNames.delete(fuzzy.candidateName);
    }
  }

  return result;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Geocode Forests ===\n");

  console.log("Loading scrape-forestry data...");
  const forestryData = readPipelineFile<ScrapeForestryData>(
    PIPELINE_PATHS.scrapeForestry,
    SCRAPE_FORESTRY_STAGE,
    SCRAPE_FORESTRY_VERSION
  );

  const geocoder = new ForestGeocoder({
    cacheDbPath: GEOCODE_CACHE_PATH,
    nominatimBaseUrl: NOMINATIM_BASE_URL,
    googleApiKey: GOOGLE_MAPS_API_KEY || null,
    maxNewLookupsPerRun: MAX_GEOCODE_LOOKUPS_PER_RUN,
    requestDelayMs: 1200
  });

  if ("resetLookupBudgetForRun" in geocoder) {
    geocoder.resetLookupBudgetForRun();
  }

  // Build directory name hints for geocoding
  const directoryNameMap = buildDirectoryForestNameMap(forestryData);

  // Collect unique forest names from areas
  const forestEntries: Array<{ forestName: string; areaName: string }> = [];
  const seenForestKeys = new Set<string>();

  for (const area of forestryData.areas) {
    for (const rawName of area.forests) {
      const forestName = rawName.trim();
      if (!forestName) continue;
      const key = normalizeForestLabel(forestName).toLowerCase();
      if (seenForestKeys.has(key)) continue;
      seenForestKeys.add(key);
      forestEntries.push({ forestName, areaName: area.areaName });
    }
  }

  // Also include unmatched directory forests
  const unmatchedDirectoryForests = forestryData.directory.forests
    .filter((entry) => {
      const key = normalizeForestLabel(entry.forestName).toLowerCase();
      return !seenForestKeys.has(key);
    });

  for (const entry of unmatchedDirectoryForests) {
    const key = normalizeForestLabel(entry.forestName).toLowerCase();
    if (seenForestKeys.has(key)) continue;
    seenForestKeys.add(key);
    forestEntries.push({ forestName: entry.forestName, areaName: "" });
  }

  console.log(`[geocode] ${forestEntries.length} unique forest(s) to geocode\n`);

  const geocodedForests: GeocodedForestEntry[] = [];
  const allWarnings = new Set<string>();

  for (let i = 0; i < forestEntries.length; i++) {
    const { forestName, areaName } = forestEntries[i]!;
    const directoryForestName = directoryNameMap.get(forestName) ?? null;

    const geocodeStartMs = Date.now();
    const geocode = await geocoder.geocodeForest(
      forestName,
      areaName,
      directoryForestName ? { directoryForestName } : undefined
    );
    const geocodeElapsedMs = Date.now() - geocodeStartMs;

    const attempts = geocode.attempts ?? [];
    const outcomes = attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`);
    const wasCacheHit = outcomes.some((outcome) => outcome === "CACHE:CACHE_HIT");

    console.log(
      `  [${i + 1}/${forestEntries.length}] ${forestName} | ${wasCacheHit ? "CACHE_HIT" : "LOOKUP"} | ${geocodeElapsedMs}ms | ${geocode.latitude !== null ? `(${geocode.latitude}, ${geocode.longitude})` : "no coords"}`
    );

    for (const warning of geocode.warnings ?? []) {
      allWarnings.add(warning);
    }

    geocodedForests.push({
      forestName,
      areaName: areaName || null,
      directoryForestName,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      displayName: geocode.displayName,
      confidence: geocode.confidence,
      diagnostics: buildGeocodeDiagnostics(geocode),
      warnings: geocode.warnings ?? []
    });
  }

  const data: GeocodeForestData = {
    forests: geocodedForests,
    warnings: [...allWarnings]
  };

  const output = createStageOutput(
    GEOCODE_FORESTS_STAGE,
    GEOCODE_FORESTS_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.geocodedForests, output);

  const forestsWithCoordinates = geocodedForests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  );

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Geocode complete (${elapsedSeconds}s)`);
  console.log(`  Total forests: ${geocodedForests.length}`);
  console.log(`  With coordinates: ${forestsWithCoordinates.length}`);
  console.log(`  Without coordinates: ${geocodedForests.length - forestsWithCoordinates.length}`);

  if (allWarnings.size) {
    console.log(`  Warnings: ${allWarnings.size}`);
    for (const warning of allWarnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main().catch((error) => {
  console.error("Fatal error in geocode-forests:");
  console.error(error);
  process.exit(1);
});
