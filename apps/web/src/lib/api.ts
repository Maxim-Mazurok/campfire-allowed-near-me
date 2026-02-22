export type BanStatus = "BANNED" | "NOT_BANNED" | "UNKNOWN";

export interface FacilityDefinition {
  key: string;
  label: string;
  paramName: string;
  iconKey: string;
}

export interface ForestPoint {
  id: string;
  source: string;
  areaName: string;
  areaUrl: string;
  forestName: string;
  forestUrl?: string | null;
  banStatus: BanStatus;
  banStatusText: string;
  latitude: number | null;
  longitude: number | null;
  geocodeName: string | null;
  geocodeConfidence: number | null;
  facilities: Record<string, boolean | null>;
  distanceKm: number | null;
}

export interface FacilityMatchDiagnostics {
  unmatchedFacilitiesForests: string[];
  fuzzyMatches: Array<{
    fireBanForestName: string;
    facilitiesForestName: string;
    score: number;
  }>;
}

export interface ForestApiResponse {
  fetchedAt: string;
  stale: boolean;
  sourceName: string;
  availableFacilities: FacilityDefinition[];
  matchDiagnostics: FacilityMatchDiagnostics;
  forests: ForestPoint[];
  nearestLegalSpot: {
    id: string;
    forestName: string;
    areaName: string;
    distanceKm: number;
  } | null;
  warnings: string[];
}

export const fetchForests = async (
  location?: { latitude: number; longitude: number },
  refresh = false,
  signal?: AbortSignal
): Promise<ForestApiResponse> => {
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

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(body?.message ?? "Unable to fetch forests");
  }

  return response.json() as Promise<ForestApiResponse>;
};
