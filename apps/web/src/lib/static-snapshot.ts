import { haversineDistanceKm } from "../../../../packages/shared/src/distance.js";
import { getForestBanStatus } from "../../../../packages/shared/src/forest-helpers.js";
import type {
  ForestApiResponse,
  ForestPoint,
  NearestForest,
  PersistedSnapshot
} from "../../../../packages/shared/src/contracts.js";

const SNAPSHOT_URL =
  import.meta.env.VITE_SNAPSHOT_URL ?? "/forests-snapshot.json";

export const findNearestLegalSpot = (
  forests: ForestPoint[],
  userLocation?: { latitude: number; longitude: number }
): NearestForest | null => {
  let nearest: { forest: ForestPoint; effectiveDistanceKm: number } | null =
    null;

  for (const forest of forests) {
    if (
      getForestBanStatus(forest.areas) !== "NOT_BANNED" ||
      forest.totalFireBanStatus === "BANNED" ||
      forest.closureStatus === "CLOSED"
    ) {
      continue;
    }

    const effectiveDistanceKm =
      forest.distanceKm ??
      (userLocation &&
      forest.latitude !== null &&
      forest.longitude !== null
        ? haversineDistanceKm(
            userLocation.latitude,
            userLocation.longitude,
            forest.latitude,
            forest.longitude
          )
        : null);

    if (effectiveDistanceKm === null) {
      continue;
    }

    if (!nearest || nearest.effectiveDistanceKm > effectiveDistanceKm) {
      nearest = { forest, effectiveDistanceKm };
    }
  }

  if (!nearest) {
    return null;
  }

  const { forest } = nearest;

  return {
    id: forest.id,
    forestName: forest.forestName,
    distanceKm: forest.distanceKm ?? nearest.effectiveDistanceKm,
    travelDurationMinutes: forest.travelDurationMinutes
  };
};

const transformSnapshotToApiResponse = (
  snapshot: PersistedSnapshot,
  userLocation?: { latitude: number; longitude: number }
): ForestApiResponse => {
  const forests: ForestPoint[] = snapshot.forests.map((forest) => {
    const computedDistanceKm =
      userLocation &&
      forest.latitude !== null &&
      forest.longitude !== null
        ? haversineDistanceKm(
            userLocation.latitude,
            userLocation.longitude,
            forest.latitude,
            forest.longitude
          )
        : null;

    return {
      ...forest,
      directDistanceKm: computedDistanceKm,
      distanceKm: computedDistanceKm,
      travelDurationMinutes: null
    };
  });

  forests.sort((left, right) => {
    if (left.distanceKm === null) return 1;
    if (right.distanceKm === null) return -1;
    return left.distanceKm - right.distanceKm;
  });

  return {
    fetchedAt: snapshot.fetchedAt,
    stale: snapshot.stale,
    sourceName: snapshot.sourceName,
    availableFacilities: snapshot.availableFacilities,
    availableClosureTags: snapshot.availableClosureTags,
    matchDiagnostics: snapshot.matchDiagnostics,
    closureDiagnostics: snapshot.closureDiagnostics,
    forests,
    nearestLegalSpot: findNearestLegalSpot(forests, userLocation),
    warnings: snapshot.warnings
  };
};

export const fetchStaticSnapshot = async (
  userLocation?: { latitude: number; longitude: number },
  signal?: AbortSignal
): Promise<ForestApiResponse> => {
  const response = await fetch(SNAPSHOT_URL, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch forest data (HTTP ${response.status})`);
  }

  const snapshot = (await response.json()) as PersistedSnapshot;
  return transformSnapshotToApiResponse(snapshot, userLocation);
};
