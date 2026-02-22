import { GeocoderSqliteCache } from "./geocoder-sqlite-cache.js";
import type { GeocodeHit, GeocodeProvider } from "./geocoder-sqlite-cache.js";
import type { GeocodeLookupAttempt } from "./geocoder-provider-lookup.js";
import {
  buildAttempt,
  lookupGooglePlaces,
  lookupNominatim
} from "./geocoder-provider-lookup.js";
export type { GeocodeProvider } from "./geocoder-sqlite-cache.js";
export type { GeocodeLookupOutcome, GeocodeLookupAttempt } from "./geocoder-provider-lookup.js";

export interface GeocodeResponse {
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  confidence: number | null;
  provider: GeocodeProvider | null;
  warnings?: string[];
  attempts?: GeocodeLookupAttempt[];
}

const GOOGLE_FALLBACK_WARNING =
  "Google Places geocoding failed for one or more lookups; OpenStreetMap fallback coordinates were used where available.";
const GOOGLE_KEY_MISSING_WARNING =
  "Google Places geocoding is unavailable because GOOGLE_MAPS_API_KEY is not configured; OpenStreetMap fallback geocoding is active.";
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

export class OSMGeocoder {
  private readonly cache: GeocoderSqliteCache;

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

  private newLookupsThisRun = 0;

  private readonly backgroundGoogleEnrichmentQueue: Array<{
    query: string;
    aliasKey: string | null;
    cacheKey: string;
  }> = [];

  private readonly queuedBackgroundGoogleEnrichmentKeys = new Set<string>();

  private backgroundGoogleEnrichmentInProgress = false;

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
    this.cache = new GeocoderSqliteCache(options?.cacheDbPath ?? "data/cache/coordinates.sqlite");
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

  private lookupGooglePlaces(
    query: string,
    aliasKey: string | null,
    cacheKey: string
  ) {
    return lookupGooglePlaces(
      {
        googleApiKey: this.googleApiKey,
        requestTimeoutMs: this.requestTimeoutMs,
        retryAttempts: this.retryAttempts,
        retryBaseDelayMs: this.retryBaseDelayMs
      },
      query,
      aliasKey,
      cacheKey
    );
  }

  private lookupNominatim(
    query: string,
    aliasKey: string | null,
    cacheKey: string
  ) {
    return lookupNominatim(
      {
        nominatimBaseUrl: this.nominatimBaseUrl,
        requestTimeoutMs: this.requestTimeoutMs,
        requestDelayMs: this.requestDelayMs,
        retryAttempts: this.retryAttempts,
        retryBaseDelayMs: this.retryBaseDelayMs,
        localNominatimDelayMs: this.localNominatimDelayMs,
        localNominatimHttp429Retries: this.localNominatimHttp429Retries,
        localNominatimHttp429RetryDelayMs: this.localNominatimHttp429RetryDelayMs
      },
      query,
      aliasKey,
      cacheKey
    );
  }

  private async geocodeQuery(query: string, aliasKey?: string): Promise<GeocodeResponse> {
    const queryKey = `query:${this.cache.normalizeKey(query)}`;
    const aliasKeyNormalized = aliasKey
      ? `alias:${this.cache.normalizeKey(aliasKey)}`
      : null;
    const cacheHitFromAlias = aliasKeyNormalized
      ? this.cache.getCached(aliasKeyNormalized)
      : null;
    const cacheHitFromQuery = this.cache.getCached(queryKey);

    const cached = cacheHitFromAlias ?? cacheHitFromQuery;
    const cacheKeyUsed = cacheHitFromAlias
      ? aliasKeyNormalized
      : cacheHitFromQuery
        ? queryKey
        : null;

    if (cached && cacheKeyUsed) {
      if (cached.provider === "OSM_NOMINATIM") {
        this.enqueueBackgroundGoogleEnrichment(query, aliasKeyNormalized, queryKey);
      }

      return this.toGeocodeResponse(
        cached,
        [buildAttempt("CACHE", query, aliasKeyNormalized, cacheKeyUsed, "CACHE_HIT")],
        cached.provider === "OSM_NOMINATIM"
          ? [this.googleApiKey ? GOOGLE_FALLBACK_WARNING : GOOGLE_KEY_MISSING_WARNING]
          : undefined
      );
    }

    const attempts: GeocodeLookupAttempt[] = [];
    const warnings: string[] = [];

    const nominatimLookup = await this.lookupNominatim(query, aliasKeyNormalized, queryKey);
    attempts.push(nominatimLookup.attempt);

    if (nominatimLookup.hit) {
      this.cache.putCached(queryKey, nominatimLookup.hit);
      if (aliasKeyNormalized) {
        this.cache.putCached(aliasKeyNormalized, nominatimLookup.hit);
      }

      this.enqueueBackgroundGoogleEnrichment(query, aliasKeyNormalized, queryKey);

      return this.toGeocodeResponse(nominatimLookup.hit, attempts, warnings);
    }

    const googleLookup =
      this.newLookupsThisRun >= this.maxNewLookupsPerRun
        ? {
            hit: null,
            attempt: buildAttempt(
              "GOOGLE_PLACES",
              query,
              aliasKeyNormalized,
              queryKey,
              "LIMIT_REACHED"
            )
          }
        : await this.lookupGooglePlaces(query, aliasKeyNormalized, queryKey);

    if (googleLookup.attempt.outcome !== "LIMIT_REACHED") {
      this.newLookupsThisRun += 1;
    }

    attempts.push(googleLookup.attempt);

    if (googleLookup.hit) {
      this.cache.putCached(queryKey, googleLookup.hit);
      if (aliasKeyNormalized) {
        this.cache.putCached(aliasKeyNormalized, googleLookup.hit);
      }

      return this.toGeocodeResponse(googleLookup.hit, attempts);
    }

    warnings.push(
      googleLookup.attempt.outcome === "GOOGLE_API_KEY_MISSING"
        ? GOOGLE_KEY_MISSING_WARNING
        : GOOGLE_FALLBACK_WARNING
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

  private enqueueBackgroundGoogleEnrichment(
    query: string,
    aliasKey: string | null,
    cacheKey: string
  ): void {
    if (!this.googleApiKey) {
      return;
    }

    if (this.newLookupsThisRun >= this.maxNewLookupsPerRun) {
      return;
    }

    const queueKey = `${cacheKey}|${aliasKey ?? ""}`;
    if (this.queuedBackgroundGoogleEnrichmentKeys.has(queueKey)) {
      return;
    }

    this.queuedBackgroundGoogleEnrichmentKeys.add(queueKey);
    this.backgroundGoogleEnrichmentQueue.push({
      query,
      aliasKey,
      cacheKey
    });

    if (this.backgroundGoogleEnrichmentInProgress) {
      return;
    }

    this.backgroundGoogleEnrichmentInProgress = true;
    void this.runBackgroundGoogleEnrichmentQueue();
  }

  private async runBackgroundGoogleEnrichmentQueue(): Promise<void> {
    try {
      while (this.backgroundGoogleEnrichmentQueue.length > 0) {
        const nextEnrichment = this.backgroundGoogleEnrichmentQueue.shift();
        if (!nextEnrichment) {
          continue;
        }

        const queueKey = `${nextEnrichment.cacheKey}|${nextEnrichment.aliasKey ?? ""}`;

        try {
          const aliasCachedHit = nextEnrichment.aliasKey
            ? this.cache.getCached(nextEnrichment.aliasKey)
            : null;
          const queryCachedHit = this.cache.getCached(nextEnrichment.cacheKey);
          const existingHit = aliasCachedHit ?? queryCachedHit;

          if (existingHit?.provider === "GOOGLE_PLACES") {
            continue;
          }

          if (this.newLookupsThisRun >= this.maxNewLookupsPerRun) {
            continue;
          }

          const googleLookup = await this.lookupGooglePlaces(
            nextEnrichment.query,
            nextEnrichment.aliasKey,
            nextEnrichment.cacheKey
          );

          if (googleLookup.attempt.outcome !== "LIMIT_REACHED") {
            this.newLookupsThisRun += 1;
          }

          if (!googleLookup.hit) {
            continue;
          }

          this.cache.putCached(nextEnrichment.cacheKey, googleLookup.hit);
          if (nextEnrichment.aliasKey) {
            this.cache.putCached(nextEnrichment.aliasKey, googleLookup.hit);
          }
        } catch {
          continue;
        } finally {
          this.queuedBackgroundGoogleEnrichmentKeys.delete(queueKey);
        }
      }
    } finally {
      this.backgroundGoogleEnrichmentInProgress = false;
    }
  }

  async geocodeForest(
    forestName: string,
    areaName?: string
  ): Promise<GeocodeResponse> {
    const normalizedForestName = forestName.trim();
    const queryForestName = /state forest/i.test(normalizedForestName)
      ? normalizedForestName
      : `${normalizedForestName} State Forest`;
    const normalizedAreaName = areaName?.trim();
    const forestNameWithoutStateForest = normalizedForestName
      .replace(/\bstate\s+forest\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const simplifiedAreaName = normalizedAreaName
      ? normalizedAreaName
        .replace(/\b(state|forests?|around|native|pine|of|the|region)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
      : null;

    const queryCandidates = [
      `${queryForestName}, New South Wales, Australia`,
      `${normalizedForestName}, New South Wales, Australia`,
      forestNameWithoutStateForest
        ? `${forestNameWithoutStateForest}, New South Wales, Australia`
        : null,
      normalizedAreaName
        ? `${queryForestName}, near ${normalizedAreaName}, New South Wales, Australia`
        : null,
      normalizedAreaName
        ? `${queryForestName}, ${normalizedAreaName}, New South Wales, Australia`
        : null,
      normalizedAreaName && forestNameWithoutStateForest
        ? `${forestNameWithoutStateForest}, ${normalizedAreaName}, New South Wales, Australia`
        : null,
      simplifiedAreaName && forestNameWithoutStateForest
        ? `${forestNameWithoutStateForest}, ${simplifiedAreaName}, New South Wales, Australia`
        : null,
      normalizedAreaName
        ? `${normalizedAreaName}, New South Wales, Australia`
        : null,
      simplifiedAreaName
        ? `${simplifiedAreaName}, New South Wales, Australia`
        : null
    ].filter((value): value is string => Boolean(value));

    const uniqueQueryCandidates = [...new Set(queryCandidates)];
    const forestKey = `forest:${normalizedAreaName ?? ""}:${normalizedForestName}`;
    const attempts: GeocodeLookupAttempt[] = [];
    const warnings: string[] = [];

    for (const query of uniqueQueryCandidates) {
      const geocodeResult = await this.geocodeQuery(query, forestKey);
      attempts.push(...(geocodeResult.attempts ?? []));
      warnings.push(...(geocodeResult.warnings ?? []));

      if (geocodeResult.latitude !== null && geocodeResult.longitude !== null) {
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

  async geocodeArea(
    areaName: string,
    areaUrl: string
  ): Promise<GeocodeResponse> {
    const fromUrl = areaUrl
      .split("/")
      .at(-1)
      ?.replace(/-/g, " ")
      .replace(/\b(state|forests?|around|native|pine|of|the)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const queryCandidates = [
      `${areaName}, New South Wales, Australia`,
      fromUrl ? `${fromUrl}, New South Wales, Australia` : null
    ].filter((value): value is string => Boolean(value));

    const areaKey = `area:${areaUrl || areaName}`;
    const attempts: GeocodeLookupAttempt[] = [];
    const warnings: string[] = [];

    for (const query of queryCandidates) {
      const hit = await this.geocodeQuery(query, areaKey);
      attempts.push(...(hit.attempts ?? []));
      warnings.push(...(hit.warnings ?? []));
      if (hit.latitude !== null && hit.longitude !== null) {
        return {
          ...hit,
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
