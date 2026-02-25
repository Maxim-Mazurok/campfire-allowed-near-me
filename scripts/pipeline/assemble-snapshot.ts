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
import { slugify } from "../../apps/api/src/utils/slugs.js";
import { normalizeForestLabel } from "../../apps/api/src/utils/forest-name-validation.js";
import {
  findBestForestNameMatch,
  normalizeForestNameForMatch
} from "../../apps/api/src/utils/fuzzy-forest-match.js";
import { getForestBanStatus } from "../../packages/shared/src/forest-helpers.js";
import type {
  BanStatus,
  ClosureImpactLevel,
  ClosureImpactSummary,
  ClosureMatchDiagnostics,
  ClosureStatus,
  ClosureTagDefinition,
  ClosureTagKey,
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestAreaReference,
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
const FACILITY_MATCH_THRESHOLD = 0.62;
const CLOSURE_MATCH_THRESHOLD = 0.68;
const FIRE_BAN_ENTRY_URL = "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const UNKNOWN_FIRE_BAN_AREA_NAME = "Not listed on Solid Fuel Fire Ban pages";
const UNKNOWN_FIRE_BAN_STATUS_TEXT = "Unknown (not listed on Solid Fuel Fire Ban pages)";
const SOURCE_NAME = "Forestry Corporation NSW";

const CLOSURE_TAG_DEFINITIONS: ClosureTagDefinition[] = [
  { key: "ROAD_ACCESS", label: "Road/trail access" },
  { key: "CAMPING", label: "Camping impact" },
  { key: "EVENT", label: "Event closure" },
  { key: "OPERATIONS", label: "Operations/safety" }
];

const CLOSURE_IMPACT_ORDER: Record<ClosureImpactLevel, number> = {
  NONE: 0,
  ADVISORY: 1,
  RESTRICTED: 2,
  CLOSED: 3,
  UNKNOWN: -1
};

const BAN_STATUS_PRIORITY: Record<BanStatus, number> = {
  UNKNOWN: 0,
  NOT_BANNED: 1,
  BANNED: 2
};

// ---------------------------------------------------------------------------
// Helpers (extracted from LiveForestDataService)
// ---------------------------------------------------------------------------

const normalizeBanStatusText = (status: BanStatus, statusText: string): string => {
  const normalized = statusText.trim();
  if (normalized) return normalized;
  if (status === "BANNED") return "Solid Fuel Fire Ban";
  if (status === "NOT_BANNED") return "No Solid Fuel Fire Ban";
  return "Unknown";
};

const buildForestStatusKey = (forestName: string): string =>
  normalizeForestLabel(forestName).toLowerCase();

interface ForestBanSummary {
  status: BanStatus;
  statusText: string;
}

const buildMostRestrictiveBanByForest = (
  areas: ForestAreaWithForests[]
): Map<string, ForestBanSummary> => {
  const byForest = new Map<string, ForestBanSummary>();
  for (const area of areas) {
    const uniqueForestNames = [...new Set(
      area.forests.map((forest) => normalizeForestLabel(forest)).filter(Boolean)
    )];
    const candidateSummary: ForestBanSummary = {
      status: area.status,
      statusText: normalizeBanStatusText(area.status, area.statusText)
    };
    for (const forestName of uniqueForestNames) {
      const key = buildForestStatusKey(forestName);
      const existingSummary = byForest.get(key);
      if (
        !existingSummary ||
        BAN_STATUS_PRIORITY[candidateSummary.status] >
          BAN_STATUS_PRIORITY[existingSummary.status]
      ) {
        byForest.set(key, candidateSummary);
      }
    }
  }
  return byForest;
};

const hasDirectionalConflict = (leftName: string, rightName: string): boolean => {
  const left = normalizeForestNameForMatch(leftName);
  const right = normalizeForestNameForMatch(rightName);
  if ((/\beast\b/.test(left) && /\bwest\b/.test(right)) || (/\bwest\b/.test(left) && /\beast\b/.test(right))) return true;
  if ((/\bnorth\b/.test(left) && /\bsouth\b/.test(right)) || (/\bsouth\b/.test(left) && /\bnorth\b/.test(right))) return true;
  return false;
};

const buildUnknownFacilities = (directory: ForestDirectorySnapshot): Record<string, FacilityValue> =>
  Object.fromEntries(directory.filters.map((facility) => [facility.key, null])) as Record<string, FacilityValue>;

const createMatchedFacilities = (
  directory: ForestDirectorySnapshot,
  byForestName: Map<string, Record<string, boolean>>,
  sourceForestNames: string[]
): Record<string, FacilityValue> =>
  Object.fromEntries(
    directory.filters.map((filter) => [
      filter.key,
      sourceForestNames.some((name) => Boolean(byForestName.get(name)?.[filter.key]))
    ])
  ) as Record<string, FacilityValue>;

interface FacilityMatchResult {
  facilities: Record<string, FacilityValue>;
  matchedDirectoryForestName: string | null;
  score: number | null;
  matchType: "EXACT" | "FUZZY" | "UNMATCHED";
}

const buildFacilityAssignments = (
  fireBanForestNames: string[],
  directory: ForestDirectorySnapshot,
  byForestName: Map<string, Record<string, boolean>>
): {
  byFireBanForestName: Map<string, FacilityMatchResult>;
  diagnostics: FacilityMatchDiagnostics;
} => {
  const byFireBanForestName = new Map<string, FacilityMatchResult>();
  const unknown = buildUnknownFacilities(directory);

  if (!directory.filters.length || !directory.forests.length) {
    for (const forestName of fireBanForestNames) {
      byFireBanForestName.set(forestName, {
        facilities: unknown,
        matchedDirectoryForestName: null,
        score: null,
        matchType: "UNMATCHED"
      });
    }
    return {
      byFireBanForestName,
      diagnostics: {
        unmatchedFacilitiesForests: directory.forests.map((entry) => entry.forestName),
        fuzzyMatches: []
      }
    };
  }

  const uniqueFireBanNames = [...new Set(fireBanForestNames)];
  const availableDirectoryNames = new Set(byForestName.keys());
  const byNormalizedDirectoryName = new Map<string, string[]>();
  const fireBanCountByNormalizedName = new Map<string, number>();

  for (const fireBanForestName of uniqueFireBanNames) {
    const normalized = normalizeForestNameForMatch(fireBanForestName);
    fireBanCountByNormalizedName.set(
      normalized,
      (fireBanCountByNormalizedName.get(normalized) ?? 0) + 1
    );
  }

  for (const directoryForestName of availableDirectoryNames) {
    const normalized = normalizeForestNameForMatch(directoryForestName);
    const rows = byNormalizedDirectoryName.get(normalized) ?? [];
    rows.push(directoryForestName);
    byNormalizedDirectoryName.set(normalized, rows);
  }

  const unresolvedFireBanNames: string[] = [];

  for (const fireBanForestName of uniqueFireBanNames) {
    const normalized = normalizeForestNameForMatch(fireBanForestName);
    const exactCandidates = (byNormalizedDirectoryName.get(normalized) ?? [])
      .filter((candidate) => availableDirectoryNames.has(candidate))
      .sort((left, right) => left.localeCompare(right));

    if (!exactCandidates.length) {
      unresolvedFireBanNames.push(fireBanForestName);
      continue;
    }

    const allowVariantMerge =
      exactCandidates.length > 1 && (fireBanCountByNormalizedName.get(normalized) ?? 0) === 1;
    const matchedExactNames = allowVariantMerge ? exactCandidates : [exactCandidates[0]!];

    byFireBanForestName.set(fireBanForestName, {
      facilities: createMatchedFacilities(directory, byForestName, matchedExactNames),
      matchedDirectoryForestName: matchedExactNames[0]!,
      score: 1,
      matchType: "EXACT"
    });
    for (const matchedName of matchedExactNames) {
      availableDirectoryNames.delete(matchedName);
    }
  }

  for (const fireBanForestName of unresolvedFireBanNames) {
    const candidates = [...availableDirectoryNames];
    const fuzzy = findBestForestNameMatch(fireBanForestName, candidates);

    if (
      !fuzzy ||
      fuzzy.score < FACILITY_MATCH_THRESHOLD ||
      hasDirectionalConflict(fireBanForestName, fuzzy.candidateName)
    ) {
      byFireBanForestName.set(fireBanForestName, {
        facilities: unknown,
        matchedDirectoryForestName: null,
        score: fuzzy?.score ?? null,
        matchType: "UNMATCHED"
      });
      continue;
    }

    byFireBanForestName.set(fireBanForestName, {
      facilities: createMatchedFacilities(directory, byForestName, [fuzzy.candidateName]),
      matchedDirectoryForestName: fuzzy.candidateName,
      score: fuzzy.score,
      matchType: "FUZZY"
    });
    availableDirectoryNames.delete(fuzzy.candidateName);
  }

  const fuzzyMatches = [...byFireBanForestName.entries()]
    .filter(([, match]) => match.matchType === "FUZZY")
    .map(([fireBanForestName, match]) => ({
      fireBanForestName,
      facilitiesForestName: match.matchedDirectoryForestName!,
      score: match.score ?? 0
    }))
    .sort((left, right) => left.fireBanForestName.localeCompare(right.fireBanForestName));

  return {
    byFireBanForestName,
    diagnostics: {
      unmatchedFacilitiesForests: [...availableDirectoryNames].sort((left, right) =>
        left.localeCompare(right)
      ),
      fuzzyMatches
    }
  };
};

// ---------------------------------------------------------------------------
// Closure matching
// ---------------------------------------------------------------------------

const isClosureNoticeActive = (notice: ForestClosureNotice, nowMs: number): boolean => {
  const listedAtMs = notice.listedAt ? Date.parse(notice.listedAt) : Number.NaN;
  if (!Number.isNaN(listedAtMs) && listedAtMs > nowMs) return false;
  const untilAtMs = notice.untilAt ? Date.parse(notice.untilAt) : Number.NaN;
  if (!Number.isNaN(untilAtMs) && untilAtMs < nowMs) return false;
  return true;
};

const mergeClosureImpactLevel = (
  leftImpact: ClosureImpactLevel,
  rightImpact: ClosureImpactLevel
): ClosureImpactLevel =>
  CLOSURE_IMPACT_ORDER[rightImpact] > CLOSURE_IMPACT_ORDER[leftImpact] ? rightImpact : leftImpact;

const buildClosureTagsFromNotices = (
  notices: ForestClosureNotice[]
): Partial<Record<ClosureTagKey, boolean>> => {
  const tags: Partial<Record<ClosureTagKey, boolean>> = Object.fromEntries(
    CLOSURE_TAG_DEFINITIONS.map((definition) => [definition.key, false])
  ) as Partial<Record<ClosureTagKey, boolean>>;
  for (const notice of notices) {
    for (const tagKey of notice.tags) {
      tags[tagKey] = true;
    }
  }
  return tags;
};

const buildClosureStatusFromNotices = (notices: ForestClosureNotice[]): ClosureStatus => {
  if (notices.some((notice) => notice.status === "CLOSED")) return "CLOSED";
  if (notices.some((notice) => notice.status === "PARTIAL")) return "PARTIAL";
  if (notices.length > 0) return "NOTICE";
  return "NONE";
};

const buildClosureImpactSummaryFromNotices = (
  notices: ForestClosureNotice[]
): ClosureImpactSummary => {
  const summary: ClosureImpactSummary = {
    campingImpact: "NONE",
    access2wdImpact: "NONE",
    access4wdImpact: "NONE"
  };
  for (const notice of notices) {
    const impact = notice.structuredImpact;
    if (!impact) continue;
    summary.campingImpact = mergeClosureImpactLevel(summary.campingImpact, impact.campingImpact);
    summary.access2wdImpact = mergeClosureImpactLevel(summary.access2wdImpact, impact.access2wdImpact);
    summary.access4wdImpact = mergeClosureImpactLevel(summary.access4wdImpact, impact.access4wdImpact);
  }
  return summary;
};

const buildClosureAssignments = (
  notices: ForestClosureNotice[],
  forestNames: string[]
): {
  byForestName: Map<string, ForestClosureNotice[]>;
  diagnostics: ClosureMatchDiagnostics;
} => {
  const byForestName = new Map<string, ForestClosureNotice[]>();
  for (const forestName of forestNames) {
    byForestName.set(forestName, []);
  }

  const unmatchedNotices: ForestClosureNotice[] = [];
  const fuzzyMatches: ClosureMatchDiagnostics["fuzzyMatches"] = [];
  const nowMs = Date.now();

  for (const notice of notices) {
    if (!isClosureNoticeActive(notice, nowMs)) continue;

    const hint = notice.forestNameHint ? normalizeForestLabel(notice.forestNameHint) : "";
    if (!hint) {
      unmatchedNotices.push(notice);
      continue;
    }

    const exactMatchForestName = forestNames.find(
      (forestName) => normalizeForestLabel(forestName) === hint
    );

    if (exactMatchForestName) {
      const existing = byForestName.get(exactMatchForestName) ?? [];
      existing.push(notice);
      byForestName.set(exactMatchForestName, existing);
      continue;
    }

    const fuzzyMatch = findBestForestNameMatch(hint, forestNames);
    if (!fuzzyMatch || fuzzyMatch.score < CLOSURE_MATCH_THRESHOLD) {
      unmatchedNotices.push(notice);
      continue;
    }

    const existing = byForestName.get(fuzzyMatch.candidateName) ?? [];
    existing.push(notice);
    byForestName.set(fuzzyMatch.candidateName, existing);
    fuzzyMatches.push({
      noticeId: notice.id,
      noticeTitle: notice.title,
      matchedForestName: fuzzyMatch.candidateName,
      score: fuzzyMatch.score
    });
  }

  return {
    byForestName,
    diagnostics: { unmatchedNotices, fuzzyMatches }
  };
};

// ---------------------------------------------------------------------------
// Multi-area forest merge
// ---------------------------------------------------------------------------

const mergeMultiAreaForests = (
  points: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[]
): Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[] => {
  const groupsByForestKey = new Map<
    string,
    Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[]
  >();
  const insertionOrder: string[] = [];

  for (const point of points) {
    const key = buildForestStatusKey(point.forestName);
    const existing = groupsByForestKey.get(key);
    if (existing) {
      existing.push(point);
    } else {
      groupsByForestKey.set(key, [point]);
      insertionOrder.push(key);
    }
  }

  const merged: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[] = [];

  for (const key of insertionOrder) {
    const group = groupsByForestKey.get(key);
    if (!group || group.length === 0) continue;

    if (group.length === 1) {
      const singlePoint = group[0];
      if (singlePoint) merged.push(singlePoint);
      continue;
    }

    const primary = group.reduce((best, candidate) => {
      const bestHasCoordinates = best.latitude !== null && best.longitude !== null;
      const candidateHasCoordinates = candidate.latitude !== null && candidate.longitude !== null;
      if (candidateHasCoordinates && !bestHasCoordinates) return candidate;
      if (!candidateHasCoordinates && bestHasCoordinates) return best;
      if (
        typeof candidate.geocodeConfidence === "number" &&
        (typeof best.geocodeConfidence !== "number" ||
          candidate.geocodeConfidence > best.geocodeConfidence)
      ) return candidate;
      return best;
    });

    const seenAreaKeys = new Set<string>();
    const mergedAreas: ForestAreaReference[] = [];
    for (const point of group) {
      for (const area of point.areas) {
        const areaKey = area.areaName.toLowerCase();
        if (!seenAreaKeys.has(areaKey)) {
          seenAreaKeys.add(areaKey);
          mergedAreas.push(area);
        }
      }
    }

    merged.push({
      ...primary,
      id: slugify(primary.forestName),
      areas: mergedAreas
    });
  }

  return merged;
};

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
          banStatusText: normalizeBanStatusText(area.status, area.statusText)
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
        geocodeConfidence: geocodeEntry?.confidence ?? null,
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
        banStatusText: UNKNOWN_FIRE_BAN_STATUS_TEXT
      }],
      forestName,
      forestUrl: byForestUrl.get(forestName) ?? null,
      totalFireBanStatus: totalFireBanLookup.status,
      totalFireBanStatusText: totalFireBanLookup.statusText,
      totalFireBanDiagnostics: null,
      latitude,
      longitude,
      geocodeName: geocodeEntry?.displayName ?? null,
      geocodeConfidence: geocodeEntry?.confidence ?? null,
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
