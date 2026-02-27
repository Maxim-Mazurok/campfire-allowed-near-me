import type { UserLocation } from "./forests-query";

export type BanFilterMode = "ALL" | "NOT_BANNED" | "BANNED" | "UNKNOWN";
export type LegacyBanFilterMode = "ALL" | "ALLOWED" | "NOT_ALLOWED";

/**
 * Sub-filter for solid fuel ban scope, shown when the primary ban filter
 * is set to NOT_BANNED or BANNED.
 *
 * - ANYWHERE: standard behaviour, ignore scope entirely.
 * - CAMPS: "Is fire allowed/banned in designated campgrounds?"
 * - NOT_CAMPS: "Is fire allowed/banned outside designated campgrounds?"
 */
export type BanScopeFilterMode = "ANYWHERE" | "CAMPS" | "NOT_CAMPS";

export type ClosureStatusFilterMode = "ALL" | "OPEN" | "PARTIAL" | "CLOSED";
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
  solidFuelBanScopeFilterMode?: BanScopeFilterMode;
  totalFireBanFilterMode?: BanFilterMode;
  closureStatusFilterMode?: ClosureStatusFilterMode;
  hasNoticesFilterMode?: TriStateMode;
  impactCampingFilterMode?: TriStateMode;
  impactAccess2wdFilterMode?: TriStateMode;
  impactAccess4wdFilterMode?: TriStateMode;
  banFilterMode?: LegacyBanFilterMode;
  facilityFilterModes?: Record<string, TriStateMode>;
  closureTagFilterModes?: Record<string, TriStateMode>;
  userLocation?: UserLocation | null;
  avoidTolls?: boolean;
  forestListSortOption?: ForestListSortOption;
};
