import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ForestApiResponse } from "../api";
import {
  fetchDrivingRoutes,
  type RouteDestination,
  type RouteResult,
  type RoutesApiResponse
} from "../routes-api-client";
import { selectForestIdsForRouting } from "../route-selection-heuristic";

const MAX_FORESTS_PER_REQUEST = 25;

interface DrivingRoutesInput {
  userLatitude: number | null;
  userLongitude: number | null;
  forests: ForestApiResponse["forests"];
  /** IDs of forests that pass current user filters. Routes are only
   *  calculated for matching forests (further narrowed by the haversine
   *  heuristic). */
  matchingForestIds: ReadonlySet<string>;
  /** IDs of forests that must always receive driving routes regardless
   *  of user filters. Used for the top-panel "nearest legal campfire"
   *  and "nearest legal campfire with camping" spots so they always
   *  display driving time. */
  priorityForestIds: ReadonlySet<string>;
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
 * Fetches driving routes from the routes proxy worker for the closest
 * matching forests (selected via haversine heuristic). Returns a map
 * of forestId → RouteResult. Automatically batches requests when there
 * are more than 25 selected forests.
 */
export const useDrivingRoutes = ({
  userLatitude,
  userLongitude,
  forests,
  matchingForestIds,
  priorityForestIds,
  avoidTolls
}: DrivingRoutesInput): {
  routesByForestId: Record<string, RouteResult>;
  routesLoading: boolean;
  routesError: string | null;
  quotaExhausted: boolean;
} => {
  // 1. Filter to matching forests only (user-applied filters)
  const matchingForests = useMemo(
    () => forests.filter((forest) => matchingForestIds.has(forest.id)),
    [forests, matchingForestIds]
  );

  // 2. Apply haversine heuristic to select the closest N forests
  const heuristicForestIds = useMemo(
    () => new Set(selectForestIdsForRouting(matchingForests)),
    [matchingForests]
  );

  // 3. Merge priority forest IDs (nearest-legal candidates for top panel)
  //    so they always receive driving routes regardless of user filters.
  const selectedForestIdSet = useMemo(() => {
    if (priorityForestIds.size === 0) {
      return heuristicForestIds;
    }

    const merged = new Set(heuristicForestIds);
    for (const id of priorityForestIds) {
      merged.add(id);
    }
    return merged;
  }, [heuristicForestIds, priorityForestIds]);

  // 4. Build destinations list for selected forests only
  const selectedDestinations = useMemo(
    () =>
      forests
        .filter(
          (forest): forest is typeof forest & { latitude: number; longitude: number } =>
            selectedForestIdSet.has(forest.id) &&
            forest.latitude !== null &&
            forest.longitude !== null
        )
        .map((forest) => ({
          id: forest.id,
          latitude: forest.latitude,
          longitude: forest.longitude
        })),
    [forests, selectedForestIdSet]
  );

  const selectedDestinationIds = useMemo(
    () => selectedDestinations.map((destination) => destination.id),
    [selectedDestinations]
  );

  const enabled =
    userLatitude !== null &&
    userLongitude !== null &&
    selectedDestinationIds.length > 0;

  const queryKey = useMemo(
    () =>
      buildRoutesQueryKey(
        userLatitude,
        userLongitude,
        selectedDestinationIds,
        avoidTolls
      ),
    [userLatitude, userLongitude, selectedDestinationIds, avoidTolls]
  );

  const query = useQuery<RoutesApiResponse>({
    queryKey,
    enabled,
    staleTime: 5 * 60 * 1_000,
    gcTime: 10 * 60 * 1_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (userLatitude === null || userLongitude === null) {
        return { routes: {}, warnings: [], quotaExhausted: false };
      }

      const origin = { latitude: userLatitude, longitude: userLongitude };

      if (selectedDestinations.length <= MAX_FORESTS_PER_REQUEST) {
        return fetchDrivingRoutes(
          { origin, destinations: selectedDestinations, avoidTolls },
          signal
        );
      }

      const batches: RouteDestination[][] = [];
      for (
        let offset = 0;
        offset < selectedDestinations.length;
        offset += MAX_FORESTS_PER_REQUEST
      ) {
        batches.push(
          selectedDestinations.slice(offset, offset + MAX_FORESTS_PER_REQUEST)
        );
      }

      const batchResults = await Promise.all(
        batches.map((batchDestinations) =>
          fetchDrivingRoutes(
            { origin, destinations: batchDestinations, avoidTolls },
            signal
          )
        )
      );

      const mergedRoutes: Record<string, RouteResult> = {};
      const mergedWarnings: string[] = [];
      let anyQuotaExhausted = false;

      for (const batchResult of batchResults) {
        Object.assign(mergedRoutes, batchResult.routes);
        mergedWarnings.push(...batchResult.warnings);
        if (batchResult.quotaExhausted) {
          anyQuotaExhausted = true;
        }
      }

      return {
        routes: mergedRoutes,
        warnings: mergedWarnings,
        quotaExhausted: anyQuotaExhausted
      };
    }
  });

  const routesByForestId = query.data?.routes ?? {};
  const quotaExhausted = query.data?.quotaExhausted ?? false;
  const routesLoading = query.isFetching;
  const routesError = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Failed to fetch driving routes"
    : null;

  return { routesByForestId, routesLoading, routesError, quotaExhausted };
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
