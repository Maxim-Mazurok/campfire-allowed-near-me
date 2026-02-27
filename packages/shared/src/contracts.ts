export type BanStatus = "BANNED" | "NOT_BANNED" | "UNKNOWN";

/**
 * Where the solid-fuel fire ban applies.
 * - ALL: the ban (or absence thereof) applies everywhere – no camp-specific distinction.
 * - OUTSIDE_CAMPS: fires are banned outside designated campgrounds but *permitted* inside.
 * - INCLUDING_CAMPS: fires are banned in all areas *including* camping areas.
 */
export type SolidFuelBanScope = "ALL" | "OUTSIDE_CAMPS" | "INCLUDING_CAMPS";

export type RefreshTaskStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
export type RefreshTaskPhase =
  | "IDLE"
  | "SCRAPE"
  | "GEOCODE_FORESTS"
  | "ROUTES"
  | "PERSIST"
  | "DONE";

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

export type ClosureNoticeStatus = "NOTICE" | "PARTIAL" | "CLOSED";
export type ClosureStatus = "NONE" | ClosureNoticeStatus;
export type ClosureTagKey = "ROAD_ACCESS" | "CAMPING" | "EVENT" | "OPERATIONS";
export type ClosureImpactLevel = "NONE" | "ADVISORY" | "RESTRICTED" | "CLOSED" | "UNKNOWN";
export type ClosureImpactConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface ClosureTagDefinition {
  key: ClosureTagKey;
  label: string;
}

export interface ClosureNoticeStructuredImpact {
  source: "RULES" | "LLM";
  confidence: ClosureImpactConfidence;
  campingImpact: ClosureImpactLevel;
  access2wdImpact: ClosureImpactLevel;
  access4wdImpact: ClosureImpactLevel;
  rationale: string | null;
}

export interface ClosureImpactSummary {
  campingImpact: ClosureImpactLevel;
  access2wdImpact: ClosureImpactLevel;
  access4wdImpact: ClosureImpactLevel;
}

export interface ForestClosureNotice {
  id: string;
  title: string;
  detailUrl: string;
  listedAt: string | null;
  listedAtText: string | null;
  untilAt: string | null;
  untilText: string | null;
  forestNameHint: string | null;
  status: ClosureNoticeStatus;
  tags: ClosureTagKey[];
  detailText?: string | null;
  structuredImpact?: ClosureNoticeStructuredImpact | null;
}

export interface FuzzyClosureMatch {
  noticeId: string;
  noticeTitle: string;
  matchedForestName: string;
  score: number;
}

export interface ClosureMatchDiagnostics {
  unmatchedNotices: ForestClosureNotice[];
  fuzzyMatches: FuzzyClosureMatch[];
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
  banScope: SolidFuelBanScope;
}

export interface ForestAreaWithForests extends ForestAreaSummary {
  forests: string[];
}

export interface ForestAreaReference {
  areaName: string;
  areaUrl: string;
  banStatus: BanStatus;
  banStatusText: string;
  banScope: SolidFuelBanScope;
}

export interface ForestPoint {
  id: string;
  source: string;
  areas: ForestAreaReference[];
  forestName: string;
  forestUrl?: string | null;
  totalFireBanStatus: BanStatus;
  totalFireBanStatusText: string;
  latitude: number | null;
  longitude: number | null;
  geocodeName: string | null;
  geocodeDiagnostics?: ForestGeocodeDiagnostics | null;
  totalFireBanDiagnostics?: ForestTotalFireBanDiagnostics | null;
  facilities: Record<string, FacilityValue>;
  closureStatus?: ClosureStatus;
  closureNotices?: ForestClosureNotice[];
  closureTags?: Partial<Record<ClosureTagKey, boolean>>;
  closureImpactSummary?: ClosureImpactSummary;
  distanceKm: number | null;
  travelDurationMinutes: number | null;
}

export interface UserLocation {
  latitude: number;
  longitude: number;
}

export interface NearestForest {
  id: string;
  forestName: string;
  distanceKm: number;
  travelDurationMinutes: number | null;
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
  availableClosureTags?: ClosureTagDefinition[];
  matchDiagnostics: FacilityMatchDiagnostics;
  closureDiagnostics?: ClosureMatchDiagnostics;
  forests: ForestPoint[];
  nearestLegalSpot: NearestForest | null;
  warnings: string[];
  refreshTask?: RefreshTaskState | null;
}

export interface RefreshTaskProgress {
  phase: RefreshTaskPhase;
  message: string;
  completed: number;
  total: number | null;
}

export interface RefreshTaskState {
  taskId: string | null;
  status: RefreshTaskStatus;
  phase: RefreshTaskPhase;
  message: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  progress: RefreshTaskProgress | null;
}

export interface PersistedSnapshot {
  schemaVersion?: number;
  fetchedAt: string;
  stale: boolean;
  sourceName: string;
  availableFacilities: FacilityDefinition[];
  availableClosureTags?: ClosureTagDefinition[];
  matchDiagnostics: FacilityMatchDiagnostics;
  closureDiagnostics?: ClosureMatchDiagnostics;
  forests: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[];
  warnings: string[];
}

export type ForestLoadStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";

export interface ForestLoadProgressState {
  requestId: string | null;
  status: ForestLoadStatus;
  phase: RefreshTaskPhase;
  message: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
  progress: RefreshTaskProgress | null;
  activeRequestCount: number;
}
