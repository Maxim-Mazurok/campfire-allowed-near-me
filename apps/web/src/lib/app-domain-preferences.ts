import type { UserPreferences, BanFilterMode, LegacyBanFilterMode, ClosureFilterMode, TriStateMode, ForestListSortOption } from "./app-domain-types";

const USER_PREFERENCES_STORAGE_KEY = "campfire-user-preferences";

const isBanFilterMode = (value: unknown): value is BanFilterMode =>
  value === "ALL" ||
  value === "NOT_BANNED" ||
  value === "BANNED" ||
  value === "UNKNOWN";

const isLegacyBanFilterMode = (value: unknown): value is LegacyBanFilterMode =>
  value === "ALL" || value === "ALLOWED" || value === "NOT_ALLOWED";

const toModernBanFilterMode = (mode: LegacyBanFilterMode): BanFilterMode => {
  if (mode === "ALLOWED") {
    return "NOT_BANNED";
  }

  if (mode === "NOT_ALLOWED") {
    return "BANNED";
  }

  return "ALL";
};

const isClosureFilterMode = (value: unknown): value is ClosureFilterMode =>
  value === "ALL" ||
  value === "OPEN_ONLY" ||
  value === "NO_FULL_CLOSURES" ||
  value === "HAS_NOTICE";

const isTriStateMode = (value: unknown): value is TriStateMode =>
  value === "ANY" || value === "INCLUDE" || value === "EXCLUDE";

const isForestListSortOption = (value: unknown): value is ForestListSortOption =>
  value === "DRIVING_DISTANCE_ASC" ||
  value === "DRIVING_DISTANCE_DESC" ||
  value === "DRIVING_TIME_ASC" ||
  value === "DRIVING_TIME_DESC";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const parseUserPreferences = (value: string | null): UserPreferences => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }

    const rawPreferences = parsed as Record<string, unknown>;
    const preferences: UserPreferences = {};

    if (isBanFilterMode(rawPreferences.solidFuelBanFilterMode)) {
      preferences.solidFuelBanFilterMode = rawPreferences.solidFuelBanFilterMode;
    } else if (isLegacyBanFilterMode(rawPreferences.banFilterMode)) {
      preferences.solidFuelBanFilterMode = toModernBanFilterMode(rawPreferences.banFilterMode);
      preferences.banFilterMode = rawPreferences.banFilterMode;
    }

    if (isBanFilterMode(rawPreferences.totalFireBanFilterMode)) {
      preferences.totalFireBanFilterMode = rawPreferences.totalFireBanFilterMode;
    }

    if (isClosureFilterMode(rawPreferences.closureFilterMode)) {
      preferences.closureFilterMode = rawPreferences.closureFilterMode;
    }

    if (
      typeof rawPreferences.facilityFilterModes === "object" &&
      rawPreferences.facilityFilterModes !== null
    ) {
      const nextFacilityFilterModes: Record<string, TriStateMode> = {};
      for (const [key, mode] of Object.entries(rawPreferences.facilityFilterModes)) {
        if (isTriStateMode(mode)) {
          nextFacilityFilterModes[key] = mode;
        }
      }
      preferences.facilityFilterModes = nextFacilityFilterModes;
    }

    if (
      typeof rawPreferences.closureTagFilterModes === "object" &&
      rawPreferences.closureTagFilterModes !== null
    ) {
      const nextClosureTagFilterModes: Record<string, TriStateMode> = {};
      for (const [key, mode] of Object.entries(rawPreferences.closureTagFilterModes)) {
        if (isTriStateMode(mode)) {
          nextClosureTagFilterModes[key] = mode;
        }
      }
      preferences.closureTagFilterModes = nextClosureTagFilterModes;
    }

    if (isTriStateMode(rawPreferences.impactCampingFilterMode)) {
      preferences.impactCampingFilterMode = rawPreferences.impactCampingFilterMode;
    }

    if (isTriStateMode(rawPreferences.impactAccessFilterMode)) {
      preferences.impactAccessFilterMode = rawPreferences.impactAccessFilterMode;
    }

    if (rawPreferences.userLocation === null) {
      preferences.userLocation = null;
    } else if (
      typeof rawPreferences.userLocation === "object" &&
      rawPreferences.userLocation !== null
    ) {
      const rawLocation = rawPreferences.userLocation as Record<string, unknown>;
      if (isFiniteNumber(rawLocation.latitude) && isFiniteNumber(rawLocation.longitude)) {
        preferences.userLocation = {
          latitude: rawLocation.latitude,
          longitude: rawLocation.longitude
        };
      }
    }

    if (isBoolean(rawPreferences.avoidTolls)) {
      preferences.avoidTolls = rawPreferences.avoidTolls;
    }

    if (isForestListSortOption(rawPreferences.forestListSortOption)) {
      preferences.forestListSortOption = rawPreferences.forestListSortOption;
    }

    return preferences;
  } catch {
    return {};
  }
};

export const readUserPreferences = (): UserPreferences => {
  try {
    return parseUserPreferences(window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY));
  } catch {
    return {};
  }
};

export const writeUserPreferences = (preferences: UserPreferences) => {
  try {
    window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    return;
  }
};
