import type { UserLocation } from "./forests-query";

export type BanFilterMode = "ALL" | "NOT_BANNED" | "BANNED" | "UNKNOWN";
export type LegacyBanFilterMode = "ALL" | "ALLOWED" | "NOT_ALLOWED";
export type ClosureFilterMode = "ALL" | "OPEN_ONLY" | "NO_FULL_CLOSURES" | "HAS_NOTICE";
export type TriStateMode = "ANY" | "INCLUDE" | "EXCLUDE";
export type FireBanForestSortColumn = "forestName" | "areaName";
export type SortDirection = "asc" | "desc";
export type ForestListSortOption =
  | "DRIVING_DISTANCE_ASC"
  | "DRIVING_DISTANCE_DESC"
  | "DRIVING_TIME_ASC"
  | "DRIVING_TIME_DESC";

export type UserPreferences = {
  solidFuelBanFilterMode?: BanFilterMode;
  totalFireBanFilterMode?: BanFilterMode;
  closureFilterMode?: ClosureFilterMode;
  banFilterMode?: LegacyBanFilterMode;
  facilityFilterModes?: Record<string, TriStateMode>;
  closureTagFilterModes?: Record<string, TriStateMode>;
  impactCampingFilterMode?: TriStateMode;
  impactAccessFilterMode?: TriStateMode;
  userLocation?: UserLocation | null;
  avoidTolls?: boolean;
  forestListSortOption?: ForestListSortOption;
};
