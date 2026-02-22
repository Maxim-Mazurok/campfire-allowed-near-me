import type { BanStatus, ForestAreaWithForests } from "../types/domain.js";
import { normalizeForestLabel } from "../utils/forest-name-validation.js";

export interface ForestBanSummary {
  status: BanStatus;
  statusText: string;
}

export const BAN_STATUS_PRIORITY: Record<BanStatus, number> = {
  UNKNOWN: 0,
  NOT_BANNED: 1,
  BANNED: 2
};

export function normalizeBanStatusText(status: BanStatus, statusText: string): string {
  const normalized = statusText.trim();
  if (normalized) {
    return normalized;
  }

  if (status === "BANNED") {
    return "Solid Fuel Fire Ban";
  }

  if (status === "NOT_BANNED") {
    return "No Solid Fuel Fire Ban";
  }

  return "Unknown";
}

export function buildForestStatusKey(forestName: string): string {
  return normalizeForestLabel(forestName).toLowerCase();
}

export function buildMostRestrictiveBanByForest(
  areas: ForestAreaWithForests[]
): Map<string, ForestBanSummary> {
  const byForest = new Map<string, ForestBanSummary>();

  for (const area of areas) {
    const uniqueForestNames = [...new Set(
      area.forests.map((forest) => normalizeForestLabel(forest)).filter(Boolean)
    )];
    const candidateSummary: ForestBanSummary = {
      status: area.status,
      statusText: normalizeBanStatusText(area.status, area.statusText)
    };

    for (const forestName of uniqueForestNames) {
      const key = buildForestStatusKey(forestName);
      const existingSummary = byForest.get(key);

      if (
        !existingSummary ||
        BAN_STATUS_PRIORITY[candidateSummary.status] > BAN_STATUS_PRIORITY[existingSummary.status]
      ) {
        byForest.set(key, candidateSummary);
      }
    }
  }

  return byForest;
}
