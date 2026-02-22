import { haversineDistanceKm } from "../utils/distance.js";
import type {
  ForestDataServiceInput,
  ForestPoint,
  NearestForest,
  UserLocation
} from "../types/domain.js";
import type { RouteService } from "./google-routes.js";

export async function addTravelMetrics(
  forests: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[],
  location: UserLocation | undefined,
  avoidTolls: boolean,
  progressCallback: ForestDataServiceInput["progressCallback"] | undefined,
  routeService: RouteService
): Promise<{
  forests: ForestPoint[];
  warnings: string[];
}> {
  if (!location) {
    return {
      forests: forests.map((forest) => ({
        ...forest,
        distanceKm: null,
        travelDurationMinutes: null
      })),
      warnings: []
    };
  }

  const routableForests = forests
    .filter(
      (forest) => forest.latitude !== null && forest.longitude !== null
    )
    .map((forest) => ({
      id: forest.id,
      latitude: forest.latitude!,
      longitude: forest.longitude!
    }));

  let routeLookup: Awaited<ReturnType<RouteService["getDrivingRouteMetrics"]>> = {
    byForestId: new Map(),
    warnings: []
  };

  if (routableForests.length) {
    try {
      progressCallback?.({
        phase: "ROUTES",
        message: "Computing driving routes.",
        completed: 0,
        total: routableForests.length
      });

      routeLookup = await routeService.getDrivingRouteMetrics({
        userLocation: location,
        forests: routableForests,
        avoidTolls,
        progressCallback: ({ completed, total, message }: {
          completed: number;
          total: number;
          message: string;
        }) => {
          progressCallback?.({
            phase: "ROUTES",
            message,
            completed,
            total
          });
        }
      });
    } catch (error) {
      routeLookup = {
        byForestId: new Map(),
        warnings: [
          `Driving route lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`
        ]
      };
    }

    progressCallback?.({
      phase: "ROUTES",
      message: "Driving routes completed.",
      completed: routableForests.length,
      total: routableForests.length
    });
  }

  return {
    forests: forests.map((forest) => {
      const metric = routeLookup.byForestId.get(forest.id);

      return {
        ...forest,
        distanceKm: metric?.distanceKm ?? null,
        travelDurationMinutes: metric?.durationMinutes ?? null
      };
    }),
    warnings: routeLookup.warnings
  };
}

export function findNearestLegalSpot(
  forests: ForestPoint[],
  userLocation?: UserLocation
): NearestForest | null {
  let nearest: { forest: ForestPoint; effectiveDistanceKm: number } | null = null;

  for (const forest of forests) {
    if (
      forest.banStatus !== "NOT_BANNED" ||
      forest.totalFireBanStatus === "BANNED" ||
      forest.closureStatus === "CLOSED"
    ) {
      continue;
    }

    const effectiveDistanceKm =
      forest.distanceKm ??
      (userLocation && forest.latitude !== null && forest.longitude !== null
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
      nearest = {
        forest,
        effectiveDistanceKm
      };
    }
  }

  if (!nearest) {
    return null;
  }

  const { forest } = nearest;

  return {
    id: forest.id,
    forestName: forest.forestName,
    areaName: forest.areaName,
    distanceKm: forest.distanceKm ?? nearest.effectiveDistanceKm,
    travelDurationMinutes: forest.travelDurationMinutes
  };
}
