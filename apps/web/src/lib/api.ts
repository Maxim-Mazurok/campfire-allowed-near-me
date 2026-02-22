import type {
  ForestApiResponse,
  RefreshTaskState
} from "../../../../packages/shared/src/contracts.js";

export type {
  BanStatus,
  ClosureImpactConfidence,
  ClosureImpactLevel,
  ClosureImpactSummary,
  ClosureMatchDiagnostics,
  ClosureNoticeStatus,
  ClosureNoticeStructuredImpact,
  ClosureStatus,
  ClosureTagDefinition,
  ClosureTagKey,
  FacilityDefinition,
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestApiResponse,
  ForestClosureNotice,
  ForestGeocodeDiagnostics,
  ForestLoadProgressState,
  ForestLoadStatus,
  ForestPoint,
  ForestTotalFireBanDiagnostics,
  NearestForest,
  RefreshTaskPhase,
  RefreshTaskProgress,
  RefreshTaskState,
  RefreshTaskStatus,
  TotalFireBanLookupCode
} from "../../../../packages/shared/src/contracts.js";

export const fetchRefreshTaskStatus = async (
  signal?: AbortSignal
): Promise<RefreshTaskState> => {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL("/api/refresh/status", origin);
  const response = await fetch(url.toString(), { signal });

  if (!response.ok) {
    throw new Error("Unable to fetch refresh task status");
  }

  return response.json() as Promise<RefreshTaskState>;
};

export const fetchForests = async (
  location?: { latitude: number; longitude: number },
  options?: {
    refresh?: boolean;
    avoidTolls?: boolean;
  },
  signal?: AbortSignal
): Promise<ForestApiResponse> => {
  const refresh = options?.refresh ?? false;
  const avoidTolls = options?.avoidTolls ?? true;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost";
  const url = new URL("/api/forests", origin);
  if (location) {
    url.searchParams.set("lat", String(location.latitude));
    url.searchParams.set("lng", String(location.longitude));
  }

  if (refresh) {
    url.searchParams.set("refresh", "1");
  }

  url.searchParams.set("tolls", avoidTolls ? "avoid" : "allow");

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(body?.message ?? "Unable to fetch forests");
  }

  return response.json() as Promise<ForestApiResponse>;
};
