import type { BanStatus, ClosureImpactLevel, ForestApiResponse, SolidFuelBanScope } from "./api";
import type { BanFilterMode, BanScopeFilterMode } from "./app-domain-types";

export const matchesBanFilter = (
  mode: BanFilterMode,
  status: BanStatus
): boolean => {
  if (mode === "ALL") {
    return true;
  }

  return status === mode;
};

/**
 * Scope-aware filter for solid fuel fire ban.
 *
 * The scope sub-filter answers the question "Is fire allowed/banned WHERE?"
 * relative to designated campgrounds:
 *
 * | banStatus   | banScope        | fire in camps? | fire outside camps? |
 * |-------------|-----------------|----------------|---------------------|
 * | NOT_BANNED  | ALL             | allowed        | allowed             |
 * | BANNED      | ALL             | banned         | banned              |
 * | BANNED      | OUTSIDE_CAMPS   | allowed        | banned              |
 * | BANNED      | INCLUDING_CAMPS | banned         | banned              |
 *
 * When scopeMode is ANYWHERE the scope is ignored (standard behaviour).
 */
export const matchesSolidFuelBanFilter = (
  banMode: BanFilterMode,
  scopeMode: BanScopeFilterMode,
  banStatus: BanStatus,
  banScope: SolidFuelBanScope
): boolean => {
  // Primary filter: ALL means show everything regardless of ban or scope
  if (banMode === "ALL") {
    return true;
  }

  // UNKNOWN status: only matched by the "UNKNOWN" primary filter
  if (banStatus === "UNKNOWN") {
    return banMode === "UNKNOWN";
  }

  // When scope sub-filter is ANYWHERE, fall back to simple status check
  if (scopeMode === "ANYWHERE") {
    return banStatus === banMode;
  }

  // Derive whether fire is allowed/banned in the queried location
  const fireAllowedInCamps = banStatus === "NOT_BANNED" || banScope === "OUTSIDE_CAMPS";
  const fireAllowedOutsideCamps = banStatus === "NOT_BANNED";

  if (banMode === "NOT_BANNED") {
    // "Not banned" + "Camps": show forests where fire IS allowed in camps
    if (scopeMode === "CAMPS") {
      return fireAllowedInCamps;
    }

    // "Not banned" + "Not camps": show forests where fire IS allowed outside camps
    return fireAllowedOutsideCamps;
  }

  // banMode === "BANNED"
  // "Banned" + "Camps": show forests where fire IS banned in camps
  if (scopeMode === "CAMPS") {
    return !fireAllowedInCamps;
  }

  // "Banned" + "Not camps": show forests where fire IS banned outside camps
  return !fireAllowedOutsideCamps;
};

export const getSolidFuelStatusLabel = (
  status: BanStatus,
  scope?: SolidFuelBanScope
): string => {
  if (status === "NOT_BANNED") {
    return "Solid fuel: not banned";
  }

  if (status === "BANNED") {
    if (scope === "OUTSIDE_CAMPS") {
      return "Solid fuel: banned outside camps";
    }

    if (scope === "INCLUDING_CAMPS") {
      return "Solid fuel: banned (incl. camps)";
    }

    return "Solid fuel: banned";
  }

  return "Solid fuel: unknown";
};

export const getTotalFireBanStatusLabel = (
  status: ForestApiResponse["forests"][number]["totalFireBanStatus"]
): string => {
  if (status === "NOT_BANNED") {
    return "No Total Fire Ban";
  }

  if (status === "BANNED") {
    return "Total Fire Ban";
  }

  return "Total Fire Ban: unknown";
};

export const getForestClosureStatus = (
  forest: ForestApiResponse["forests"][number]
): "NONE" | "NOTICE" | "PARTIAL" | "CLOSED" => {
  const status = forest.closureStatus;
  if (status === "NONE" || status === "NOTICE" || status === "PARTIAL" || status === "CLOSED") {
    return status;
  }

  return "NONE";
};

export const getClosureStatusLabel = (
  status: "NONE" | "NOTICE" | "PARTIAL" | "CLOSED"
): string => {
  if (status === "CLOSED") {
    return "Closed";
  }

  if (status === "PARTIAL") {
    return "Partly closed";
  }

  if (status === "NOTICE") {
    return "Notice";
  }

  return "No notice";
};

const CLOSURE_IMPACT_ORDER: Record<ClosureImpactLevel, number> = {
  NONE: 0,
  ADVISORY: 1,
  RESTRICTED: 2,
  CLOSED: 3,
  UNKNOWN: -1
};

const mergeImpactLevel = (
  leftImpact: ClosureImpactLevel,
  rightImpact: ClosureImpactLevel
): ClosureImpactLevel => {
  if (CLOSURE_IMPACT_ORDER[rightImpact] > CLOSURE_IMPACT_ORDER[leftImpact]) {
    return rightImpact;
  }

  return leftImpact;
};

export const isImpactWarning = (impactLevel: ClosureImpactLevel): boolean =>
  impactLevel === "RESTRICTED" || impactLevel === "CLOSED";

export type ForestImpactSummary = {
  campingImpact: ClosureImpactLevel;
  access2wdImpact: ClosureImpactLevel;
  access4wdImpact: ClosureImpactLevel;
};

export const getForestImpactSummary = (
  forest: ForestApiResponse["forests"][number]
): ForestImpactSummary => {
  const summary = forest.closureImpactSummary;
  if (summary) {
    return {
      campingImpact: summary.campingImpact,
      access2wdImpact: summary.access2wdImpact,
      access4wdImpact: summary.access4wdImpact
    };
  }

  const fallback: ForestImpactSummary = {
    campingImpact: "NONE",
    access2wdImpact: "NONE",
    access4wdImpact: "NONE"
  };

  for (const notice of forest.closureNotices ?? []) {
    const impact = notice.structuredImpact;
    if (!impact) {
      continue;
    }

    fallback.campingImpact = mergeImpactLevel(fallback.campingImpact, impact.campingImpact);
    fallback.access2wdImpact = mergeImpactLevel(fallback.access2wdImpact, impact.access2wdImpact);
    fallback.access4wdImpact = mergeImpactLevel(fallback.access4wdImpact, impact.access4wdImpact);
  }

  return fallback;
};

export type FacilityImpactTarget = "CAMPING" | "ACCESS_2WD" | "ACCESS_4WD" | null;

export const inferFacilityImpactTarget = (
  facility: ForestApiResponse["availableFacilities"][number]
): FacilityImpactTarget => {
  const text = `${facility.iconKey} ${facility.label} ${facility.paramName}`.toLowerCase();

  if (/camp/.test(text)) {
    return "CAMPING";
  }

  if (/2wd|two.?wheel/.test(text)) {
    return "ACCESS_2WD";
  }

  if (/4wd|four.?wheel/.test(text)) {
    return "ACCESS_4WD";
  }

  return null;
};
