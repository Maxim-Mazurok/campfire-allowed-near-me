export type BanStatus = "BANNED" | "NOT_BANNED" | "UNKNOWN";

export type FacilityValue = boolean | null;

export interface FacilityDefinition {
  key: string;
  label: string;
  paramName: string;
  iconKey: string;
}

export interface FacilityForestEntry {
  forestName: string;
  forestUrl?: string | null;
  facilities: Record<string, boolean>;
}

export interface ForestDirectorySnapshot {
  filters: FacilityDefinition[];
  forests: FacilityForestEntry[];
  warnings: string[];
}

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
  forestUrl?: string | null;
  banStatus: BanStatus;
  banStatusText: string;
  latitude: number | null;
  longitude: number | null;
  geocodeName: string | null;
  geocodeConfidence: number | null;
  facilities: Record<string, FacilityValue>;
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

export interface FuzzyFacilityMatch {
  fireBanForestName: string;
  facilitiesForestName: string;
  score: number;
}

export interface FacilityMatchDiagnostics {
  unmatchedFacilitiesForests: string[];
  fuzzyMatches: FuzzyFacilityMatch[];
}

export interface ForestApiResponse {
  fetchedAt: string;
  stale: boolean;
  sourceName: string;
  availableFacilities: FacilityDefinition[];
  matchDiagnostics: FacilityMatchDiagnostics;
  forests: ForestPoint[];
  nearestLegalSpot: NearestForest | null;
  warnings: string[];
}

export interface PersistedSnapshot {
  schemaVersion?: number;
  fetchedAt: string;
  stale: boolean;
  sourceName: string;
  availableFacilities: FacilityDefinition[];
  matchDiagnostics: FacilityMatchDiagnostics;
  forests: Omit<ForestPoint, "distanceKm">[];
  warnings: string[];
}

export interface ForestDataServiceInput {
  forceRefresh?: boolean;
  userLocation?: UserLocation;
}

export interface ForestryScrapeResult {
  areas: ForestAreaWithForests[];
  directory: ForestDirectorySnapshot;
  warnings: string[];
}

export interface ForestDataService {
  getForestData(input?: ForestDataServiceInput): Promise<ForestApiResponse>;
}
