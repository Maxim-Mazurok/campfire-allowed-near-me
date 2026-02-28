import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ForestApiResponse } from "../api";
import {
  fetchDrivingRoutes,
  type RouteResult,
  type RoutesApiResponse
} from "../routes-api-client";

const MAX_FORESTS_PER_REQUEST = 25;

interface DrivingRoutesInput {
  userLatitude: number | null;
  userLongitude: number | null;
  forests: ForestApiResponse["forests"];
  avoidTolls: boolean;
}

const buildRoutesQueryKey = (
  userLatitude: number | null,
  userLongitude: number | null,
  forestIds: string[],
  avoidTolls: boolean
) =>
  ["driving-routes", userLatitude, userLongitude, avoidTolls, forestIds] as const;

/**
 * Fetches driving routes from the routes proxy worker and returns a
 * map of forestId → RouteResult. Automatically batches requests when
 * there are more than 25 geocoded forests.
 */
export const useDrivingRoutes = ({
  userLatitude,
  userLongitude,
  forests,
  avoidTolls
}: DrivingRoutesInput): {
  routesByForestId: Record<string, RouteResult>;
  routesLoading: boolean;
  routesError: string | null;
} => {
  const geocodedForestIds = useMemo(
    () =>
      forests
        .filter(
          (forest) =>
            forest.latitude !== null && forest.longitude !== null
        )
        .map((forest) => forest.id),
    [forests]
  );

  const enabled =
    userLatitude !== null &&
    userLongitude !== null &&
    geocodedForestIds.length > 0;

  const queryKey = useMemo(
    () =>
      buildRoutesQueryKey(
        userLatitude,
        userLongitude,
        geocodedForestIds,
        avoidTolls
      ),
    [userLatitude, userLongitude, geocodedForestIds, avoidTolls]
  );

  const query = useQuery<RoutesApiResponse>({
    queryKey,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (userLatitude === null || userLongitude === null) {
        return { routes: {}, warnings: [] };
      }

      const origin = { latitude: userLatitude, longitude: userLongitude };

      if (geocodedForestIds.length <= MAX_FORESTS_PER_REQUEST) {
        return fetchDrivingRoutes(
          { origin, forestIds: geocodedForestIds, avoidTolls },
          signal
        );
      }

      const batches: string[][] = [];
      for (
        let offset = 0;
        offset < geocodedForestIds.length;
        offset += MAX_FORESTS_PER_REQUEST
      ) {
        batches.push(
          geocodedForestIds.slice(offset, offset + MAX_FORESTS_PER_REQUEST)
        );
      }

      const batchResults = await Promise.all(
        batches.map((batchForestIds) =>
          fetchDrivingRoutes(
            { origin, forestIds: batchForestIds, avoidTolls },
            signal
          )
        )
      );

      const mergedRoutes: Record<string, RouteResult> = {};
      const mergedWarnings: string[] = [];

      for (const batchResult of batchResults) {
        Object.assign(mergedRoutes, batchResult.routes);
        mergedWarnings.push(...batchResult.warnings);
      }

      return { routes: mergedRoutes, warnings: mergedWarnings };
    }
  });

  const routesByForestId = query.data?.routes ?? {};
  const routesLoading = query.isFetching;
  const routesError = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Failed to fetch driving routes"
    : null;

  return { routesByForestId, routesLoading, routesError };
};

/**
 * Merges driving route data into forest points, replacing haversine
 * distances with real driving distances and adding travel durations.
 */
export const mergeDrivingRoutes = (
  forests: ForestApiResponse["forests"],
  routesByForestId: Record<string, RouteResult>
): ForestApiResponse["forests"] => {
  if (Object.keys(routesByForestId).length === 0) {
    return forests;
  }

  return forests.map((forest) => {
    const route = routesByForestId[forest.id];
    if (!route) {
      return forest;
    }

    return {
      ...forest,
      distanceKm: route.distanceKm,
      travelDurationMinutes: route.durationMinutes
    };
  });
};
