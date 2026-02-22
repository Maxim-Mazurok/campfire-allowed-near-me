export type BanStatus = "BANNED" | "NOT_BANNED" | "UNKNOWN";

export type FacilityValue = boolean | null;

export interface FacilityDefinition {
  key: string;
  label: string;
  paramName: string;
  iconKey: string;
}

export interface ForestGeocodeDiagnostics {
  reason: string;
  debug: string[];
}

export type TotalFireBanLookupCode =
  | "MATCHED"
  | "NO_COORDINATES"
  | "NO_AREA_MATCH"
  | "MISSING_AREA_STATUS"
  | "DATA_UNAVAILABLE";

export interface ForestTotalFireBanDiagnostics {
  reason: string;
  lookupCode: TotalFireBanLookupCode;
  fireWeatherAreaName: string | null;
  debug: string[];
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
  totalFireBanStatus: BanStatus;
  totalFireBanStatusText: string;
  latitude: number | null;
  longitude: number | null;
  geocodeName: string | null;
  geocodeConfidence: number | null;
  geocodeDiagnostics?: ForestGeocodeDiagnostics | null;
  totalFireBanDiagnostics?: ForestTotalFireBanDiagnostics | null;
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
