import type { QueryFunctionContext } from "@tanstack/react-query";
import type { ForestApiResponse } from "./api";
import { fetchStaticSnapshot } from "./static-snapshot";

export type UserLocation = {
  latitude: number;
  longitude: number;
};

export const buildForestsQueryKey = (
  location: UserLocation | null
) =>
  [
    "forests",
    location?.latitude ?? null,
    location?.longitude ?? null
  ] as const;

export type ForestsQueryKey = ReturnType<typeof buildForestsQueryKey>;

export const forestsQueryFn =
  (
    location: UserLocation | null
  ) =>
  ({ signal }: QueryFunctionContext<ForestsQueryKey>): Promise<ForestApiResponse> =>
    fetchStaticSnapshot(location ?? undefined, signal);

export const toLoadErrorMessage = (error: unknown): string | null => {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : "Unknown load error";
};
