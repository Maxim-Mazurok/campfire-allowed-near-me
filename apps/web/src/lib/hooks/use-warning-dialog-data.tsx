import { useMemo } from "react";
import type { ReactNode } from "react";
import type { ForestApiResponse, ClosureMatchDiagnostics, FacilityMatchDiagnostics } from "../api";
import { getForestPrimaryAreaName, getForestPrimaryAreaUrl } from "../api";
import {
  ALPHABETICAL_COLLATOR,
  FACILITIES_SOURCE_URL,
  FORESTRY_BASE_URL,
  SOLID_FUEL_FIRE_BAN_SOURCE_URL
} from "../app-domain-constants";
import {
  buildTextHighlightUrl,
  isHttpUrl,
  normalizeForestName
} from "../app-domain-forest";
import type { FireBanForestSortColumn, SortDirection } from "../app-domain-types";

export const renderFacilitiesMismatchWarningSummary = (summaryText: string): ReactNode => {
  const facilitiesPageLabel = "Facilities page";
  const fireBanPagesLabel = "Solid Fuel Fire Ban pages";
  const summaryPartsAfterFacilitiesPage = summaryText.split(facilitiesPageLabel);
  const beforeFacilitiesPage = summaryPartsAfterFacilitiesPage[0];
  const afterFacilitiesPage = summaryPartsAfterFacilitiesPage[1];
  if (beforeFacilitiesPage === undefined || afterFacilitiesPage === undefined) {
    return summaryText;
  }

  const summaryPartsAfterFireBanPages = afterFacilitiesPage.split(fireBanPagesLabel);
  const betweenLinks = summaryPartsAfterFireBanPages[0];
  const afterFireBanPages = summaryPartsAfterFireBanPages[1];
  if (betweenLinks === undefined || afterFireBanPages === undefined) {
    return summaryText;
  }

  return (
    <>
      {beforeFacilitiesPage}
      <a href={FACILITIES_SOURCE_URL} target="_blank" rel="noopener noreferrer">
        {facilitiesPageLabel}
      </a>
      {betweenLinks}
      <a
        href={SOLID_FUEL_FIRE_BAN_SOURCE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Solid Fuel Fire Ban
      </a>
      {" pages"}
      {afterFireBanPages}
    </>
  );
};

export type WarningDialogData = {
  warningCount: number;
  hasUnmappedForestWarning: boolean;
  unmappedForests: ForestApiResponse["forests"];
  hasUnknownTotalFireBanWarning: boolean;
  forestsWithUnknownTotalFireBan: ForestApiResponse["forests"];
  generalWarnings: string[];
  hasFacilitiesMismatchWarning: boolean;
  matchDiagnostics: FacilityMatchDiagnostics;
  facilitiesMismatchWarningSummary: string;
  hasFuzzyMatchesWarning: boolean;
  fuzzyMatchesWarningText: string;
  getFireBanAreaUrl: (forestName: string) => string;
  closureDiagnostics: ClosureMatchDiagnostics;
  fireBanPageForests: ForestApiResponse["forests"];
  sortedFireBanPageForests: ForestApiResponse["forests"];
  getUnmappedForestLink: (
    forest: ForestApiResponse["forests"][number]
  ) => { href: string; label: string };
};

export const useWarningDialogData = ({
  forests,
  payload,
  fireBanForestSortColumn,
  fireBanForestSortDirection
}: {
  forests: ForestApiResponse["forests"];
  payload: ForestApiResponse | null;
  fireBanForestSortColumn: FireBanForestSortColumn;
  fireBanForestSortDirection: SortDirection;
}): WarningDialogData => {
  return useMemo(() => {
    const matchDiagnostics: FacilityMatchDiagnostics = payload?.matchDiagnostics ?? {
      unmatchedFacilitiesForests: [],
      fuzzyMatches: []
    };
    const closureDiagnostics: ClosureMatchDiagnostics = payload?.closureDiagnostics ?? {
      unmatchedNotices: [],
      fuzzyMatches: []
    };
    const baseWarnings = (payload?.warnings ?? []).filter(
      (warning) => !/Facilities data could not be matched for/i.test(warning)
    );
    const hasFacilitiesMismatchWarning = baseWarnings.some((warning) =>
      /not present on the Solid Fuel Fire Ban pages/i.test(warning)
    );
    const hasFuzzyMatchesWarning = baseWarnings.some((warning) =>
      /Applied fuzzy facilities matching/i.test(warning)
    );
    const generalWarnings = baseWarnings.filter(
      (warning) =>
        !/not present on the Solid Fuel Fire Ban pages/i.test(warning) &&
        !/Applied fuzzy facilities matching/i.test(warning)
    );
    const facilitiesMismatchWarningText =
      matchDiagnostics.unmatchedFacilitiesForests.length > 0
        ? `Facilities page includes ${matchDiagnostics.unmatchedFacilitiesForests.length} forest(s) not present on the Solid Fuel Fire Ban pages.`
        :
            baseWarnings.find((warning) => /not present on the Solid Fuel Fire Ban pages/i.test(warning)) ??
            `Facilities page includes ${matchDiagnostics.unmatchedFacilitiesForests.length} forest(s) not present on the Solid Fuel Fire Ban pages.`;
    const facilitiesMismatchWarningSummary = facilitiesMismatchWarningText.replace(
      /(not present on the Solid Fuel Fire Ban pages)\s*:.*$/i,
      "$1."
    );
    const fuzzyMatchesWarningText =
      matchDiagnostics.fuzzyMatches.length > 0
        ? `Applied fuzzy facilities matching for ${matchDiagnostics.fuzzyMatches.length} forest name(s) with minor naming differences.`
        :
            baseWarnings.find((warning) => /Applied fuzzy facilities matching/i.test(warning)) ??
            `Applied fuzzy facilities matching for ${matchDiagnostics.fuzzyMatches.length} forest name(s) with minor naming differences.`;

    const unmappedForests = forests
      .filter((forest) => forest.latitude === null || forest.longitude === null)
      .slice()
      .sort((left, right) => left.forestName.localeCompare(right.forestName));
    const forestsWithUnknownTotalFireBan = forests
      .filter((forest) => forest.totalFireBanStatus === "UNKNOWN")
      .slice()
      .sort((left, right) => left.forestName.localeCompare(right.forestName));

    const hasUnmappedForestWarning = unmappedForests.length > 0;
    const hasUnknownTotalFireBanWarning = forestsWithUnknownTotalFireBan.length > 0;
    const unmappedForestWarningCount = unmappedForests.length;
    const unknownTotalFireBanWarningCount = forestsWithUnknownTotalFireBan.length;
    const facilitiesMismatchWarningCount =
      matchDiagnostics.unmatchedFacilitiesForests.length > 0
        ? matchDiagnostics.unmatchedFacilitiesForests.length
        : hasFacilitiesMismatchWarning
          ? 1
          : 0;
    const fuzzyMatchesWarningCount =
      matchDiagnostics.fuzzyMatches.length > 0
        ? matchDiagnostics.fuzzyMatches.length
        : hasFuzzyMatchesWarning
          ? 1
          : 0;

    const warningCount =
      generalWarnings.length +
      unmappedForestWarningCount +
      unknownTotalFireBanWarningCount +
      facilitiesMismatchWarningCount +
      fuzzyMatchesWarningCount +
      closureDiagnostics.unmatchedNotices.length;

    const unmatchedFacilitiesForestNames = new Set(
      matchDiagnostics.unmatchedFacilitiesForests.map(normalizeForestName)
    );
    const fireBanPageForests = forests.filter(
      (forest) => !unmatchedFacilitiesForestNames.has(normalizeForestName(forest.forestName))
    );

    const getSortValue = (
      forest: ForestApiResponse["forests"][number],
      sortColumn: FireBanForestSortColumn
    ): string => (sortColumn === "forestName" ? forest.forestName : getForestPrimaryAreaName(forest.areas));

    const sortedFireBanPageForests = [...fireBanPageForests].sort((left, right) => {
      const primaryResult = ALPHABETICAL_COLLATOR.compare(
        getSortValue(left, fireBanForestSortColumn),
        getSortValue(right, fireBanForestSortColumn)
      );
      const normalizedPrimaryResult =
        fireBanForestSortDirection === "asc" ? primaryResult : -primaryResult;

      if (normalizedPrimaryResult !== 0) {
        return normalizedPrimaryResult;
      }

      const secondaryColumn = fireBanForestSortColumn === "forestName" ? "areaName" : "forestName";
      const secondaryResult = ALPHABETICAL_COLLATOR.compare(
        getSortValue(left, secondaryColumn),
        getSortValue(right, secondaryColumn)
      );

      if (secondaryResult !== 0) {
        return secondaryResult;
      }

      return left.id.localeCompare(right.id);
    });

    const fireBanAreaUrlByForestName = new Map<string, string>();
    for (const forest of forests) {
      const normalizedForestName = normalizeForestName(forest.forestName);
      if (!fireBanAreaUrlByForestName.has(normalizedForestName)) {
        fireBanAreaUrlByForestName.set(normalizedForestName, getForestPrimaryAreaUrl(forest.areas));
      }
    }

    const getFireBanAreaUrl = (forestName: string): string =>
      buildTextHighlightUrl(
        fireBanAreaUrlByForestName.get(normalizeForestName(forestName)) ??
          `${FORESTRY_BASE_URL}/visit/solid-fuel-fire-bans`,
        forestName
      );

    const getUnmappedForestLink = (
      forest: ForestApiResponse["forests"][number]
    ): { href: string; label: string } => {
      if (isHttpUrl(forest.forestUrl)) {
        return {
          href: forest.forestUrl,
          label: "Facilities page"
        };
      }

      const primaryAreaUrl = getForestPrimaryAreaUrl(forest.areas);
      const areaTarget = isHttpUrl(primaryAreaUrl)
        ? primaryAreaUrl
        : `${FORESTRY_BASE_URL}/visit/solid-fuel-fire-bans`;

      return {
        href: buildTextHighlightUrl(areaTarget, forest.forestName),
        label: `${getForestPrimaryAreaName(forest.areas)} region`
      };
    };

    return {
      warningCount,
      hasUnmappedForestWarning,
      unmappedForests,
      hasUnknownTotalFireBanWarning,
      forestsWithUnknownTotalFireBan,
      generalWarnings,
      hasFacilitiesMismatchWarning,
      matchDiagnostics,
      facilitiesMismatchWarningSummary,
      hasFuzzyMatchesWarning,
      fuzzyMatchesWarningText,
      getFireBanAreaUrl,
      closureDiagnostics,
      fireBanPageForests,
      sortedFireBanPageForests,
      getUnmappedForestLink
    };
  }, [payload, forests, fireBanForestSortColumn, fireBanForestSortDirection]);
};
