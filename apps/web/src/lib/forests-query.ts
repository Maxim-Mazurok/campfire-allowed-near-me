import type { QueryFunctionContext } from "@tanstack/react-query";
import { fetchForests, type ForestApiResponse } from "./api";
import { fetchStaticSnapshot } from "./static-snapshot";

export type UserLocation = {
  latitude: number;
  longitude: number;
};

export type RoutePreferences = {
  avoidTolls: boolean;
};

export const isStaticMode =
  !import.meta.env.DEV && import.meta.env.VITE_ENABLE_API !== "true";

export const buildForestsQueryKey = (
  location: UserLocation | null,
  routePreferences: RoutePreferences
) =>
  [
    "forests",
    location?.latitude ?? null,
    location?.longitude ?? null,
    routePreferences.avoidTolls ? "no-tolls" : "allow-tolls"
  ] as const;

export type ForestsQueryKey = ReturnType<typeof buildForestsQueryKey>;

export const forestsQueryFn =
  (
    location: UserLocation | null,
    routePreferences: RoutePreferences,
    refresh = false
  ) =>
  ({ signal }: QueryFunctionContext<ForestsQueryKey>): Promise<ForestApiResponse> => {
    if (isStaticMode) {
      return fetchStaticSnapshot(location ?? undefined, signal);
    }

    return fetchForests(
      location ?? undefined,
      { refresh, avoidTolls: routePreferences.avoidTolls },
      signal
    );
  };

export const toLoadErrorMessage = (error: unknown): string | null => {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : "Unknown load error";
};
