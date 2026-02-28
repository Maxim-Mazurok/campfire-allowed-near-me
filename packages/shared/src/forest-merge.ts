import type { ForestAreaReference, PersistedForestPoint } from "./contracts.js";
import { buildForestStatusKey } from "./ban-status-helpers.js";
import { slugify } from "./text-utils.js";

export const mergeMultiAreaForests = (
  points: PersistedForestPoint[]
): PersistedForestPoint[] => {
  const groupsByForestKey = new Map<string, PersistedForestPoint[]>();
  const insertionOrder: string[] = [];

  for (const point of points) {
    const key = buildForestStatusKey(point.forestName);
    const existing = groupsByForestKey.get(key);
    if (existing) {
      existing.push(point);
    } else {
      groupsByForestKey.set(key, [point]);
      insertionOrder.push(key);
    }
  }

  const merged: PersistedForestPoint[] = [];

  for (const key of insertionOrder) {
    const group = groupsByForestKey.get(key);
    if (!group || group.length === 0) continue;

    if (group.length === 1) {
      const singlePoint = group[0];
      if (singlePoint) merged.push(singlePoint);
      continue;
    }

    const primary = group.reduce((best, candidate) => {
      const bestHasCoordinates = best.latitude !== null && best.longitude !== null;
      const candidateHasCoordinates = candidate.latitude !== null && candidate.longitude !== null;
      if (candidateHasCoordinates && !bestHasCoordinates) return candidate;
      if (!candidateHasCoordinates && bestHasCoordinates) return best;
      return best;
    });

    const seenAreaKeys = new Set<string>();
    const mergedAreas: ForestAreaReference[] = [];
    for (const point of group) {
      for (const area of point.areas) {
        const areaKey = area.areaName.toLowerCase();
        if (!seenAreaKeys.has(areaKey)) {
          seenAreaKeys.add(areaKey);
          mergedAreas.push(area);
        }
      }
    }

    merged.push({
      ...primary,
      id: slugify(primary.forestName),
      areas: mergedAreas
    });
  }

  return merged;
};
