export type BanStatus = "BANNED" | "NOT_BANNED" | "UNKNOWN";
export type RefreshTaskStatus = "IDLE" | "RUNNING" | "COMPLETED" | "FAILED";
export type RefreshTaskPhase =
  | "IDLE"
  | "SCRAPE"
  | "GEOCODE_AREAS"
  | "GEOCODE_FORESTS"
  | "ROUTES"
  | "PERSIST"
  | "DONE";

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

export type ClosureStatus = "NONE" | "NOTICE" | "PARTIAL" | "CLOSED";
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
  status: "NOTICE" | "PARTIAL" | "CLOSED";
  tags: ClosureTagKey[];
  detailText?: string | null;
  structuredImpact?: ClosureNoticeStructuredImpact | null;
}

export interface ClosureMatchDiagnostics {
  unmatchedNotices: ForestClosureNotice[];
  fuzzyMatches: Array<{
    noticeId: string;
    noticeTitle: string;
    matchedForestName: string;
    score: number;
  }>;
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
  facilities: Record<string, boolean | null>;
  closureStatus?: ClosureStatus;
  closureNotices?: ForestClosureNotice[];
  closureTags?: Partial<Record<ClosureTagKey, boolean>>;
  closureImpactSummary?: ClosureImpactSummary;
  distanceKm: number | null;
  travelDurationMinutes: number | null;
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
  availableClosureTags?: ClosureTagDefinition[];
  matchDiagnostics: FacilityMatchDiagnostics;
  closureDiagnostics?: ClosureMatchDiagnostics;
  forests: ForestPoint[];
  nearestLegalSpot: {
    id: string;
    forestName: string;
    areaName: string;
    distanceKm: number;
    travelDurationMinutes: number | null;
  } | null;
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
