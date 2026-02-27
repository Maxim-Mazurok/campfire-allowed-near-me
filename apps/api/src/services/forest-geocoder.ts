import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type GeocodeProvider = "GOOGLE_GEOCODING" | "OSM_NOMINATIM";

interface GeocodeHit {
  latitude: number;
  longitude: number;
  displayName: string;
  importance: number;
  provider: GeocodeProvider;
  updatedAt: string;
}

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

interface GoogleGeocodingResult {
  formatted_address?: string;
  types?: string[];
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
}

interface GoogleGeocodingResponse {
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

export interface GeocodeResponse {
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  confidence: number | null;
  provider: GeocodeProvider | null;
  warnings?: string[];
  attempts?: GeocodeLookupAttempt[];
}

const NOMINATIM_FALLBACK_WARNING =
  "Google Geocoding failed for one or more lookups; OpenStreetMap Nominatim fallback coordinates were used where available.";
const GOOGLE_KEY_MISSING_WARNING =
  "Google Geocoding is unavailable because GOOGLE_MAPS_API_KEY is not configured; OpenStreetMap Nominatim fallback geocoding is active.";
const DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_LOCAL_NOMINATIM_PORT = "8080";
const DEFAULT_LOCAL_NOMINATIM_DELAY_MS = 200;
const DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRIES = 4;
const DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRY_DELAY_MS = 1_500;

const resolvePreferredNominatimBaseUrl = (): string => {
  const configuredBaseUrl = process.env.NOMINATIM_BASE_URL?.trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  const nominatimPort = process.env.NOMINATIM_PORT?.trim() || DEFAULT_LOCAL_NOMINATIM_PORT;
  return `http://localhost:${nominatimPort}`;
};

/**
 * Round a coordinate to 6 decimal places (~11 cm precision).
 * Different Nominatim instances (local Docker vs public) return coordinates
 * with varying precision. Public Nominatim returns 7dp but local Docker
 * returns full IEEE 754 doubles, causing last-digit rounding disagreements
 * at the 7th decimal place. Using 6dp eliminates these while retaining
 * more than enough accuracy for forest-level geocoding.
 */
const roundCoordinate = (value: number): number =>
  Math.round(value * 1e6) / 1e6;

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

/**
 * Common words that appear in forest/area names and geocode results but
 * carry no identifying value for matching. These are excluded when
 * validating whether a geocode result matches the queried forest.
 */
const GEOCODE_STOP_WORDS = new Set([
  "state", "forest", "forests", "national", "park", "reserve", "new", "south",
  "wales", "australia", "nsw", "near", "around", "the", "of", "and", "pine",
  "native", "region", "road", "council", "shire", "city", "area"
]);

/**
 * Extract significant words from forest names, excluding common stop words,
 * very short tokens, and parenthetical qualifiers (e.g. "(pine plantations)").
 * Returns a set of lowercase words that carry identifying meaning
 * (e.g. "croft", "knoll" from "Croft Knoll").
 */
const extractSignificantWords = (
  forestNameWithoutStateForest: string,
  directoryNameWithoutStateForest: string | null
): Set<string> => {
  // Strip parenthetical qualifiers like "(pine plantations)" — these are
  // descriptive metadata that geocoders don't include in their results.
  const stripParenthetical = (text: string): string =>
    text.replace(/\s*\([^)]*\)/g, "").trim();

  const cleanedForestName = stripParenthetical(forestNameWithoutStateForest);
  const cleanedDirectoryName = directoryNameWithoutStateForest
    ? stripParenthetical(directoryNameWithoutStateForest)
    : null;

  const combined = cleanedDirectoryName
    ? `${cleanedForestName} ${cleanedDirectoryName}`
    : cleanedForestName;

  return new Set(
    combined
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !GEOCODE_STOP_WORDS.has(word))
  );
};

/**
 * Check whether a geocode result's displayName shares ALL significant
 * words with the queried forest name. Used to reject results where the
 * provider returned a completely different feature (e.g. Google returning
 * "Koondrook State Forest" for "Croft Knoll State Forest", or "Croft NSW"
 * for "Croft Knoll State Forest").
 */
const isPlausibleForestMatch = (
  displayName: string,
  significantWords: Set<string>
): boolean => {
  if (significantWords.size === 0) {
    return true;
  }

  const displayNameLower = displayName.toLowerCase();
  for (const word of significantWords) {
    if (!displayNameLower.includes(word)) {
      return false;
    }
  }

  return true;
};

/**
 * Display-name substrings that always indicate a false-positive geocode result.
 * These are organisation offices or landmarks that geocoders sometimes return
 * for forest-related queries but are never actual forests.
 */
const GEOCODE_BLACKLISTED_NAMES = [
  "forestry corporation",
];

/**
 * Returns true if the displayName contains any blacklisted substring,
 * meaning the result should be rejected regardless of query type.
 */
const isBlacklistedGeocodeResult = (displayName: string): boolean => {
  const lower = displayName.toLowerCase();
  return GEOCODE_BLACKLISTED_NAMES.some((blacklisted) => lower.includes(blacklisted));
};

/**
 * Google Geocoding result types that indicate a street-level or premise-level
 * feature.  These are never correct for forest lookups — a street
 * address like "Cypress Pine Ln" should not be used as a forest location.
 */
const REJECTED_GOOGLE_RESULT_TYPES = new Set([
  "street_address",
  "route",
  "intersection",
  "premise",
  "subpremise",
  "floor",
  "room",
  "post_box",
  "parking",
  "bus_station",
  "train_station",
  "transit_station",
  "airport",
]);

/**
 * Returns true when the Google Geocoding result types contain at least one
 * type that is too granular to be a forest or area-level feature.
 */
const isStreetLevelGoogleResult = (types: string[]): boolean =>
  types.some((type) => REJECTED_GOOGLE_RESULT_TYPES.has(type));

/**
 * Derive a confidence score from Google Geocoding result types.
 * Google doesn’t provide a confidence field, so we map result types to
 * approximate confidence tiers.  Broader features (locality, region) get
 * lower confidence than exact-match features (park, natural_feature, point_of_interest).
 */
const deriveGoogleConfidence = (types: string[]): number => {
  // Exact-match types — the geocoder resolved to a named place/feature.
  const exactMatchTypes = new Set([
    "natural_feature",
    "park",
    "point_of_interest",
    "establishment",
    "campground",
  ]);
  if (types.some((type) => exactMatchTypes.has(type))) return 1;

  // Administrative/area types — the geocoder resolved to a broad region.
  const broadAreaTypes = new Set([
    "locality",
    "sublocality",
    "administrative_area_level_1",
    "administrative_area_level_2",
    "administrative_area_level_3",
    "administrative_area_level_4",
    "postal_code",
    "colloquial_area",
    "neighborhood",
  ]);
  if (types.some((type) => broadAreaTypes.has(type))) return 0.5;

  // Unknown / unrecognised types — treat with moderate distrust.
  return 0.3;
};

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

export class ForestGeocoder {
  private readonly cacheDbPath: string;

  private readonly requestDelayMs: number;

  private readonly requestTimeoutMs: number;

  private readonly retryAttempts: number;

  private readonly retryBaseDelayMs: number;

  private readonly localNominatimDelayMs: number;

  private readonly localNominatimHttp429Retries: number;

  private readonly localNominatimHttp429RetryDelayMs: number;

  private readonly maxNewLookupsPerRun: number;

  private readonly googleApiKey: string | null;

  private readonly nominatimBaseUrl: string;

  private db: DatabaseSync;

  private newLookupsThisRun = 0;

  resetLookupBudgetForRun(): void {
    this.newLookupsThisRun = 0;
  }

  constructor(options?: {
    cacheDbPath?: string;
    requestDelayMs?: number;
    requestTimeoutMs?: number;
    retryAttempts?: number;
    retryBaseDelayMs?: number;
    localNominatimDelayMs?: number;
    localNominatimHttp429Retries?: number;
    localNominatimHttp429RetryDelayMs?: number;
    maxNewLookupsPerRun?: number;
    googleApiKey?: string | null;
    nominatimBaseUrl?: string;
  }) {
    this.cacheDbPath = options?.cacheDbPath ?? "data/cache/coordinates.sqlite";
    this.requestDelayMs = options?.requestDelayMs ?? 1200;
    this.requestTimeoutMs = options?.requestTimeoutMs ?? 15_000;
    this.retryAttempts = options?.retryAttempts ?? 3;
    this.retryBaseDelayMs = options?.retryBaseDelayMs ?? 750;
    this.localNominatimDelayMs =
      options?.localNominatimDelayMs ??
      Number(process.env.NOMINATIM_LOCAL_DELAY_MS ?? `${DEFAULT_LOCAL_NOMINATIM_DELAY_MS}`);
    this.localNominatimHttp429Retries =
      options?.localNominatimHttp429Retries ??
      Number(
        process.env.NOMINATIM_LOCAL_429_RETRIES ??
          `${DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRIES}`
      );
    this.localNominatimHttp429RetryDelayMs =
      options?.localNominatimHttp429RetryDelayMs ??
      Number(
        process.env.NOMINATIM_LOCAL_429_RETRY_DELAY_MS ??
          `${DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRY_DELAY_MS}`
      );
    this.maxNewLookupsPerRun = options?.maxNewLookupsPerRun ?? 25;
    this.googleApiKey = options?.googleApiKey?.trim() || null;
    this.nominatimBaseUrl =
      options?.nominatimBaseUrl?.trim() ||
      resolvePreferredNominatimBaseUrl();

    mkdirSync(dirname(this.cacheDbPath), { recursive: true });
    this.db = this.openDatabaseWithRecovery();
  }

  private openDatabaseWithRecovery(): DatabaseSync {
    try {
      return this.openDatabase();
    } catch (error) {
      if (!this.isReadonlyDatabaseError(error)) {
        throw error;
      }

      const basePath = this.cacheDbPath;
      const siblingPaths = [basePath, `${basePath}-wal`, `${basePath}-shm`];

      for (const siblingPath of siblingPaths) {
        if (!existsSync(siblingPath)) {
          continue;
        }

        try {
          chmodSync(siblingPath, 0o666);
        } catch {
          // Continue and attempt removal regardless.
        }

        rmSync(siblingPath, { force: true });
      }

      return this.openDatabase();
    }
  }

  private openDatabase(): DatabaseSync {
    const db = new DatabaseSync(this.cacheDbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        display_name TEXT NOT NULL,
        importance REAL NOT NULL,
        provider TEXT NOT NULL DEFAULT 'OSM_NOMINATIM',
        updated_at TEXT NOT NULL
      );
    `);

    // Legacy caches created before provider support need a one-time migration.
    try {
      db.exec(
        "ALTER TABLE geocode_cache ADD COLUMN provider TEXT NOT NULL DEFAULT 'OSM_NOMINATIM';"
      );
    } catch {
      // Ignore duplicate-column failures.
    }

    return db;
  }

  private isReadonlyDatabaseError(error: unknown): boolean {
    return error instanceof Error && /readonly database/i.test(error.message);
  }

  private recreateDatabase(): void {
    try {
      this.db.close();
    } catch {
      // Ignore close failures and continue with forced file reset.
    }

    const basePath = this.cacheDbPath;
    const siblingPaths = [basePath, `${basePath}-wal`, `${basePath}-shm`];

    for (const siblingPath of siblingPaths) {
      if (!existsSync(siblingPath)) {
        continue;
      }

      chmodSync(siblingPath, 0o666);
      rmSync(siblingPath, { force: true });
    }

    this.db = this.openDatabaseWithRecovery();
  }

  private runWriteStatement(runStatement: () => void): void {
    try {
      runStatement();
    } catch (error) {
      if (!this.isReadonlyDatabaseError(error)) {
        throw error;
      }

      this.recreateDatabase();
      runStatement();
    }
  }

  private toGeocodeResponse(
    hit: GeocodeHit,
    attempts: GeocodeLookupAttempt[],
    warnings?: string[]
  ): GeocodeResponse {
    return {
      latitude: hit.latitude,
      longitude: hit.longitude,
      displayName: hit.displayName,
      confidence: hit.importance,
      provider: hit.provider,
      warnings,
      attempts
    };
  }

  private buildAttempt(
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

  private normalizeKey(raw: string): string {
    return raw.toLowerCase().trim().replace(/\s+/g, " ");
  }

  private getCached(key: string): GeocodeHit | null {
    const row = this.db
      .prepare(
        "SELECT latitude, longitude, display_name, importance, provider, updated_at FROM geocode_cache WHERE cache_key = ?"
      )
      .get(key) as
      | {
          latitude: number;
          longitude: number;
          display_name: string;
          importance: number;
          provider?: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    // Normalise legacy "GOOGLE_PLACES" cache rows written before the switch to
    // the Geocoding API.  Safe to remove once all caches have been regenerated.
    const provider =
      row.provider === "GOOGLE_GEOCODING" || row.provider === "GOOGLE_PLACES"
        ? "GOOGLE_GEOCODING"
        : "OSM_NOMINATIM";

    return {
      latitude: row.latitude,
      longitude: row.longitude,
      displayName: row.display_name,
      importance: row.importance,
      provider,
      updatedAt: row.updated_at
    };
  }

  private putCached(key: string, hit: GeocodeHit): void {
    this.runWriteStatement(() => {
      this.db
        .prepare(
          `
            INSERT INTO geocode_cache (
              cache_key, latitude, longitude, display_name, importance, provider, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
              latitude = excluded.latitude,
              longitude = excluded.longitude,
              display_name = excluded.display_name,
              importance = excluded.importance,
              provider = excluded.provider,
              updated_at = excluded.updated_at
          `
        )
        .run(
          key,
          hit.latitude,
          hit.longitude,
          hit.displayName,
          hit.importance,
          hit.provider,
          hit.updatedAt
        );
    });
  }

  private deleteCached(key: string): void {
    this.runWriteStatement(() => {
      this.db
        .prepare("DELETE FROM geocode_cache WHERE cache_key = ?")
        .run(key);
    });
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.requestTimeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: abortController.signal
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async runWithRetries(
    executeAttempt: () => Promise<Response>
  ): Promise<{ response: Response | null; error: string | null }> {
    let lastError: string | null = null;

    for (let attemptNumber = 1; attemptNumber <= this.retryAttempts; attemptNumber += 1) {
      try {
        const response = await executeAttempt();

        if (shouldRetryHttpStatus(response.status) && attemptNumber < this.retryAttempts) {
          const backoffDelayMs = this.retryBaseDelayMs * 2 ** (attemptNumber - 1);
          await sleep(backoffDelayMs);
          continue;
        }

        return {
          response,
          error: null
        };
      } catch (error) {
        lastError = toErrorMessage(error);
        if (attemptNumber < this.retryAttempts) {
          const backoffDelayMs = this.retryBaseDelayMs * 2 ** (attemptNumber - 1);
          await sleep(backoffDelayMs);
          continue;
        }
      }
    }

    return {
      response: null,
      error: lastError
    };
  }

  private async lookupGoogleGeocoding(
    query: string,
    aliasKey: string | null,
    cacheKey: string
  ): Promise<{ hit: GeocodeHit | null; attempt: GeocodeLookupAttempt }> {
    const googleApiKey = this.googleApiKey;
    if (!googleApiKey) {
      return {
        hit: null,
        attempt: this.buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "GOOGLE_API_KEY_MISSING"
        )
      };
    }

    const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    geocodeUrl.searchParams.set("address", query);
    geocodeUrl.searchParams.set("region", "au");
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("key", googleApiKey);

    const googleRequest = await this.runWithRetries(() =>
      this.fetchWithTimeout(geocodeUrl.toString(), {
        headers: {
          Accept: "application/json"
        }
      })
    );

    if (!googleRequest.response) {
      return {
        hit: null,
        attempt: this.buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          {
            errorMessage: googleRequest.error
          }
        )
      };
    }

    const response = googleRequest.response;

    if (!response.ok) {
      return {
        hit: null,
        attempt: this.buildAttempt("GOOGLE_GEOCODING", query, aliasKey, cacheKey, "HTTP_ERROR", {
          httpStatus: response.status
        })
      };
    }

    let geocodingResponse: GoogleGeocodingResponse;
    try {
      geocodingResponse = (await response.json()) as GoogleGeocodingResponse;
    } catch (error) {
      return {
        hit: null,
        attempt: this.buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          {
            errorMessage: `Invalid JSON response: ${toErrorMessage(error)}`
          }
        )
      };
    }

    const results = geocodingResponse.results ?? [];
    const first = results[0];

    if (!first?.geometry?.location) {
      return {
        hit: null,
        attempt: this.buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "EMPTY_RESULT",
          {
            resultCount: results.length
          }
        )
      };
    }

    const latitude = roundCoordinate(Number(first.geometry.location.lat));
    const longitude = roundCoordinate(Number(first.geometry.location.lng));

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        hit: null,
        attempt: this.buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "INVALID_COORDINATES",
          {
            resultCount: results.length
          }
        )
      };
    }

    const displayName =
      first.formatted_address?.trim() ||
      query;

    const resultTypes = first.types ?? [];

    // Reject street-level results — a street address is never a valid forest
    // or area location (e.g. "Cypress Pine Ln" for "Cypress pine forests").
    if (isStreetLevelGoogleResult(resultTypes)) {
      return {
        hit: null,
        attempt: this.buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "EMPTY_RESULT",
          {
            resultCount: results.length,
            errorMessage: `Rejected street-level result type [${resultTypes.join(", ")}]: "${displayName}"`
          }
        )
      };
    }

    const hit: GeocodeHit = {
      latitude,
      longitude,
      displayName,
      importance: deriveGoogleConfidence(resultTypes),
      provider: "GOOGLE_GEOCODING",
      updatedAt: new Date().toISOString()
    };

    return {
      hit,
      attempt: this.buildAttempt("GOOGLE_GEOCODING", query, aliasKey, cacheKey, "LOOKUP_SUCCESS", {
        resultCount: results.length
      })
    };
  }

  private async lookupNominatim(
    query: string,
    aliasKey: string | null,
    cacheKey: string
  ): Promise<{ hit: GeocodeHit | null; attempt: GeocodeLookupAttempt }> {
    const nominatimBaseUrls = [this.nominatimBaseUrl, DEFAULT_NOMINATIM_BASE_URL];
    const uniqueNominatimBaseUrls = [...new Set(nominatimBaseUrls.map((baseUrl) => baseUrl.trim()))]
      .filter(Boolean);

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

      const nominatimRequest = await this.runWithRetries(() =>
        this.fetchWithTimeout(url.toString(), {
          headers: {
            "User-Agent":
              "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire ban lookup)",
            Accept: "application/json"
          }
        })
      );

      if (isLocalNominatim && this.localNominatimDelayMs > 0) {
        await sleep(this.localNominatimDelayMs);
      }

      if (!isLocalNominatim && this.requestDelayMs > 0) {
        await sleep(this.requestDelayMs);
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
          localNominatimHttp429RetryCount < this.localNominatimHttp429Retries
        ) {
          localNominatimHttp429RetryCount += 1;

          if (this.localNominatimHttp429RetryDelayMs > 0) {
            await sleep(this.localNominatimHttp429RetryDelayMs);
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

      const latitude = roundCoordinate(Number(top.lat));
      const longitude = roundCoordinate(Number(top.lon));
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
        attempt: this.buildAttempt(
          "OSM_NOMINATIM",
          query,
          aliasKey,
          cacheKey,
          "LOOKUP_SUCCESS",
          {
            resultCount
          }
        )
      };
    }
    }

    if (lastHttpStatus !== null) {
      return {
        hit: null,
        attempt: this.buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "HTTP_ERROR", {
          httpStatus: lastHttpStatus,
          errorMessage: lastErrorMessage
        })
      };
    }

    if (lastErrorMessage) {
      return {
        hit: null,
        attempt: this.buildAttempt(
          "OSM_NOMINATIM",
          query,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          {
            errorMessage: lastErrorMessage
          }
        )
      };
    }

    return {
      hit: null,
      attempt: this.buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "EMPTY_RESULT")
    };
  }

  private async geocodeQuery(query: string, aliasKey?: string): Promise<GeocodeResponse> {
    const queryKey = `query:${this.normalizeKey(query)}`;
    const aliasKeyNormalized = aliasKey
      ? `alias:${this.normalizeKey(aliasKey)}`
      : null;
    const cacheHitFromAlias = aliasKeyNormalized
      ? this.getCached(aliasKeyNormalized)
      : null;
    const cacheHitFromQuery = this.getCached(queryKey);

    const cached = cacheHitFromAlias ?? cacheHitFromQuery;
    const cacheKeyUsed = cacheHitFromAlias
      ? aliasKeyNormalized
      : cacheHitFromQuery
        ? queryKey
        : null;

    if (cached && cacheKeyUsed) {
      // Populate the alias key in cache when a hit came from the query key only.
      // This prevents a cascade of failed lookups on subsequent calls where the
      // alias key (e.g. area:<url>) was never persisted.
      if (aliasKeyNormalized && !cacheHitFromAlias) {
        this.putCached(aliasKeyNormalized, cached);
      }

      return this.toGeocodeResponse(
        cached,
        [this.buildAttempt("CACHE", query, aliasKeyNormalized, cacheKeyUsed, "CACHE_HIT")]
      );
    }

    const attempts: GeocodeLookupAttempt[] = [];
    const warnings: string[] = [];

    // Google Geocoding API is the primary source of truth.
    const googleLookup =
      this.newLookupsThisRun >= this.maxNewLookupsPerRun
        ? {
            hit: null,
            attempt: this.buildAttempt(
              "GOOGLE_GEOCODING",
              query,
              aliasKeyNormalized,
              queryKey,
              "LIMIT_REACHED"
            )
          }
        : await this.lookupGoogleGeocoding(query, aliasKeyNormalized, queryKey);

    if (googleLookup.attempt.outcome !== "LIMIT_REACHED") {
      this.newLookupsThisRun += 1;
    }

    attempts.push(googleLookup.attempt);

    if (googleLookup.hit) {
      if (isBlacklistedGeocodeResult(googleLookup.hit.displayName)) {
        warnings.push(
          `Rejected blacklisted Google result "${googleLookup.hit.displayName}" for query "${query}"`
        );
      } else {
        this.putCached(queryKey, googleLookup.hit);
        if (aliasKeyNormalized) {
          this.putCached(aliasKeyNormalized, googleLookup.hit);
        }

        return this.toGeocodeResponse(googleLookup.hit, attempts);
      }
    }

    // Fall back to Nominatim when Google fails.
    const nominatimLookup = await this.lookupNominatim(query, aliasKeyNormalized, queryKey);
    attempts.push(nominatimLookup.attempt);

    if (nominatimLookup.hit) {
      if (isBlacklistedGeocodeResult(nominatimLookup.hit.displayName)) {
        warnings.push(
          `Rejected blacklisted Nominatim result "${nominatimLookup.hit.displayName}" for query "${query}"`
        );
      } else {
        this.putCached(queryKey, nominatimLookup.hit);
        if (aliasKeyNormalized) {
          this.putCached(aliasKeyNormalized, nominatimLookup.hit);
        }

        warnings.push(
          this.googleApiKey ? NOMINATIM_FALLBACK_WARNING : GOOGLE_KEY_MISSING_WARNING
        );

        return this.toGeocodeResponse(nominatimLookup.hit, attempts, warnings);
      }
    }

    warnings.push(
      this.googleApiKey ? NOMINATIM_FALLBACK_WARNING : GOOGLE_KEY_MISSING_WARNING
    );

    return {
      latitude: null,
      longitude: null,
      displayName: null,
      confidence: null,
      provider: null,
      warnings,
      attempts
    };
  }

  // NOTE: Area names from Forestry Corporation (e.g. "Cypress pine forests",
  // "State forests around Bombala") are NOT used for geocoding. Visual
  // inspection revealed that areas are organizational categories, not reliable
  // geographic regions — some span from Melbourne to Brisbane. They introduce
  // noise (street-address false positives, implausible centroids) and do not
  // improve geocoding accuracy for individual forests.
  //
  // The `areaName` parameter is accepted for backward compatibility with
  // callers but is intentionally ignored in query construction.
  async geocodeForest(
    forestName: string,
    _areaName?: string,
    options?: { directoryForestName?: string }
  ): Promise<GeocodeResponse> {
    const normalizedForestName = forestName.trim();
    const queryForestName = /state forest/i.test(normalizedForestName)
      ? normalizedForestName
      : `${normalizedForestName} State Forest`;
    const forestNameWithoutStateForest = normalizedForestName
      .replace(/\bstate\s+forest\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    // When the directory has a different spelling (e.g. "Crofts Knoll" vs
    // fire ban "Croft Knoll"), generate additional query candidates from
    // the directory name so the geocoder can match the correct feature.
    const directoryName = options?.directoryForestName?.trim() ?? null;
    const hasDistinctDirectoryName =
      directoryName !== null &&
      directoryName.toLowerCase() !== normalizedForestName.toLowerCase();
    const directoryQueryName = hasDistinctDirectoryName
      ? (/state forest/i.test(directoryName!) ? directoryName! : `${directoryName!} State Forest`)
      : null;
    const directoryNameWithoutStateForest = hasDistinctDirectoryName
      ? directoryName!
        .replace(/\bstate\s+forest\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
      : null;

    // Forest-specific candidates: contain the forest name or directory name.
    // Area names are intentionally excluded — see note above.
    const candidates = [
      `${queryForestName}, New South Wales, Australia`,
      `${normalizedForestName}, New South Wales, Australia`,
      forestNameWithoutStateForest
        ? `${forestNameWithoutStateForest}, New South Wales, Australia`
        : null,
      directoryQueryName
        ? `${directoryQueryName}, New South Wales, Australia`
        : null,
      directoryNameWithoutStateForest
        ? `${directoryNameWithoutStateForest}, New South Wales, Australia`
        : null
    ].filter((value): value is string => Boolean(value));

    const uniqueCandidates = [...new Set(candidates)];

    // Significant words from the forest name (and directory name if available)
    // used to validate that a geocode result actually matches the queried forest.
    // Common generic words are excluded to avoid false positives.
    const forestNameSignificantWords = extractSignificantWords(
      forestNameWithoutStateForest,
      directoryNameWithoutStateForest
    );

    const forestKey = `forest::${normalizedForestName}`;
    const aliasKeyNormalized = `alias:${this.normalizeKey(forestKey)}`;
    const attempts: GeocodeLookupAttempt[] = [];
    const warnings: string[] = [];

    // Fast path: check alias cache for this forest.
    // Validate the cached alias entry before returning it. If the cached
    // display name doesn't mention the forest name (or the directory name
    // when available), the entry is likely a stale area-centroid result from
    // a previous run where the fire ban name couldn't be resolved directly.
    // Delete the stale entry and retry with fresh lookups.
    const aliasHit = this.getCached(aliasKeyNormalized);
    if (aliasHit) {
      const cachedDisplayLower = aliasHit.displayName.toLowerCase();
      const matchesForestName = cachedDisplayLower.includes(
        forestNameWithoutStateForest.toLowerCase()
      );
      const matchesDirectoryName = directoryNameWithoutStateForest
        ? cachedDisplayLower.includes(directoryNameWithoutStateForest.toLowerCase())
        : false;
      const isStaleAreaFallback = !matchesForestName && !matchesDirectoryName;

      if (!isStaleAreaFallback) {
        return this.toGeocodeResponse(
          aliasHit,
          [this.buildAttempt("CACHE", forestKey, aliasKeyNormalized, aliasKeyNormalized, "CACHE_HIT")]
        );
      }

      // Remove the stale alias so future runs don't keep returning it.
      this.deleteCached(aliasKeyNormalized);
    }

    for (const query of uniqueCandidates) {
      const geocodeResult = await this.geocodeQuery(query);
      attempts.push(...(geocodeResult.attempts ?? []));
      warnings.push(...(geocodeResult.warnings ?? []));

      if (geocodeResult.latitude !== null && geocodeResult.longitude !== null) {
        const resultDisplayName = geocodeResult.displayName ?? query;

        // Validate that the result actually matches the queried forest.
        // Reject results where the provider returned a completely different
        // feature (e.g. Google returning "Koondrook State Forest" for
        // "Croft Knoll State Forest").
        if (!isPlausibleForestMatch(resultDisplayName, forestNameSignificantWords)) {
          warnings.push(
            `Rejected implausible result "${resultDisplayName}" for forest "${normalizedForestName}"`
          );

          // When the primary provider (Google) returns an implausible result,
          // try Nominatim directly for this candidate before moving on.
          // Google may confidently return the wrong forest, but Nominatim
          // might have the correct mapping (e.g. "Crofts Knoll" vs "Croft Knoll").
          const queryKey = `query:${this.normalizeKey(query)}`;
          const nominatimRetry = await this.lookupNominatim(query, null, queryKey);
          attempts.push(nominatimRetry.attempt);

          if (nominatimRetry.hit) {
            const nominatimDisplayName = nominatimRetry.hit.displayName;
            if (isPlausibleForestMatch(nominatimDisplayName, forestNameSignificantWords)) {
              // Nominatim returned a plausible result — update cache and use it.
              this.putCached(queryKey, nominatimRetry.hit);
              this.putCached(aliasKeyNormalized, nominatimRetry.hit);
              return this.toGeocodeResponse(nominatimRetry.hit, attempts, [...new Set(warnings)]);
            }

            warnings.push(
              `Rejected implausible Nominatim result "${nominatimDisplayName}" for forest "${normalizedForestName}"`
            );
          }

          continue;
        }

        // When Google returns a result whose display name doesn't mention
        // "state forest", also try Nominatim. OSM often has the actual state
        // forest boundary as a landuse=forest feature, yielding a more precise
        // centroid than Google's nearest-town or nearby-feature approximation.
        // Google's derived confidence score is unreliable for distinguishing
        // "the actual forest" from "a nearby locality with the same name".
        const isGoogleResult = geocodeResult.provider === "GOOGLE_GEOCODING";
        const displayNameMentionsStateForest =
          resultDisplayName.toLowerCase().includes("state forest");

        if (isGoogleResult && !displayNameMentionsStateForest) {
          const queryKey = `query:${this.normalizeKey(query)}`;
          const nominatimSupplement = await this.lookupNominatim(query, null, queryKey);
          attempts.push(nominatimSupplement.attempt);

          if (nominatimSupplement.hit) {
            const nominatimDisplayName = nominatimSupplement.hit.displayName;
            const nominatimIsPlausible = isPlausibleForestMatch(
              nominatimDisplayName,
              forestNameSignificantWords
            );
            const nominatimMentionsStateForest =
              nominatimDisplayName.toLowerCase().includes("state forest");

            if (nominatimIsPlausible && nominatimMentionsStateForest) {
              // Nominatim found the actual state forest feature — prefer it
              // over Google's locality-level approximation.
              this.putCached(queryKey, nominatimSupplement.hit);
              this.putCached(aliasKeyNormalized, nominatimSupplement.hit);
              return this.toGeocodeResponse(
                nominatimSupplement.hit,
                attempts,
                [...new Set(warnings)]
              );
            }
          }
        }

        const hit: GeocodeHit = {
          latitude: geocodeResult.latitude,
          longitude: geocodeResult.longitude,
          displayName: resultDisplayName,
          importance: geocodeResult.confidence ?? 0,
          provider: geocodeResult.provider ?? "OSM_NOMINATIM",
          updatedAt: new Date().toISOString()
        };
        this.putCached(aliasKeyNormalized, hit);

        return {
          ...geocodeResult,
          attempts,
          warnings: [...new Set(warnings)]
        };
      }
    }

    return {
      latitude: null,
      longitude: null,
      displayName: null,
      confidence: null,
      provider: null,
      attempts,
      warnings: [...new Set(warnings)]
    };
  }
}
