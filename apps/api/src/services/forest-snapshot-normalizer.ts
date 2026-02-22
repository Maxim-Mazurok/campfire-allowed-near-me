import type {
  ClosureImpactLevel,
  ClosureImpactSummary,
  ClosureMatchDiagnostics,
  ClosureStatus,
  ClosureTagDefinition,
  ClosureTagKey,
  FacilityMatchDiagnostics,
  FacilityValue,
  PersistedSnapshot
} from "../types/domain.js";
import {
  isLikelyStateForestName,
  normalizeForestLabel
} from "../utils/forest-name-validation.js";
import { UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT } from "./total-fire-ban-service.js";

export const CLOSURE_TAG_DEFINITIONS: ClosureTagDefinition[] = [
  { key: "ROAD_ACCESS", label: "Road/trail access" },
  { key: "CAMPING", label: "Camping impact" },
  { key: "EVENT", label: "Event closure" },
  { key: "OPERATIONS", label: "Operations/safety" }
];

export function isFacilitiesMismatchWarning(warning: string): boolean {
  return /Facilities page includes .* not present on the Solid Fuel Fire Ban pages/i.test(warning);
}

export function hasValidForestSampleInWarning(warning: string): boolean {
  if (!isFacilitiesMismatchWarning(warning)) {
    return true;
  }

  const separatorIndex = warning.indexOf(":");
  if (separatorIndex === -1) {
    return true;
  }

  const sampleSegment = warning
    .slice(separatorIndex + 1)
    .replace(/\(\+\d+\s+more\)\.?\s*$/i, "")
    .replace(/\.\s*$/, "");
  const sampleNames = sampleSegment
    .split(",")
    .map((entry) => normalizeForestLabel(entry))
    .filter(Boolean);

  if (!sampleNames.length) {
    return true;
  }

  return sampleNames.every((entry) => isLikelyStateForestName(entry));
}

export function sanitizeMatchDiagnostics(
  diagnostics: FacilityMatchDiagnostics | undefined
): FacilityMatchDiagnostics {
  const unmatchedFacilitiesForests = [
    ...new Set(
      (diagnostics?.unmatchedFacilitiesForests ?? [])
        .map((entry) => normalizeForestLabel(entry))
        .filter((entry) => isLikelyStateForestName(entry))
    )
  ].sort((left, right) => left.localeCompare(right));

  const fuzzyMatches = (diagnostics?.fuzzyMatches ?? [])
    .map((match) => ({
      fireBanForestName: normalizeForestLabel(match.fireBanForestName),
      facilitiesForestName: normalizeForestLabel(match.facilitiesForestName),
      score: match.score
    }))
    .filter(
      (match) =>
        isLikelyStateForestName(match.fireBanForestName) &&
        isLikelyStateForestName(match.facilitiesForestName)
    )
    .sort((left, right) => left.fireBanForestName.localeCompare(right.fireBanForestName));

  return {
    unmatchedFacilitiesForests,
    fuzzyMatches
  };
}

export function sanitizeClosureDiagnostics(
  diagnostics: ClosureMatchDiagnostics | undefined
): ClosureMatchDiagnostics {
  const unmatchedNotices = [...(diagnostics?.unmatchedNotices ?? [])];
  const fuzzyMatches = [...(diagnostics?.fuzzyMatches ?? [])]
    .filter(
      (match) =>
        typeof match.noticeId === "string" &&
        typeof match.noticeTitle === "string" &&
        typeof match.matchedForestName === "string" &&
        typeof match.score === "number"
    )
    .sort((left, right) => left.noticeTitle.localeCompare(right.noticeTitle));

  return {
    unmatchedNotices,
    fuzzyMatches
  };
}

export function toClosureStatus(value: unknown): ClosureStatus {
  if (value === "NONE" || value === "NOTICE" || value === "PARTIAL" || value === "CLOSED") {
    return value;
  }

  return "NONE";
}

export function toClosureImpactLevel(value: unknown): ClosureImpactLevel {
  if (
    value === "NONE" ||
    value === "ADVISORY" ||
    value === "RESTRICTED" ||
    value === "CLOSED" ||
    value === "UNKNOWN"
  ) {
    return value;
  }

  return "NONE";
}

export function sanitizeWarnings(warnings: string[]): string[] {
  return [...new Set(warnings)].filter((warning) => {
    if (/Facilities data could not be matched for/i.test(warning)) {
      return false;
    }

    if (!hasValidForestSampleInWarning(warning)) {
      return false;
    }

    return true;
  });
}

export function normalizeSnapshot(snapshot: PersistedSnapshot): PersistedSnapshot {
  const availableFacilities = snapshot.availableFacilities ?? [];
  const availableClosureTags = snapshot.availableClosureTags ?? CLOSURE_TAG_DEFINITIONS;
  const facilityKeys = availableFacilities.map((facility) => facility.key);
  const matchDiagnostics = sanitizeMatchDiagnostics(snapshot.matchDiagnostics);
  const closureDiagnostics = sanitizeClosureDiagnostics(snapshot.closureDiagnostics);
  const warnings = sanitizeWarnings(snapshot.warnings ?? []);

  const forests = snapshot.forests.map((forest) => {
    const existingFacilities = forest.facilities ?? {};
    const facilities = Object.fromEntries(
      facilityKeys.map((key) => {
        const value = existingFacilities[key];
        if (typeof value === "boolean") {
          return [key, value];
        }

        return [key, null];
      })
    ) as Record<string, FacilityValue>;

    const normalizedGeocodeDiagnostics =
      forest.geocodeDiagnostics &&
      typeof forest.geocodeDiagnostics === "object" &&
      typeof forest.geocodeDiagnostics.reason === "string"
        ? {
            reason: forest.geocodeDiagnostics.reason,
            debug: Array.isArray(forest.geocodeDiagnostics.debug)
              ? forest.geocodeDiagnostics.debug.filter((entry): entry is string =>
                  typeof entry === "string"
                )
              : []
          }
        : null;

    const normalizedTotalFireBanStatus =
      forest.totalFireBanStatus === "BANNED" ||
      forest.totalFireBanStatus === "NOT_BANNED" ||
      forest.totalFireBanStatus === "UNKNOWN"
        ? forest.totalFireBanStatus
        : "UNKNOWN";

    const normalizedTotalFireBanStatusText =
      typeof forest.totalFireBanStatusText === "string" && forest.totalFireBanStatusText.trim()
        ? forest.totalFireBanStatusText
        : normalizedTotalFireBanStatus === "BANNED"
          ? "Total Fire Ban"
          : normalizedTotalFireBanStatus === "NOT_BANNED"
            ? "No Total Fire Ban"
            : UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT;

    const normalizedTotalFireBanDiagnostics =
      forest.totalFireBanDiagnostics &&
      typeof forest.totalFireBanDiagnostics === "object" &&
      typeof forest.totalFireBanDiagnostics.reason === "string"
        ? {
            reason: forest.totalFireBanDiagnostics.reason,
            lookupCode:
              forest.totalFireBanDiagnostics.lookupCode === "MATCHED" ||
              forest.totalFireBanDiagnostics.lookupCode === "NO_COORDINATES" ||
              forest.totalFireBanDiagnostics.lookupCode === "NO_AREA_MATCH" ||
              forest.totalFireBanDiagnostics.lookupCode === "MISSING_AREA_STATUS" ||
              forest.totalFireBanDiagnostics.lookupCode === "DATA_UNAVAILABLE"
                ? forest.totalFireBanDiagnostics.lookupCode
                : "DATA_UNAVAILABLE",
            fireWeatherAreaName:
              typeof forest.totalFireBanDiagnostics.fireWeatherAreaName === "string" &&
              forest.totalFireBanDiagnostics.fireWeatherAreaName.trim()
                ? forest.totalFireBanDiagnostics.fireWeatherAreaName
                : null,
            debug: Array.isArray(forest.totalFireBanDiagnostics.debug)
              ? forest.totalFireBanDiagnostics.debug.filter((entry): entry is string =>
                  typeof entry === "string"
                )
              : []
          }
        : null;

    const closureStatus = toClosureStatus(forest.closureStatus);
    const closureNotices = Array.isArray(forest.closureNotices) ? forest.closureNotices : [];
    const closureTags = Object.fromEntries(
      CLOSURE_TAG_DEFINITIONS.map((definition) => [
        definition.key,
        forest.closureTags?.[definition.key] === true
      ])
    ) as Partial<Record<ClosureTagKey, boolean>>;
    const closureImpactSummary: ClosureImpactSummary = {
      campingImpact: toClosureImpactLevel(forest.closureImpactSummary?.campingImpact),
      access2wdImpact: toClosureImpactLevel(forest.closureImpactSummary?.access2wdImpact),
      access4wdImpact: toClosureImpactLevel(forest.closureImpactSummary?.access4wdImpact)
    };

    return {
      ...forest,
      forestUrl: typeof forest.forestUrl === "string" ? forest.forestUrl : null,
      totalFireBanStatus: normalizedTotalFireBanStatus,
      totalFireBanStatusText: normalizedTotalFireBanStatusText,
      totalFireBanDiagnostics: normalizedTotalFireBanDiagnostics,
      geocodeDiagnostics: normalizedGeocodeDiagnostics,
      facilities,
      closureStatus,
      closureNotices,
      closureTags,
      closureImpactSummary
    };
  });

  return {
    ...snapshot,
    schemaVersion: typeof snapshot.schemaVersion === "number" ? snapshot.schemaVersion : 0,
    availableFacilities,
    availableClosureTags,
    matchDiagnostics,
    closureDiagnostics,
    warnings,
    forests
  };
}
