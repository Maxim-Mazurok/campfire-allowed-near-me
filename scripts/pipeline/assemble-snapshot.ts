/**
 * Pipeline Stage 4: Assemble final snapshot.
 *
 * Reads all intermediate pipeline outputs and assembles the final
 * forests-snapshot.json for the frontend.
 *
 * Requires:
 *   data/pipeline/scrape-forestry.json
 *   data/pipeline/scrape-closures.json  (or enriched-closures.json)
 *   data/pipeline/scrape-total-fire-ban.json
 *   data/pipeline/geocoded-forests.json
 *
 * Optional:
 *   data/pipeline/enriched-closures.json  (preferred over raw closures)
 *
 * Produces: apps/web/public/forests-snapshot.json
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { TotalFireBanService } from "../../apps/api/src/services/total-fire-ban-service.js";
import { normalizeForestLabel, slugify } from "../../packages/shared/src/text-utils.js";
import {
  findBestForestNameMatch,
  normalizeForestNameForMatch
} from "../../packages/shared/src/fuzzy-forest-match.js";
import { getForestBanStatus } from "../../packages/shared/src/forest-helpers.js";
import {
  CLOSURE_TAG_DEFINITIONS,
  buildClosureTagsFromNotices,
  buildClosureStatusFromNotices,
  buildClosureImpactSummaryFromNotices
} from "../../packages/shared/src/closure-helpers.js";
import {
  buildForestStatusKey,
  buildMostRestrictiveBanByForest,
  normalizeBanStatusText
} from "../../packages/shared/src/ban-status-helpers.js";
import { mergeMultiAreaForests } from "../../packages/shared/src/forest-merge.js";
import {
  buildFacilityAssignments,
  buildClosureAssignments,
  buildUnknownFacilities,
  createMatchedFacilities,
  type FacilityMatchResult
} from "../../packages/shared/src/facility-matching.js";
import type {
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDirectorySnapshot,
  ForestPoint,
  PersistedSnapshot
} from "../../apps/api/src/types/domain.js";
import type { TotalFireBanSnapshot } from "../../apps/api/src/services/total-fire-ban-service.js";
import {
  PIPELINE_PATHS,
  SCRAPE_FORESTRY_STAGE,
  SCRAPE_FORESTRY_VERSION,
  SCRAPE_CLOSURES_STAGE,
  SCRAPE_CLOSURES_VERSION,
  SCRAPE_TOTAL_FIRE_BAN_STAGE,
  SCRAPE_TOTAL_FIRE_BAN_VERSION,
  GEOCODE_FORESTS_STAGE,
  GEOCODE_FORESTS_VERSION,
  ENRICH_CLOSURES_STAGE,
  ENRICH_CLOSURES_VERSION,
  type ScrapeForestryData,
  type ScrapeClosuresData,
  type ScrapeTotalFireBanData,
  type GeocodeForestData,
  type EnrichClosuresData,
  type GeocodedForestEntry
} from "../../packages/shared/src/pipeline-types.js";
import { readPipelineFile, writePipelineFile } from "./pipeline-io.js";
import { SNAPSHOT_OUTPUT_PATH } from "./pipeline-config.js";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNAPSHOT_FORMAT_VERSION = 7;
const FIRE_BAN_ENTRY_URL = "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const UNKNOWN_FIRE_BAN_AREA_NAME = "Not listed on Solid Fuel Fire Ban pages";
const UNKNOWN_FIRE_BAN_STATUS_TEXT = "Unknown (not listed on Solid Fuel Fire Ban pages)";
const SOURCE_NAME = "Forestry Corporation NSW";

// ---------------------------------------------------------------------------
// Snapshot validation
// ---------------------------------------------------------------------------

const validateSnapshot = (snapshot: PersistedSnapshot): string[] => {
  const errors: string[] = [];

  if (!snapshot.forests.length) {
    errors.push("Snapshot contains zero forests.");
  }

  const forestsWithCoordinates = snapshot.forests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  );
  if (forestsWithCoordinates.length < 10) {
    errors.push(
      `Only ${forestsWithCoordinates.length} forests have coordinates (expected at least 10).`
    );
  }

  const forestsWithBanStatus = snapshot.forests.filter(
    (forest) => getForestBanStatus(forest.areas) !== "UNKNOWN"
  );
  if (forestsWithBanStatus.length < 10) {
    errors.push(
      `Only ${forestsWithBanStatus.length} forests have known ban status (expected at least 10).`
    );
  }

  if (!snapshot.availableFacilities.length) {
    errors.push("Snapshot has no facility definitions.");
  }

  return errors;
};

// ---------------------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------------------

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Assemble Snapshot ===\n");

  // Load all intermediate pipeline files
  console.log("Loading intermediate pipeline files...");

  const forestryData = readPipelineFile<ScrapeForestryData>(
    PIPELINE_PATHS.scrapeForestry,
    SCRAPE_FORESTRY_STAGE,
    SCRAPE_FORESTRY_VERSION
  );

  const geocodeData = readPipelineFile<GeocodeForestData>(
    PIPELINE_PATHS.geocodedForests,
    GEOCODE_FORESTS_STAGE,
    GEOCODE_FORESTS_VERSION
  );

  const totalFireBanData = readPipelineFile<ScrapeTotalFireBanData>(
    PIPELINE_PATHS.scrapeTotalFireBan,
    SCRAPE_TOTAL_FIRE_BAN_STAGE,
    SCRAPE_TOTAL_FIRE_BAN_VERSION
  );

  // Prefer enriched closures if available, fall back to raw closures
  let closures: ForestClosureNotice[];
  let closureWarnings: string[];
  if (existsSync(PIPELINE_PATHS.enrichedClosures)) {
    console.log("  Using enriched closures (with LLM impacts).");
    const enrichedData = readPipelineFile<EnrichClosuresData>(
      PIPELINE_PATHS.enrichedClosures,
      ENRICH_CLOSURES_STAGE,
      ENRICH_CLOSURES_VERSION
    );
    closures = enrichedData.closures;
    closureWarnings = enrichedData.warnings;
  } else {
    console.log("  No enriched closures found; using raw closures.");
    const rawClosuresData = readPipelineFile<ScrapeClosuresData>(
      PIPELINE_PATHS.scrapeClosures,
      SCRAPE_CLOSURES_STAGE,
      SCRAPE_CLOSURES_VERSION
    );
    closures = rawClosuresData.closures;
    closureWarnings = rawClosuresData.warnings;
  }

  console.log("");

  // Build geocode lookup
  const geocodeByForestKey = new Map<string, GeocodedForestEntry>();
  for (const entry of geocodeData.forests) {
    geocodeByForestKey.set(buildForestStatusKey(entry.forestName), entry);
  }

  // Build facility data
  const { areas, directory } = forestryData;
  const byForestName = new Map(
    directory.forests.map((entry) => [entry.forestName, entry.facilities] as const)
  );
  const byForestUrl = new Map(
    directory.forests.map((entry) => [entry.forestName, entry.forestUrl ?? null] as const)
  );

  // Facility assignments
  const uniqueFireBanNames = [...new Set(
    areas.flatMap((area) => area.forests.map((forest) => forest.trim()).filter(Boolean))
  )];
  const facilityAssignments = buildFacilityAssignments(
    uniqueFireBanNames,
    directory,
    byForestName
  );

  // Build most restrictive ban by forest
  const mostRestrictiveBanByForest = buildMostRestrictiveBanByForest(areas);

  // Total Fire Ban service for coordinate-based lookups
  const totalFireBanService = new TotalFireBanService();
  const totalFireBanSnapshot: TotalFireBanSnapshot = totalFireBanData.snapshot;

  // Warning collection
  const warningSet = new Set([
    ...forestryData.warnings,
    ...closureWarnings,
    ...(totalFireBanSnapshot.warnings ?? []),
    ...geocodeData.warnings
  ]);

  // Build forest points
  const points: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[] = [];
  const totalFireBanNoAreaMatchForests = new Set<string>();
  const totalFireBanMissingStatusAreas = new Set<string>();

  console.log("[assemble] Building forest points from areas...");

  for (const area of areas) {
    const uniqueForestNames = [...new Set(
      area.forests.map((forest) => forest.trim()).filter(Boolean)
    )];

    for (const forestName of uniqueForestNames) {
      if (!forestName) continue;

      const banSummary =
        mostRestrictiveBanByForest.get(buildForestStatusKey(forestName)) ?? {
          status: area.status,
          statusText: normalizeBanStatusText(area.status, area.statusText)
        };

      const facilityMatch =
        facilityAssignments.byFireBanForestName.get(forestName) ??
        ({
          facilities: buildUnknownFacilities(directory),
          matchedDirectoryForestName: null,
          score: null,
          matchType: "UNMATCHED"
        } satisfies FacilityMatchResult);

      const geocodeEntry = geocodeByForestKey.get(buildForestStatusKey(forestName));
      const latitude = geocodeEntry?.latitude ?? null;
      const longitude = geocodeEntry?.longitude ?? null;

      const totalFireBanLookup = totalFireBanService.lookupStatusByCoordinates(
        totalFireBanSnapshot,
        latitude,
        longitude
      );

      if (totalFireBanLookup.lookupCode === "NO_AREA_MATCH") {
        totalFireBanNoAreaMatchForests.add(forestName);
      } else if (totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS") {
        if (totalFireBanLookup.fireWeatherAreaName) {
          totalFireBanMissingStatusAreas.add(totalFireBanLookup.fireWeatherAreaName);
        }
      }

      points.push({
        id: slugify(forestName),
        source: SOURCE_NAME,
        areas: [{
          areaName: area.areaName,
          areaUrl: area.areaUrl,
          banStatus: area.status,
          banStatusText: normalizeBanStatusText(area.status, area.statusText),
          banScope: area.banScope
        }],
        forestName,
        forestUrl: facilityMatch.matchedDirectoryForestName
          ? (byForestUrl.get(facilityMatch.matchedDirectoryForestName) ?? null)
          : null,
        totalFireBanStatus: totalFireBanLookup.status,
        totalFireBanStatusText: totalFireBanLookup.statusText,
        totalFireBanDiagnostics: totalFireBanLookup.status === "UNKNOWN" ? {
          reason: totalFireBanLookup.lookupCode === "NO_COORDINATES"
            ? "Coordinates were unavailable, so Total Fire Ban lookup could not run."
            : totalFireBanLookup.lookupCode === "NO_AREA_MATCH"
              ? "Coordinates did not match a NSW RFS fire weather area polygon."
              : totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS"
                ? "A fire weather area was matched, but the status feed had no status entry for that area."
                : "Total Fire Ban source data was unavailable or incomplete during lookup.",
          lookupCode: totalFireBanLookup.lookupCode,
          fireWeatherAreaName: totalFireBanLookup.fireWeatherAreaName,
          debug: [
            `lookupCode=${totalFireBanLookup.lookupCode}`,
            `statusText=${totalFireBanLookup.statusText}`,
            `latitude=${latitude === null ? "null" : String(latitude)}`,
            `longitude=${longitude === null ? "null" : String(longitude)}`,
            `fireWeatherAreaName=${totalFireBanLookup.fireWeatherAreaName ?? "null"}`
          ]
        } : null,
        latitude,
        longitude,
        geocodeName: geocodeEntry?.displayName ?? null,
        geocodeDiagnostics: geocodeEntry?.diagnostics ?? null,
        facilities: facilityMatch.facilities
      });
    }
  }

  // Add unmatched directory forests
  const unmatchedFacilitiesForests = facilityAssignments.diagnostics.unmatchedFacilitiesForests;
  for (const forestName of unmatchedFacilitiesForests) {
    const geocodeEntry = geocodeByForestKey.get(buildForestStatusKey(forestName));
    const latitude = geocodeEntry?.latitude ?? null;
    const longitude = geocodeEntry?.longitude ?? null;

    const totalFireBanLookup = totalFireBanService.lookupStatusByCoordinates(
      totalFireBanSnapshot, latitude, longitude
    );

    if (totalFireBanLookup.lookupCode === "NO_AREA_MATCH") {
      totalFireBanNoAreaMatchForests.add(forestName);
    } else if (totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS") {
      if (totalFireBanLookup.fireWeatherAreaName) {
        totalFireBanMissingStatusAreas.add(totalFireBanLookup.fireWeatherAreaName);
      }
    }

    const directoryFacilities = createMatchedFacilities(directory, byForestName, [forestName]);

    points.push({
      id: slugify(forestName),
      source: SOURCE_NAME,
      areas: [{
        areaName: UNKNOWN_FIRE_BAN_AREA_NAME,
        areaUrl: FIRE_BAN_ENTRY_URL,
        banStatus: "UNKNOWN",
        banStatusText: UNKNOWN_FIRE_BAN_STATUS_TEXT,
        banScope: "ALL"
      }],
      forestName,
      forestUrl: byForestUrl.get(forestName) ?? null,
      totalFireBanStatus: totalFireBanLookup.status,
      totalFireBanStatusText: totalFireBanLookup.statusText,
      totalFireBanDiagnostics: null,
      latitude,
      longitude,
      geocodeName: geocodeEntry?.displayName ?? null,
      geocodeDiagnostics: geocodeEntry?.diagnostics ?? null,
      facilities: directoryFacilities
    });
  }

  // Emit matching warnings
  if (unmatchedFacilitiesForests.length) {
    const sample = unmatchedFacilitiesForests.slice(0, 8);
    const suffix =
      unmatchedFacilitiesForests.length > sample.length
        ? ` (+${unmatchedFacilitiesForests.length - sample.length} more)`
        : "";
    warningSet.add(
      `Facilities page includes ${unmatchedFacilitiesForests.length} forest(s) not present on the Solid Fuel Fire Ban pages: ${sample.join(", ")}${suffix}.`
    );
  }

  const fuzzyMatchesList = facilityAssignments.diagnostics.fuzzyMatches;
  if (fuzzyMatchesList.length) {
    warningSet.add(
      `Applied fuzzy facilities matching for ${fuzzyMatchesList.length} forest name(s) with minor naming differences.`
    );
  }

  if (totalFireBanNoAreaMatchForests.size) {
    const unmatchedForests = [...totalFireBanNoAreaMatchForests].sort((left, right) =>
      left.localeCompare(right)
    );
    const sample = unmatchedForests.slice(0, 8);
    const suffix = unmatchedForests.length > sample.length
      ? ` (+${unmatchedForests.length - sample.length} more)`
      : "";
    warningSet.add(
      `Total Fire Ban area could not be matched for ${unmatchedForests.length} forest(s) using current coordinates: ${sample.join(", ")}${suffix}.`
    );
  }

  if (totalFireBanMissingStatusAreas.size) {
    const missingAreas = [...totalFireBanMissingStatusAreas].sort((left, right) =>
      left.localeCompare(right)
    );
    warningSet.add(
      `Total Fire Ban status feed did not include ${missingAreas.length} mapped fire weather area(s): ${missingAreas.join(", ")}.`
    );
  }

  // Closure matching
  const closureAssignments = buildClosureAssignments(
    closures,
    points.map((point) => point.forestName)
  );

  const pointsWithClosures = points.map((point) => {
    const notices = closureAssignments.byForestName.get(point.forestName) ?? [];
    return {
      ...point,
      closureStatus: buildClosureStatusFromNotices(notices),
      closureNotices: notices,
      closureTags: buildClosureTagsFromNotices(notices),
      closureImpactSummary: buildClosureImpactSummaryFromNotices(notices)
    };
  });

  if (closureAssignments.diagnostics.unmatchedNotices.length) {
    const sample = closureAssignments.diagnostics.unmatchedNotices
      .slice(0, 6)
      .map((notice) => notice.title);
    const suffix =
      closureAssignments.diagnostics.unmatchedNotices.length > sample.length
        ? ` (+${closureAssignments.diagnostics.unmatchedNotices.length - sample.length} more)`
        : "";
    warningSet.add(
      `Could not match ${closureAssignments.diagnostics.unmatchedNotices.length} closure notice(s) to Solid Fuel Fire Ban forest names: ${sample.join(", ")}${suffix}.`
    );
  }

  if (closureAssignments.diagnostics.fuzzyMatches.length) {
    warningSet.add(
      `Applied fuzzy closure notice matching for ${closureAssignments.diagnostics.fuzzyMatches.length} notice(s) with minor naming differences.`
    );
  }

  const mergedForests = mergeMultiAreaForests(pointsWithClosures);

  // Build final snapshot
  const savedSnapshot: PersistedSnapshot = {
    schemaVersion: SNAPSHOT_FORMAT_VERSION,
    fetchedAt: new Date().toISOString(),
    stale: false,
    sourceName: SOURCE_NAME,
    availableFacilities: directory.filters,
    availableClosureTags: CLOSURE_TAG_DEFINITIONS,
    matchDiagnostics: {
      unmatchedFacilitiesForests,
      fuzzyMatches: fuzzyMatchesList
    },
    closureDiagnostics: closureAssignments.diagnostics,
    forests: mergedForests,
    warnings: [...warningSet]
  };

  // Validate
  console.log("\n[assemble] Validating snapshot...");
  const validationErrors = validateSnapshot(savedSnapshot);

  if (validationErrors.length) {
    console.error("Snapshot validation FAILED:");
    for (const validationError of validationErrors) {
      console.error(`  ✗ ${validationError}`);
    }
    process.exit(1);
  }

  // Write snapshot
  const outputPath = resolve(SNAPSHOT_OUTPUT_PATH);
  const outputDirectory = dirname(outputPath);
  if (!existsSync(outputDirectory)) {
    mkdirSync(outputDirectory, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(savedSnapshot, null, 2));

  // Write metadata
  const forestsWithCoordinates = savedSnapshot.forests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  );
  const forestsNotBanned = savedSnapshot.forests.filter(
    (forest) => getForestBanStatus(forest.areas) === "NOT_BANNED"
  );
  const forestsBanned = savedSnapshot.forests.filter(
    (forest) => getForestBanStatus(forest.areas) === "BANNED"
  );
  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

  const metadataPath = outputPath.replace(/\.json$/, ".meta.json");
  writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        forestCount: savedSnapshot.forests.length,
        mappedForestCount: forestsWithCoordinates.length,
        allowedCount: forestsNotBanned.length,
        bannedCount: forestsBanned.length,
        warningCount: savedSnapshot.warnings.length,
        elapsedSeconds: Number(elapsedSeconds)
      },
      null,
      2
    )
  );

  // Summary
  console.log(`\n[assemble] Summary:`);
  console.log(`  Total forests: ${savedSnapshot.forests.length}`);
  console.log(`  With coordinates: ${forestsWithCoordinates.length}`);
  console.log(`  Campfire allowed: ${forestsNotBanned.length}`);
  console.log(`  Campfire banned: ${forestsBanned.length}`);
  console.log(`  Facilities defined: ${savedSnapshot.availableFacilities.length}`);
  console.log(`  Warnings: ${savedSnapshot.warnings.length}`);
  console.log(`  Schema version: ${savedSnapshot.schemaVersion ?? "unversioned"}`);
  console.log(`  Elapsed: ${elapsedSeconds}s`);

  if (savedSnapshot.warnings.length) {
    console.log("\nWarnings:");
    for (const warning of savedSnapshot.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  console.log(`\n✓ Snapshot saved to ${outputPath}`);
};

main().catch((error) => {
  console.error("Fatal error in assemble-snapshot:");
  console.error(error);
  process.exit(1);
});
