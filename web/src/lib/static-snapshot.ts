import { haversineDistanceKm } from "../../../shared/distance.js";
import { getForestBanStatus } from "../../../shared/forest-helpers.js";
import type {
  FacilityDefinition,
  ForestApiResponse,
  ForestPoint,
  NearestForest,
  PersistedSnapshot
} from "../../../shared/contracts.js";

const SNAPSHOT_URL =
  import.meta.env.VITE_SNAPSHOT_URL ?? "/forests-snapshot.json";

/**
 * Compute haversine distances from user location and sort by distance.
 * Pure function — safe for useMemo.
 */
export const computeForestsWithDistances = (
  forests: ForestPoint[],
  userLocation: { latitude: number; longitude: number } | null
): ForestPoint[] => {
  if (!userLocation) {
    return forests;
  }

  const withDistances = forests.map((forest) => {
    const computedDistanceKm =
      forest.latitude !== null && forest.longitude !== null
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
      distanceKm: computedDistanceKm
    };
  });

  withDistances.sort((left, right) => {
    if (left.distanceKm === null) return 1;
    if (right.distanceKm === null) return -1;
    return left.distanceKm - right.distanceKm;
  });

  return withDistances;
};

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

/**
 * Find nearest legal campfire spot that also has camping facilities.
 * Uses same legality logic as findNearestLegalSpot but additionally
 * checks that the forest has a camping facility (determined by iconKey "camping").
 */
export const findNearestLegalCampfireWithCamping = (
  forests: ForestPoint[],
  userLocation?: { latitude: number; longitude: number },
  availableFacilities?: FacilityDefinition[]
): NearestForest | null => {
  const campingFacilityKey = availableFacilities?.find(
    (facility) => facility.iconKey === "camping"
  )?.key;

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

    const hasCamping = campingFacilityKey
      ? forest.facilities[campingFacilityKey] === true
      : forest.facilities.camping === true;

    if (!hasCamping) {
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
  snapshot: PersistedSnapshot
): ForestApiResponse => {
  const forests: ForestPoint[] = snapshot.forests.map((forest) => ({
    ...forest,
    directDistanceKm: null,
    distanceKm: null,
    travelDurationMinutes: null
  }));

  return {
    fetchedAt: snapshot.fetchedAt,
    stale: snapshot.stale,
    sourceName: snapshot.sourceName,
    availableFacilities: snapshot.availableFacilities,
    availableClosureTags: snapshot.availableClosureTags,
    matchDiagnostics: snapshot.matchDiagnostics,
    closureDiagnostics: snapshot.closureDiagnostics,
    forests,
    nearestLegalSpot: null,
    warnings: snapshot.warnings
  };
};

export const fetchStaticSnapshot = async (
  signal?: AbortSignal
): Promise<ForestApiResponse> => {
  const response = await fetch(SNAPSHOT_URL, { signal });

  if (!response.ok) {
    throw new Error(`Failed to fetch forest data (HTTP ${response.status})`);
  }

  const snapshot = (await response.json()) as PersistedSnapshot;
  return transformSnapshotToApiResponse(snapshot);
};
