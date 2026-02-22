import type { ReactNode } from "react";
import type { ClosureMatchDiagnostics, FacilityMatchDiagnostics, ForestApiResponse } from "../../lib/api";

export interface WarningSectionProps {
  hasUnmappedForestWarning: boolean;
  unmappedForests: ForestApiResponse["forests"];
  getUnmappedForestLink: (
    forest: ForestApiResponse["forests"][number]
  ) => { href: string; label: string };
  hasUnknownTotalFireBanWarning: boolean;
  forestsWithUnknownTotalFireBan: ForestApiResponse["forests"];
  buildTotalFireBanDetailsUrl: (forest: ForestApiResponse["forests"][number]) => string;
  generalWarnings: string[];
  hasFacilitiesMismatchWarning: boolean;
  matchDiagnostics: FacilityMatchDiagnostics;
  facilitiesMismatchWarningSummary: string;
  renderFacilitiesMismatchWarningSummary: (summaryText: string) => ReactNode;
  openFireBanForestTable: () => void;
  buildFacilitiesForestUrl: (forestName: string) => string;
  hasFuzzyMatchesWarning: boolean;
  fuzzyMatchesWarningText: string;
  getFireBanAreaUrl: (forestName: string) => string;
  closureDiagnostics: ClosureMatchDiagnostics;
}

export interface FireBanForestTableProps {
  fireBanForestTableOpen: boolean;
  closeFireBanForestTable: () => void;
  fireBanPageForests: ForestApiResponse["forests"];
  sortedFireBanPageForests: ForestApiResponse["forests"];
  fireBanForestSortColumn: "forestName" | "areaName";
  fireBanForestTableSortLabel: string;
  toggleFireBanForestSort: (column: "forestName" | "areaName") => void;
}
