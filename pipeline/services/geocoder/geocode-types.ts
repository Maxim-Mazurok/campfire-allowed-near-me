export type GeocodeProvider = "FCNSW_ARCGIS" | "GOOGLE_GEOCODING" | "OSM_NOMINATIM";

export interface GeocodeHit {
  latitude: number;
  longitude: number;
  displayName: string;
  importance: number;
  provider: GeocodeProvider;
  updatedAt: string;
}

export interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

export interface FcnswArcgisFeatureAttributes {
  SFName: string;
  SFNo: number;
  [key: string]: unknown;
}

export interface FcnswArcgisRing {
  rings: number[][][];
}

export interface FcnswArcgisFeature {
  attributes: FcnswArcgisFeatureAttributes;
  geometry?: FcnswArcgisRing;
}

export interface FcnswArcgisQueryResponse {
  features?: FcnswArcgisFeature[];
  error?: { code: number; message: string };
}

export interface GoogleGeocodingResult {
  formatted_address?: string;
  types?: string[];
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
}

export interface GoogleGeocodingResponse {
  status: string;
  results?: GoogleGeocodingResult[];
}

export type GeocodeLookupOutcome =
  | "CACHE_HIT"
  | "LOOKUP_SUCCESS"
  | "LIMIT_REACHED"
  | "HTTP_ERROR"
  | "REQUEST_FAILED"
  | "EMPTY_RESULT"
  | "INVALID_COORDINATES"
  | "GOOGLE_API_KEY_MISSING"
  | "FCNSW_MULTIPLE_MATCHES";

export interface GeocodeLookupAttempt {
  provider: GeocodeProvider | "CACHE";
  query: string;
  aliasKey: string | null;
  cacheKey: string;
  outcome: GeocodeLookupOutcome;
  httpStatus: number | null;
  resultCount: number | null;
  errorMessage: string | null;
}

export interface GeocodeResponse {
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  confidence: number | null;
  provider: GeocodeProvider | null;
  warnings?: string[];
  attempts?: GeocodeLookupAttempt[];
}

export interface ProviderResult {
  hit: GeocodeHit | null;
  attempt: GeocodeLookupAttempt;
}

export const NOMINATIM_FALLBACK_WARNING =
  "Google Geocoding failed for one or more lookups; OpenStreetMap Nominatim fallback coordinates were used where available.";
export const GOOGLE_KEY_MISSING_WARNING =
  "Google Geocoding is unavailable because GOOGLE_MAPS_API_KEY is not configured; OpenStreetMap Nominatim fallback geocoding is active.";
export const DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
export const DEFAULT_LOCAL_NOMINATIM_PORT = "8080";
export const DEFAULT_LOCAL_NOMINATIM_DELAY_MS = 200;
export const DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRIES = 4;
export const DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRY_DELAY_MS = 1_500;

export const FCNSW_ARCGIS_QUERY_URL =
  "https://services2.arcgis.com/iCBB4zKDwkw2iwDD/arcgis/rest/services/NSW_Dedicated_State_Forests/FeatureServer/0/query";
