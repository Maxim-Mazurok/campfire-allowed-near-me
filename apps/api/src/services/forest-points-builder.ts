import { slugify } from "../utils/slugs.js";
import type {
  ClosureMatchDiagnostics,
  FacilityMatchDiagnostics,
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDataServiceInput,
  ForestDirectorySnapshot,
  ForestPoint
} from "../types/domain.js";
import type { OSMGeocoder } from "./osm-geocoder.js";
import type { TotalFireBanService, TotalFireBanSnapshot } from "./total-fire-ban-service.js";
import {
  buildForestStatusKey,
  buildMostRestrictiveBanByForest,
  normalizeBanStatusText
} from "./forest-ban-helpers.js";
import {
  buildFacilityAssignments,
  buildUnknownFacilities,
  createMatchedFacilities,
  type FacilityMatchResult
} from "./forest-facility-assignment.js";
import {
  buildClosureAssignments,
  buildClosureImpactSummaryFromNotices,
  buildClosureStatusFromNotices,
  buildClosureTagsFromNotices
} from "./forest-closure-assignment.js";
import {
  buildGeocodeDiagnostics,
  buildTotalFireBanDiagnostics,
  collectGeocodeWarnings,
  shouldUseAreaFallbackForForestLookup
} from "./forest-geocode-diagnostics.js";

const FIRE_BAN_ENTRY_URL =
  "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const UNKNOWN_FIRE_BAN_AREA_NAME = "Not listed on Solid Fuel Fire Ban pages";
const UNKNOWN_FIRE_BAN_STATUS_TEXT =
  "Unknown (not listed on Solid Fuel Fire Ban pages)";

export async function buildForestPoints(
  areas: ForestAreaWithForests[],
  directory: ForestDirectorySnapshot,
  closureNotices: ForestClosureNotice[],
  totalFireBanSnapshot: TotalFireBanSnapshot,
  warningSet: Set<string>,
  unresolvedForestStatusKeys: Set<string>,
  progressCallback: ForestDataServiceInput["progressCallback"] | undefined,
  geocoder: OSMGeocoder,
  totalFireBanService: TotalFireBanService,
  sourceName: string
): Promise<{
  forests: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[];
  diagnostics: FacilityMatchDiagnostics;
  closureDiagnostics: ClosureMatchDiagnostics;
}> {
  if ("resetLookupBudgetForRun" in geocoder) {
    (geocoder as { resetLookupBudgetForRun(): void }).resetLookupBudgetForRun();
  }

  const points: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[] = [];
  const areaGeocodeMap = new Map<string, Awaited<ReturnType<OSMGeocoder["geocodeArea"]>>>();
  const byForestName = new Map(
    directory.forests.map((entry) => [entry.forestName, entry.facilities] as const)
  );
  const byForestUrl = new Map(
    directory.forests.map((entry) => [entry.forestName, entry.forestUrl ?? null] as const)
  );
  const mostRestrictiveBanByForest = buildMostRestrictiveBanByForest(areas);
  const uniqueFireBanNames = [...new Set(
    areas.flatMap((area) => area.forests.map((forest) => forest.trim()).filter(Boolean))
  )];
  const facilityAssignments = buildFacilityAssignments(
    uniqueFireBanNames,
    directory,
    byForestName
  );
  const totalForestGeocodeCount =
    areas.reduce(
      (runningTotal, area) =>
        runningTotal + new Set(area.forests.map((forest) => forest.trim()).filter(Boolean)).size,
      0
    ) + facilityAssignments.diagnostics.unmatchedFacilitiesForests.length;
  const totalFireBanNoAreaMatchForests = new Set<string>();
  const totalFireBanMissingStatusAreas = new Set<string>();
  let completedAreaGeocodes = 0;
  let completedForestGeocodes = 0;

  progressCallback?.({
    phase: "GEOCODE_AREAS",
    message: "Resolving area coordinates.",
    completed: completedAreaGeocodes,
    total: areas.length
  });

  // Prioritize one lookup per area first so every forest can fall back to an area centroid.
  for (const area of areas) {
    const areaGeocode = await geocoder.geocodeArea(area.areaName, area.areaUrl);
    areaGeocodeMap.set(area.areaUrl, areaGeocode);
    collectGeocodeWarnings(warningSet, areaGeocode);
    completedAreaGeocodes += 1;
    progressCallback?.({
      phase: "GEOCODE_AREAS",
      message: `Resolving area coordinates (${completedAreaGeocodes}/${areas.length}).`,
      completed: completedAreaGeocodes,
      total: areas.length
    });
  }

  progressCallback?.({
    phase: "GEOCODE_FORESTS",
    message: "Resolving forest coordinates.",
    completed: completedForestGeocodes,
    total: totalForestGeocodeCount
  });

  if ("resetLookupBudgetForRun" in geocoder) {
    (geocoder as { resetLookupBudgetForRun(): void }).resetLookupBudgetForRun();
  }

  const sortForestNamesForRetryPriority = (forestNames: string[]): string[] =>
    [...forestNames].sort((leftForestName, rightForestName) => {
      const leftPriority = unresolvedForestStatusKeys.has(buildForestStatusKey(leftForestName))
        ? 0
        : 1;
      const rightPriority = unresolvedForestStatusKeys.has(buildForestStatusKey(rightForestName))
        ? 0
        : 1;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      return leftForestName.localeCompare(rightForestName);
    });

  for (const area of areas) {
    const uniqueForestNames = sortForestNamesForRetryPriority(
      [...new Set(area.forests.map((forest) => forest.trim()).filter(Boolean))]
    );
    const areaGeocode = areaGeocodeMap.get(area.areaUrl) ?? {
      latitude: null,
      longitude: null,
      displayName: null,
      confidence: null,
      provider: null
    };

    for (const forestName of uniqueForestNames) {
      if (!forestName) {
        continue;
      }

      const banSummary =
        mostRestrictiveBanByForest.get(buildForestStatusKey(forestName)) ?? {
          status: area.status,
          statusText: normalizeBanStatusText(area.status, area.statusText)
        };
      const geocode = await geocoder.geocodeForest(forestName, area.areaName);
      collectGeocodeWarnings(warningSet, geocode);
      completedForestGeocodes += 1;
      progressCallback?.({
        phase: "GEOCODE_FORESTS",
        message: `Resolving forest coordinates (${completedForestGeocodes}/${totalForestGeocodeCount}).`,
        completed: completedForestGeocodes,
        total: totalForestGeocodeCount
      });
      const usedAreaFallback =
        geocode.latitude === null &&
        areaGeocode.latitude !== null &&
        shouldUseAreaFallbackForForestLookup(geocode);
      const resolvedLatitude = usedAreaFallback ? areaGeocode.latitude : geocode.latitude;
      const resolvedLongitude = usedAreaFallback ? areaGeocode.longitude : geocode.longitude;
      const geocodeDiagnostics =
        resolvedLatitude === null || resolvedLongitude === null
          ? buildGeocodeDiagnostics(geocode, areaGeocode)
          : null;
      const facilityMatch =
        facilityAssignments.byFireBanForestName.get(forestName) ??
        ({
          facilities: buildUnknownFacilities(directory),
          matchedDirectoryForestName: null,
          score: null,
          matchType: "UNMATCHED"
        } satisfies FacilityMatchResult);
      const totalFireBanLookup = totalFireBanService.lookupStatusByCoordinates(
        totalFireBanSnapshot,
        resolvedLatitude,
        resolvedLongitude
      );
      const totalFireBanDiagnostics = buildTotalFireBanDiagnostics(
        totalFireBanLookup,
        resolvedLatitude,
        resolvedLongitude,
        totalFireBanSnapshot
      );

      if (totalFireBanLookup.lookupCode === "NO_AREA_MATCH") {
        totalFireBanNoAreaMatchForests.add(forestName);
      } else if (totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS") {
        if (totalFireBanLookup.fireWeatherAreaName) {
          totalFireBanMissingStatusAreas.add(totalFireBanLookup.fireWeatherAreaName);
        }
      }

      points.push({
        id: `${slugify(area.areaName)}-${slugify(forestName)}`,
        source: sourceName,
        areaName: area.areaName,
        areaUrl: area.areaUrl,
        forestName,
        forestUrl: facilityMatch.matchedDirectoryForestName
          ? (byForestUrl.get(facilityMatch.matchedDirectoryForestName) ?? null)
          : null,
        banStatus: banSummary.status,
        banStatusText: banSummary.statusText,
        totalFireBanStatus: totalFireBanLookup.status,
        totalFireBanStatusText: totalFireBanLookup.statusText,
        totalFireBanDiagnostics,
        latitude: resolvedLatitude,
        longitude: resolvedLongitude,
        geocodeName: usedAreaFallback
          ? `${areaGeocode.displayName} (area centroid approximation)`
          : geocode.displayName,
        geocodeConfidence: geocode.confidence ?? areaGeocode.confidence,
        geocodeDiagnostics,
        facilities: facilityMatch.facilities
      });
    }
  }

  const unmatchedFacilitiesForests = sortForestNamesForRetryPriority(
    facilityAssignments.diagnostics.unmatchedFacilitiesForests
  );

  for (const forestName of unmatchedFacilitiesForests) {
    const geocode = await geocoder.geocodeForest(forestName);
    collectGeocodeWarnings(warningSet, geocode);
    completedForestGeocodes += 1;
    progressCallback?.({
      phase: "GEOCODE_FORESTS",
      message: `Resolving forest coordinates (${completedForestGeocodes}/${totalForestGeocodeCount}).`,
      completed: completedForestGeocodes,
      total: totalForestGeocodeCount
    });
    const geocodeDiagnostics =
      geocode.latitude === null || geocode.longitude === null
        ? buildGeocodeDiagnostics(geocode)
        : null;
    const directoryFacilities = createMatchedFacilities(directory, byForestName, [forestName]);
    const totalFireBanLookup = totalFireBanService.lookupStatusByCoordinates(
      totalFireBanSnapshot,
      geocode.latitude,
      geocode.longitude
    );
    const totalFireBanDiagnostics = buildTotalFireBanDiagnostics(
      totalFireBanLookup,
      geocode.latitude,
      geocode.longitude,
      totalFireBanSnapshot
    );

    if (totalFireBanLookup.lookupCode === "NO_AREA_MATCH") {
      totalFireBanNoAreaMatchForests.add(forestName);
    } else if (totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS") {
      if (totalFireBanLookup.fireWeatherAreaName) {
        totalFireBanMissingStatusAreas.add(totalFireBanLookup.fireWeatherAreaName);
      }
    }

    points.push({
      id: `${slugify("unmatched-fire-ban")}-${slugify(forestName)}`,
      source: sourceName,
      areaName: UNKNOWN_FIRE_BAN_AREA_NAME,
      areaUrl: FIRE_BAN_ENTRY_URL,
      forestName,
      forestUrl: byForestUrl.get(forestName) ?? null,
      banStatus: "UNKNOWN",
      banStatusText: UNKNOWN_FIRE_BAN_STATUS_TEXT,
      totalFireBanStatus: totalFireBanLookup.status,
      totalFireBanStatusText: totalFireBanLookup.statusText,
      totalFireBanDiagnostics,
      latitude: geocode.latitude,
      longitude: geocode.longitude,
      geocodeName: geocode.displayName,
      geocodeConfidence: geocode.confidence,
      geocodeDiagnostics,
      facilities: directoryFacilities
    });
  }

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
    const suffix =
      unmatchedForests.length > sample.length
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

  const closureAssignments = buildClosureAssignments(
    closureNotices,
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

  return {
    forests: pointsWithClosures,
    diagnostics: {
      unmatchedFacilitiesForests,
      fuzzyMatches: fuzzyMatchesList
    },
    closureDiagnostics: closureAssignments.diagnostics
  };
}
