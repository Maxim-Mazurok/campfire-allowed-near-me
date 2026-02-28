import type { BanStatus, ForestAreaReference, SolidFuelBanScope } from "./contracts.js";

const BAN_STATUS_PRIORITY: Record<BanStatus, number> = {
  BANNED: 3,
  UNKNOWN: 2,
  NOT_BANNED: 1
};

/**
 * Returns the most restrictive (pessimistic) ban status from all areas.
 * BANNED > UNKNOWN > NOT_BANNED.
 * Falls back to "UNKNOWN" when the areas array is empty.
 */
export const getForestBanStatus = (areas: ForestAreaReference[]): BanStatus => {
  if (areas.length === 0) {
    return "UNKNOWN";
  }

  let worstStatus: BanStatus = areas[0]!.banStatus;

  for (let i = 1; i < areas.length; i++) {
    const candidate = areas[i]!.banStatus;
    if (BAN_STATUS_PRIORITY[candidate] > BAN_STATUS_PRIORITY[worstStatus]) {
      worstStatus = candidate;
    }
  }

  return worstStatus;
};

/**
 * Returns the ban-status text from the area with the most restrictive ban.
 * Falls back to a generic "Unknown" label when the areas array is empty.
 */
export const getForestBanStatusText = (areas: ForestAreaReference[]): string => {
  if (areas.length === 0) {
    return "Unknown (Solid Fuel Fire Ban status unavailable)";
  }

  let worstArea = areas[0]!;

  for (let i = 1; i < areas.length; i++) {
    const candidate = areas[i]!;
    if (BAN_STATUS_PRIORITY[candidate.banStatus] > BAN_STATUS_PRIORITY[worstArea.banStatus]) {
      worstArea = candidate;
    }
  }

  return worstArea.banStatusText;
};

/**
 * Returns the area name from the first (primary) area.
 * Falls back to an empty string when the areas array is empty.
 */
export const getForestPrimaryAreaName = (areas: ForestAreaReference[]): string =>
  areas[0]?.areaName ?? "";

/**
 * Returns the area URL from the first (primary) area.
 * Falls back to an empty string when the areas array is empty.
 */
export const getForestPrimaryAreaUrl = (areas: ForestAreaReference[]): string =>
  areas[0]?.areaUrl ?? "";

/**
 * Returns the ban scope from the area with the most restrictive ban.
 * Falls back to "ALL" when the areas array is empty.
 */
export const getForestBanScope = (areas: ForestAreaReference[]): SolidFuelBanScope => {
  if (areas.length === 0) {
    return "ALL";
  }

  let worstArea = areas[0]!;

  for (let i = 1; i < areas.length; i++) {
    const candidate = areas[i]!;
    if (BAN_STATUS_PRIORITY[candidate.banStatus] > BAN_STATUS_PRIORITY[worstArea.banStatus]) {
      worstArea = candidate;
    }
  }

  return worstArea.banScope;
};
