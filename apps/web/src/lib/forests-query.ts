import type { QueryFunctionContext } from "@tanstack/react-query";
import { fetchForests, type ForestApiResponse } from "./api";

export type UserLocation = {
  latitude: number;
  longitude: number;
};

export const buildForestsQueryKey = (location: UserLocation | null) =>
  ["forests", location?.latitude ?? null, location?.longitude ?? null] as const;

export type ForestsQueryKey = ReturnType<typeof buildForestsQueryKey>;

export const forestsQueryFn =
  (location: UserLocation | null, refresh = false) =>
  ({ signal }: QueryFunctionContext<ForestsQueryKey>): Promise<ForestApiResponse> =>
    fetchForests(location ?? undefined, refresh, signal);

export const toLoadErrorMessage = (error: unknown): string | null => {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : "Unknown load error";
};
