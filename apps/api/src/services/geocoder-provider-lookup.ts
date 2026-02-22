import type { GeocodeHit, GeocodeProvider } from "./geocoder-sqlite-cache.js";

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

interface GooglePlacesSearchResponse {
  places?: Array<{
    id?: string;
    formattedAddress?: string;
    displayName?: {
      text?: string;
      languageCode?: string;
    };
    location?: {
      latitude?: number;
      longitude?: number;
    };
  }>;
}

export type GeocodeLookupOutcome =
  | "CACHE_HIT"
  | "LOOKUP_SUCCESS"
  | "LIMIT_REACHED"
  | "HTTP_ERROR"
  | "REQUEST_FAILED"
  | "EMPTY_RESULT"
  | "INVALID_COORDINATES"
  | "GOOGLE_API_KEY_MISSING";

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

const DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message.trim();
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Unknown error";
};

const shouldRetryHttpStatus = (httpStatus: number): boolean =>
  httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;

const isLocalNominatimBaseUrl = (baseUrl: string): boolean => {
  try {
    const parsedUrl = new URL(baseUrl);
    const hostname = parsedUrl.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "host.docker.internal"
    );
  } catch {
    return false;
  }
};

export function buildAttempt(
  provider: GeocodeProvider | "CACHE",
  query: string,
  aliasKey: string | null,
  cacheKey: string,
  outcome: GeocodeLookupOutcome,
  options?: {
    httpStatus?: number | null;
    resultCount?: number | null;
    errorMessage?: string | null;
  }
): GeocodeLookupAttempt {
  return {
    provider,
    query,
    aliasKey,
    cacheKey,
    outcome,
    httpStatus: options?.httpStatus ?? null,
    resultCount: options?.resultCount ?? null,
    errorMessage: options?.errorMessage ?? null
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: abortController.signal
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function runWithRetries(
  executeAttempt: () => Promise<Response>,
  retryAttempts: number,
  retryBaseDelayMs: number
): Promise<{ response: Response | null; error: string | null }> {
  let lastError: string | null = null;

  for (let attemptNumber = 1; attemptNumber <= retryAttempts; attemptNumber += 1) {
    try {
      const response = await executeAttempt();

      if (shouldRetryHttpStatus(response.status) && attemptNumber < retryAttempts) {
        const backoffDelayMs = retryBaseDelayMs * 2 ** (attemptNumber - 1);
        await sleep(backoffDelayMs);
        continue;
      }

      return { response, error: null };
    } catch (error) {
      lastError = toErrorMessage(error);
      if (attemptNumber < retryAttempts) {
        const backoffDelayMs = retryBaseDelayMs * 2 ** (attemptNumber - 1);
        await sleep(backoffDelayMs);
        continue;
      }
    }
  }

  return { response: null, error: lastError };
}

export interface GoogleLookupConfig {
  googleApiKey: string | null;
  requestTimeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
}

export async function lookupGooglePlaces(
  config: GoogleLookupConfig,
  query: string,
  aliasKey: string | null,
  cacheKey: string
): Promise<{ hit: GeocodeHit | null; attempt: GeocodeLookupAttempt }> {
  const { googleApiKey, requestTimeoutMs, retryAttempts, retryBaseDelayMs } = config;

  if (!googleApiKey) {
    return {
      hit: null,
      attempt: buildAttempt("GOOGLE_PLACES", query, aliasKey, cacheKey, "GOOGLE_API_KEY_MISSING")
    };
  }

  const body = {
    textQuery: query,
    maxResultCount: 1,
    languageCode: "en",
    regionCode: "AU"
  };

  const googleRequest = await runWithRetries(
    () =>
      fetchWithTimeout(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": googleApiKey,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location"
          },
          body: JSON.stringify(body)
        },
        requestTimeoutMs
      ),
    retryAttempts,
    retryBaseDelayMs
  );

  if (!googleRequest.response) {
    return {
      hit: null,
      attempt: buildAttempt("GOOGLE_PLACES", query, aliasKey, cacheKey, "REQUEST_FAILED", {
        errorMessage: googleRequest.error
      })
    };
  }

  const response = googleRequest.response;

  if (!response.ok) {
    return {
      hit: null,
      attempt: buildAttempt("GOOGLE_PLACES", query, aliasKey, cacheKey, "HTTP_ERROR", {
        httpStatus: response.status
      })
    };
  }

  let rows: GooglePlacesSearchResponse;
  try {
    rows = (await response.json()) as GooglePlacesSearchResponse;
  } catch (error) {
    return {
      hit: null,
      attempt: buildAttempt("GOOGLE_PLACES", query, aliasKey, cacheKey, "REQUEST_FAILED", {
        errorMessage: `Invalid JSON response: ${toErrorMessage(error)}`
      })
    };
  }

  const places = rows.places ?? [];
  const first = places[0];

  if (!first?.location) {
    return {
      hit: null,
      attempt: buildAttempt("GOOGLE_PLACES", query, aliasKey, cacheKey, "EMPTY_RESULT", {
        resultCount: places.length
      })
    };
  }

  const latitude = Number(first.location.latitude);
  const longitude = Number(first.location.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      hit: null,
      attempt: buildAttempt("GOOGLE_PLACES", query, aliasKey, cacheKey, "INVALID_COORDINATES", {
        resultCount: places.length
      })
    };
  }

  const displayName =
    first.displayName?.text?.trim() ||
    first.formattedAddress?.trim() ||
    query;

  const hit: GeocodeHit = {
    latitude,
    longitude,
    displayName,
    importance: 1,
    provider: "GOOGLE_PLACES",
    updatedAt: new Date().toISOString()
  };

  return {
    hit,
    attempt: buildAttempt("GOOGLE_PLACES", query, aliasKey, cacheKey, "LOOKUP_SUCCESS", {
      resultCount: places.length
    })
  };
}

export interface NominatimLookupConfig {
  nominatimBaseUrl: string;
  requestTimeoutMs: number;
  requestDelayMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  localNominatimDelayMs: number;
  localNominatimHttp429Retries: number;
  localNominatimHttp429RetryDelayMs: number;
}

export async function lookupNominatim(
  config: NominatimLookupConfig,
  query: string,
  aliasKey: string | null,
  cacheKey: string
): Promise<{ hit: GeocodeHit | null; attempt: GeocodeLookupAttempt }> {
  const {
    nominatimBaseUrl,
    requestTimeoutMs,
    requestDelayMs,
    retryAttempts,
    retryBaseDelayMs,
    localNominatimDelayMs,
    localNominatimHttp429Retries,
    localNominatimHttp429RetryDelayMs
  } = config;

  const nominatimBaseUrls = [nominatimBaseUrl, DEFAULT_NOMINATIM_BASE_URL];
  const uniqueNominatimBaseUrls = [...new Set(nominatimBaseUrls.map((u) => u.trim()))].filter(
    Boolean
  );

  let lastHttpStatus: number | null = null;
  let lastErrorMessage: string | null = null;

  for (const baseUrl of uniqueNominatimBaseUrls) {
    const isLocalNominatim = isLocalNominatimBaseUrl(baseUrl);
    let localNominatimHttp429RetryCount = 0;

    while (true) {
      const url = new URL("/search", baseUrl);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("countrycodes", "au");
      url.searchParams.set("limit", "1");

      const nominatimRequest = await runWithRetries(
        () =>
          fetchWithTimeout(
            url.toString(),
            {
              headers: {
                "User-Agent":
                  "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire ban lookup)",
                Accept: "application/json"
              }
            },
            requestTimeoutMs
          ),
        retryAttempts,
        retryBaseDelayMs
      );

      if (isLocalNominatim && localNominatimDelayMs > 0) {
        await sleep(localNominatimDelayMs);
      }

      if (!isLocalNominatim && requestDelayMs > 0) {
        await sleep(requestDelayMs);
      }

      if (!nominatimRequest.response) {
        lastErrorMessage = nominatimRequest.error;
        break;
      }

      const response = nominatimRequest.response;

      if (!response.ok) {
        if (
          isLocalNominatim &&
          response.status === 429 &&
          localNominatimHttp429RetryCount < localNominatimHttp429Retries
        ) {
          localNominatimHttp429RetryCount += 1;

          if (localNominatimHttp429RetryDelayMs > 0) {
            await sleep(localNominatimHttp429RetryDelayMs);
          }

          continue;
        }

        lastHttpStatus = response.status;
        break;
      }

      let rows: NominatimRow[];
      try {
        rows = (await response.json()) as NominatimRow[];
      } catch (error) {
        lastErrorMessage = `Invalid JSON response: ${toErrorMessage(error)}`;
        break;
      }

      const resultCount = rows.length;
      const top = rows[0];

      if (!top?.lat || !top?.lon) {
        lastErrorMessage = `Empty result from ${baseUrl}`;
        break;
      }

      const latitude = Number(top.lat);
      const longitude = Number(top.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        lastErrorMessage = `Invalid coordinates from ${baseUrl}`;
        break;
      }

      const hit: GeocodeHit = {
        latitude,
        longitude,
        displayName: top.display_name,
        importance: top.importance ?? 0,
        provider: "OSM_NOMINATIM",
        updatedAt: new Date().toISOString()
      };

      return {
        hit,
        attempt: buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "LOOKUP_SUCCESS", {
          resultCount
        })
      };
    }
  }

  if (lastHttpStatus !== null) {
    return {
      hit: null,
      attempt: buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "HTTP_ERROR", {
        httpStatus: lastHttpStatus,
        errorMessage: lastErrorMessage
      })
    };
  }

  if (lastErrorMessage) {
    return {
      hit: null,
      attempt: buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "REQUEST_FAILED", {
        errorMessage: lastErrorMessage
      })
    };
  }

  return {
    hit: null,
    attempt: buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "EMPTY_RESULT")
  };
}
