export type BanStatus = "BANNED" | "NOT_BANNED" | "UNKNOWN";

export interface ForestAreaSummary {
  areaName: string;
  areaUrl: string;
  status: BanStatus;
  statusText: string;
}

export interface ForestAreaWithForests extends ForestAreaSummary {
  forests: string[];
}

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

export interface UserLocation {
  latitude: number;
  longitude: number;
}

export interface NearestForest {
  id: string;
  forestName: string;
  areaName: string;
  distanceKm: number;
}

export interface ForestApiResponse {
  fetchedAt: string;
  stale: boolean;
  sourceName: string;
  forests: ForestPoint[];
  nearestLegalSpot: NearestForest | null;
  warnings: string[];
}

export interface PersistedSnapshot {
  fetchedAt: string;
  stale: boolean;
  sourceName: string;
  forests: Omit<ForestPoint, "distanceKm">[];
  warnings: string[];
}

export interface ForestDataServiceInput {
  forceRefresh?: boolean;
  userLocation?: UserLocation;
}

export interface ForestDataService {
  getForestData(input?: ForestDataServiceInput): Promise<ForestApiResponse>;
}
