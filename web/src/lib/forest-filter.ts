import type {
  ClosureTagKey,
  ForestPoint
} from "../../../shared/contracts.js";
import type {
  BanFilterMode,
  BanScopeFilterMode,
  ClosureStatusFilterMode,
  TriStateMode
} from "./app-domain-types";
import { getForestBanStatus, getForestBanScope } from "./api";
import {
  getForestClosureStatus,
  getForestImpactSummary,
  isImpactWarning,
  matchesBanFilter,
  matchesSolidFuelBanFilter
} from "./app-domain-status";

export interface ForestFilterConfig {
  solidFuelBanFilterMode: BanFilterMode;
  solidFuelBanScopeFilterMode: BanScopeFilterMode;
  totalFireBanFilterMode: BanFilterMode;
  closureStatusFilterMode: ClosureStatusFilterMode;
  hasNoticesFilterMode: TriStateMode;
  closureTagFilterModes: Record<string, TriStateMode>;
  facilityFilterModes: Record<string, TriStateMode>;
  impactCampingFilterMode: TriStateMode;
  impactAccess2wdFilterMode: TriStateMode;
  impactAccess4wdFilterMode: TriStateMode;
  availableClosureTags: readonly { key: ClosureTagKey }[];
  availableFacilities: readonly { key: string }[];
}

/**
 * Pure predicate: returns true when the forest passes every active filter.
 * Extracted from App.tsx so it can run on rawForests (before driving data)
 * and be reused to compute matchingForestIds early for route optimisation.
 */
export const matchesForestFilters = (
  forest: ForestPoint,
  config: ForestFilterConfig
): boolean => {
  if (
    !matchesSolidFuelBanFilter(
      config.solidFuelBanFilterMode,
      config.solidFuelBanScopeFilterMode,
      getForestBanStatus(forest.areas),
      getForestBanScope(forest.areas)
    )
  ) {
    return false;
  }

  if (!matchesBanFilter(config.totalFireBanFilterMode, forest.totalFireBanStatus)) {
    return false;
  }

  const closureStatus = getForestClosureStatus(forest);

  if (config.closureStatusFilterMode === "OPEN" && closureStatus !== "NONE") {
    return false;
  }

  if (
    config.closureStatusFilterMode === "PARTIAL" &&
    closureStatus !== "PARTIAL" &&
    closureStatus !== "NOTICE"
  ) {
    return false;
  }

  if (config.closureStatusFilterMode === "CLOSED" && closureStatus !== "CLOSED") {
    return false;
  }

  const hasNotices = (forest.closureNotices ?? []).length > 0;

  if (config.hasNoticesFilterMode === "INCLUDE" && !hasNotices) {
    return false;
  }

  if (config.hasNoticesFilterMode === "EXCLUDE" && hasNotices) {
    return false;
  }

  for (const closureTag of config.availableClosureTags) {
    const mode = config.closureTagFilterModes[closureTag.key] ?? "ANY";
    if (mode === "ANY") {
      continue;
    }

    const value = forest.closureTags?.[closureTag.key] === true;

    if (mode === "INCLUDE" && !value) {
      return false;
    }

    if (mode === "EXCLUDE" && value) {
      return false;
    }
  }

  const impactSummary = getForestImpactSummary(forest);
  const hasCampingImpactWarning = isImpactWarning(impactSummary.campingImpact);
  const hasAccess2wdImpactWarning = isImpactWarning(impactSummary.access2wdImpact);
  const hasAccess4wdImpactWarning = isImpactWarning(impactSummary.access4wdImpact);

  if (config.impactCampingFilterMode === "INCLUDE" && !hasCampingImpactWarning) {
    return false;
  }

  if (config.impactCampingFilterMode === "EXCLUDE" && hasCampingImpactWarning) {
    return false;
  }

  if (config.impactAccess2wdFilterMode === "INCLUDE" && !hasAccess2wdImpactWarning) {
    return false;
  }

  if (config.impactAccess2wdFilterMode === "EXCLUDE" && hasAccess2wdImpactWarning) {
    return false;
  }

  if (config.impactAccess4wdFilterMode === "INCLUDE" && !hasAccess4wdImpactWarning) {
    return false;
  }

  if (config.impactAccess4wdFilterMode === "EXCLUDE" && hasAccess4wdImpactWarning) {
    return false;
  }

  for (const facility of config.availableFacilities) {
    const mode = config.facilityFilterModes[facility.key] ?? "ANY";
    if (mode === "ANY") {
      continue;
    }

    const value = forest.facilities[facility.key];

    if (mode === "INCLUDE" && value !== true) {
      return false;
    }

    if (mode === "EXCLUDE" && value !== false) {
      return false;
    }
  }

  return true;
};
