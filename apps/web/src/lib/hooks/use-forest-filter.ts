import { useMemo } from "react";
import type { ClosureTagDefinition, FacilityDefinition, ForestPoint } from "../api.js";
import type { BanFilterMode, ClosureFilterMode, TriStateMode } from "../app-domain-types.js";
import {
  getForestClosureStatus,
  getForestImpactSummary,
  isImpactWarning,
  matchesBanFilter
} from "../app-domain-status.js";

interface UseForestFilterInput {
  forests: ForestPoint[];
  availableFacilities: FacilityDefinition[];
  availableClosureTags: ClosureTagDefinition[];
  solidFuelBanFilterMode: BanFilterMode;
  totalFireBanFilterMode: BanFilterMode;
  closureFilterMode: ClosureFilterMode;
  closureTagFilterModes: Record<string, TriStateMode>;
  facilityFilterModes: Record<string, TriStateMode>;
  impactCampingFilterMode: TriStateMode;
  impactAccessFilterMode: TriStateMode;
}

export function useForestFilter({
  forests,
  availableFacilities,
  availableClosureTags,
  solidFuelBanFilterMode,
  totalFireBanFilterMode,
  closureFilterMode,
  closureTagFilterModes,
  facilityFilterModes,
  impactCampingFilterMode,
  impactAccessFilterMode
}: UseForestFilterInput): {
  matchingForests: ForestPoint[];
  matchingForestIds: Set<string>;
} {
  const matchingForests = useMemo(() => {
    return forests.filter((forest) => {
      const closureStatus = getForestClosureStatus(forest);
      const impactSummary = getForestImpactSummary(forest);
      const hasCampingImpactWarning = isImpactWarning(impactSummary.campingImpact);
      const hasAccessImpactWarning =
        isImpactWarning(impactSummary.access2wdImpact) ||
        isImpactWarning(impactSummary.access4wdImpact);

      if (!matchesBanFilter(solidFuelBanFilterMode, forest.banStatus)) {
        return false;
      }

      if (!matchesBanFilter(totalFireBanFilterMode, forest.totalFireBanStatus)) {
        return false;
      }

      if (closureFilterMode === "OPEN_ONLY" && closureStatus !== "NONE") {
        return false;
      }

      if (closureFilterMode === "NO_FULL_CLOSURES" && closureStatus === "CLOSED") {
        return false;
      }

      if (closureFilterMode === "HAS_NOTICE" && closureStatus === "NONE") {
        return false;
      }

      for (const closureTag of availableClosureTags) {
        const mode = closureTagFilterModes[closureTag.key] ?? "ANY";
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

      if (impactCampingFilterMode === "INCLUDE" && !hasCampingImpactWarning) {
        return false;
      }

      if (impactCampingFilterMode === "EXCLUDE" && hasCampingImpactWarning) {
        return false;
      }

      if (impactAccessFilterMode === "INCLUDE" && !hasAccessImpactWarning) {
        return false;
      }

      if (impactAccessFilterMode === "EXCLUDE" && hasAccessImpactWarning) {
        return false;
      }

      for (const facility of availableFacilities) {
        const mode = facilityFilterModes[facility.key] ?? "ANY";
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
    });
  }, [
    availableClosureTags,
    availableFacilities,
    closureFilterMode,
    closureTagFilterModes,
    facilityFilterModes,
    forests,
    impactAccessFilterMode,
    impactCampingFilterMode,
    solidFuelBanFilterMode,
    totalFireBanFilterMode
  ]);

  const matchingForestIds = useMemo(
    () => new Set(matchingForests.map((forest) => forest.id)),
    [matchingForests]
  );

  return { matchingForests, matchingForestIds };
}
