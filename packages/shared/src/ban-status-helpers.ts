import type { BanStatus, ForestAreaWithForests, SolidFuelBanScope } from "./contracts.js";
import { normalizeForestLabel } from "./text-utils.js";

export interface ForestBanSummary {
  status: BanStatus;
  statusText: string;
  banScope: SolidFuelBanScope;
}

/**
 * Priority ordering where a concrete status beats UNKNOWN.
 * BANNED > NOT_BANNED > UNKNOWN.
 * Used by `buildMostRestrictiveBanByForest` when merging bans across areas.
 */
export const MOST_RESTRICTIVE_BAN_PRIORITY: Record<BanStatus, number> = {
  UNKNOWN: 0,
  NOT_BANNED: 1,
  BANNED: 2
};

export const normalizeBanStatusText = (status: BanStatus, statusText: string): string => {
  const normalized = statusText.trim();
  if (normalized) return normalized;
  if (status === "BANNED") return "Solid Fuel Fire Ban";
  if (status === "NOT_BANNED") return "No Solid Fuel Fire Ban";
  return "Unknown";
};

export const buildForestStatusKey = (forestName: string): string =>
  normalizeForestLabel(forestName).toLowerCase();

export const buildMostRestrictiveBanByForest = (
  areas: ForestAreaWithForests[]
): Map<string, ForestBanSummary> => {
  const byForest = new Map<string, ForestBanSummary>();
  for (const area of areas) {
    const uniqueForestNames = [...new Set(
      area.forests.map((forest) => normalizeForestLabel(forest)).filter(Boolean)
    )];
    const candidateSummary: ForestBanSummary = {
      status: area.status,
      statusText: normalizeBanStatusText(area.status, area.statusText),
      banScope: area.banScope
    };
    for (const forestName of uniqueForestNames) {
      const key = buildForestStatusKey(forestName);
      const existingSummary = byForest.get(key);
      if (
        !existingSummary ||
        MOST_RESTRICTIVE_BAN_PRIORITY[candidateSummary.status] >
          MOST_RESTRICTIVE_BAN_PRIORITY[existingSummary.status]
      ) {
        byForest.set(key, candidateSummary);
      }
    }
  }
  return byForest;
};
