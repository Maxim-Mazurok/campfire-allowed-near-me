import type { BanStatus, ClosureImpactLevel, ForestApiResponse } from "./api";
import type { BanFilterMode } from "./app-domain-types";

export const matchesBanFilter = (
  mode: BanFilterMode,
  status: BanStatus
): boolean => {
  if (mode === "ALL") {
    return true;
  }

  return status === mode;
};

export const getSolidFuelStatusLabel = (
  status: BanStatus
): string => {
  if (status === "NOT_BANNED") {
    return "Solid fuel: not banned";
  }

  if (status === "BANNED") {
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
