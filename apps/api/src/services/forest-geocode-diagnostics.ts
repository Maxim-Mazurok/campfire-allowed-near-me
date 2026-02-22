import type {
  ForestGeocodeDiagnostics,
  ForestTotalFireBanDiagnostics
} from "../types/domain.js";
import type {
  GeocodeLookupAttempt,
  GeocodeResponse
} from "./osm-geocoder.js";
import type {
  TotalFireBanLookupResult,
  TotalFireBanSnapshot
} from "./total-fire-ban-service.js";

export function getGeocodeAttempts(
  response: GeocodeResponse | null | undefined
): GeocodeLookupAttempt[] {
  if (!response?.attempts) {
    return [];
  }

  return response.attempts;
}

export function describeGeocodeAttempt(prefix: string, attempt: GeocodeLookupAttempt): string {
  const details: string[] = [
    `${prefix}: ${attempt.outcome}`,
    `provider=${attempt.provider}`,
    `query=${attempt.query}`
  ];
  if (attempt.httpStatus !== null) {
    details.push(`http=${attempt.httpStatus}`);
  }
  if (attempt.resultCount !== null) {
    details.push(`results=${attempt.resultCount}`);
  }
  if (attempt.errorMessage) {
    details.push(`error=${attempt.errorMessage}`);
  }

  return details.join(" | ");
}

export function selectGeocodeFailureReason(attempts: GeocodeLookupAttempt[]): string {
  if (attempts.some((attempt) => attempt.outcome === "LIMIT_REACHED")) {
    return "Geocoding lookup limit reached before coordinates were resolved.";
  }

  if (attempts.some((attempt) => attempt.outcome === "GOOGLE_API_KEY_MISSING")) {
    return "Google Places geocoding is unavailable because GOOGLE_MAPS_API_KEY is missing.";
  }

  if (
    attempts.some(
      (attempt) => attempt.outcome === "HTTP_ERROR" || attempt.outcome === "REQUEST_FAILED"
    )
  ) {
    return "Geocoding request failed before coordinates were resolved.";
  }

  if (
    attempts.some(
      (attempt) =>
        attempt.outcome === "EMPTY_RESULT" || attempt.outcome === "INVALID_COORDINATES"
    )
  ) {
    return "No usable geocoding results were returned for this forest.";
  }

  return "Coordinates were unavailable after forest and area geocoding.";
}

export function buildGeocodeDiagnostics(
  forestLookup: GeocodeResponse,
  areaLookup?: GeocodeResponse | null
): ForestGeocodeDiagnostics {
  const forestAttempts = getGeocodeAttempts(forestLookup);
  const areaAttempts = getGeocodeAttempts(areaLookup);
  const allAttempts = [...forestAttempts, ...areaAttempts];
  const debug = [
    ...forestAttempts.map((attempt) => describeGeocodeAttempt("Forest lookup", attempt)),
    ...areaAttempts.map((attempt) => describeGeocodeAttempt("Area fallback", attempt))
  ];

  if (!debug.length) {
    debug.push("No geocoding attempt diagnostics were captured in this snapshot.");
  }

  return {
    reason: selectGeocodeFailureReason(allAttempts),
    debug
  };
}

export function shouldUseAreaFallbackForForestLookup(forestLookup: GeocodeResponse): boolean {
  const attempts = getGeocodeAttempts(forestLookup);

  if (!attempts.length) {
    return true;
  }

  const hasNoResultOutcome = attempts.some(
    (attempt) =>
      attempt.outcome === "EMPTY_RESULT" || attempt.outcome === "INVALID_COORDINATES"
  );

  const hasTransientOrConfigFailure = attempts.some(
    (attempt) =>
      attempt.outcome === "LIMIT_REACHED" ||
      attempt.outcome === "HTTP_ERROR" ||
      attempt.outcome === "REQUEST_FAILED" ||
      attempt.outcome === "GOOGLE_API_KEY_MISSING"
  );

  return hasNoResultOutcome && !hasTransientOrConfigFailure;
}

export function buildTotalFireBanDiagnostics(
  totalFireBanLookup: TotalFireBanLookupResult,
  latitude: number | null,
  longitude: number | null,
  totalFireBanSnapshot: TotalFireBanSnapshot
): ForestTotalFireBanDiagnostics | null {
  if (totalFireBanLookup.status !== "UNKNOWN") {
    return null;
  }

  const reason =
    totalFireBanLookup.lookupCode === "NO_COORDINATES"
      ? "Coordinates were unavailable, so Total Fire Ban lookup could not run."
      : totalFireBanLookup.lookupCode === "NO_AREA_MATCH"
        ? "Coordinates did not match a NSW RFS fire weather area polygon."
        : totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS"
          ? "A fire weather area was matched, but the status feed had no status entry for that area."
          : totalFireBanLookup.lookupCode === "DATA_UNAVAILABLE"
            ? "Total Fire Ban source data was unavailable or incomplete during lookup."
            : "Matched fire weather area returned an unknown Total Fire Ban status value.";

  const debug = [
    `lookupCode=${totalFireBanLookup.lookupCode}`,
    `statusText=${totalFireBanLookup.statusText}`,
    `latitude=${latitude === null ? "null" : String(latitude)}`,
    `longitude=${longitude === null ? "null" : String(longitude)}`,
    `fireWeatherAreaName=${totalFireBanLookup.fireWeatherAreaName ?? "null"}`,
    `snapshotAreaStatuses=${totalFireBanSnapshot.areaStatuses.length}`,
    `snapshotGeoAreas=${totalFireBanSnapshot.geoAreas.length}`,
    `snapshotWarnings=${totalFireBanSnapshot.warnings.length}`
  ];

  if (totalFireBanLookup.rawStatusText !== null) {
    debug.push(`rawStatusText=${totalFireBanLookup.rawStatusText}`);
  }

  return {
    reason,
    lookupCode: totalFireBanLookup.lookupCode,
    fireWeatherAreaName: totalFireBanLookup.fireWeatherAreaName,
    debug
  };
}

export function collectGeocodeWarnings(
  warningSet: Set<string>,
  response: GeocodeResponse | null | undefined
): void {
  for (const warning of response?.warnings ?? []) {
    warningSet.add(warning);
  }
}
