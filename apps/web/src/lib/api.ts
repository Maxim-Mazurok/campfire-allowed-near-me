export type BanStatus = "BANNED" | "NOT_BANNED" | "UNKNOWN";

export interface ForestPoint {
  id: string;
  source: string;
  areaName: string;
  areaUrl: string;
  forestName: string;
  banStatus: BanStatus;
  banStatusText: string;
  latitude: number | null;
  longitude: number | null;
  geocodeName: string | null;
  geocodeConfidence: number | null;
  distanceKm: number | null;
}

export interface ForestApiResponse {
  fetchedAt: string;
  stale: boolean;
  sourceName: string;
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
  refresh = false
): Promise<ForestApiResponse> => {
  const url = new URL("/api/forests", window.location.origin);
  if (location) {
    url.searchParams.set("lat", String(location.latitude));
    url.searchParams.set("lng", String(location.longitude));
  }

  if (refresh) {
    url.searchParams.set("refresh", "1");
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(body?.message ?? "Unable to fetch forests");
  }

  return response.json() as Promise<ForestApiResponse>;
};
