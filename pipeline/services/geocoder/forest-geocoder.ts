import type {
  GeocodeHit,
  GeocodeLookupAttempt,
  GeocodeResponse,
} from "./geocode-types.js";
import {
  NOMINATIM_FALLBACK_WARNING,
  GOOGLE_KEY_MISSING_WARNING,
  DEFAULT_LOCAL_NOMINATIM_DELAY_MS,
  DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRIES,
  DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRY_DELAY_MS,
} from "./geocode-types.js";
import {
  buildAttempt,
  extractSignificantWords,
  isBlacklistedGeocodeResult,
  isPlausibleForestMatch,
  normalizeKey,
  resolvePreferredNominatimBaseUrl,
  toGeocodeResponse,
} from "./geocode-helpers.js";
import { GeocodeCache } from "./geocode-cache.js";
import { FcnswArcgisProvider } from "./fcnsw-arcgis-provider.js";
import { GoogleGeocodingProvider } from "./google-geocoding-provider.js";
import { NominatimProvider } from "./nominatim-provider.js";

export class ForestGeocoder {
  private readonly cache: GeocodeCache;
  private readonly fcnswProvider: FcnswArcgisProvider;
  private readonly googleProvider: GoogleGeocodingProvider;
  private readonly nominatimProvider: NominatimProvider;
  private readonly maxNewLookupsPerRun: number;
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
    const requestTimeoutMs = options?.requestTimeoutMs ?? 15_000;
    const retryAttempts = options?.retryAttempts ?? 3;
    const retryBaseDelayMs = options?.retryBaseDelayMs ?? 750;
    const requestDelayMs = options?.requestDelayMs ?? 1200;

    this.maxNewLookupsPerRun = options?.maxNewLookupsPerRun ?? 25;

    this.cache = new GeocodeCache(
      options?.cacheDbPath ?? "data/cache/coordinates.sqlite"
    );

    this.fcnswProvider = new FcnswArcgisProvider({
      requestTimeoutMs,
      retryAttempts,
      retryBaseDelayMs,
    });

    this.googleProvider = new GoogleGeocodingProvider({
      googleApiKey: options?.googleApiKey?.trim() || null,
      requestTimeoutMs,
      retryAttempts,
      retryBaseDelayMs,
      requestDelayMs,
    });

    this.nominatimProvider = new NominatimProvider({
      nominatimBaseUrl:
        options?.nominatimBaseUrl?.trim() ||
        resolvePreferredNominatimBaseUrl(),
      requestTimeoutMs,
      retryAttempts,
      retryBaseDelayMs,
      requestDelayMs,
      localNominatimDelayMs:
        options?.localNominatimDelayMs ??
        Number(process.env.NOMINATIM_LOCAL_DELAY_MS ?? `${DEFAULT_LOCAL_NOMINATIM_DELAY_MS}`),
      localNominatimHttp429Retries:
        options?.localNominatimHttp429Retries ??
        Number(
          process.env.NOMINATIM_LOCAL_429_RETRIES ??
            `${DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRIES}`
        ),
      localNominatimHttp429RetryDelayMs:
        options?.localNominatimHttp429RetryDelayMs ??
        Number(
          process.env.NOMINATIM_LOCAL_429_RETRY_DELAY_MS ??
            `${DEFAULT_LOCAL_NOMINATIM_HTTP_429_RETRY_DELAY_MS}`
        ),
    });
  }

  private geocodeQuery = async (query: string, aliasKey?: string): Promise<GeocodeResponse> => {
    const queryKey = `query:${normalizeKey(query)}`;
    const aliasKeyNormalized = aliasKey
      ? `alias:${normalizeKey(aliasKey)}`
      : null;
    const cacheHitFromAlias = aliasKeyNormalized
      ? this.cache.get(aliasKeyNormalized)
      : null;
    const cacheHitFromQuery = this.cache.get(queryKey);

    const cached = cacheHitFromAlias ?? cacheHitFromQuery;
    const cacheKeyUsed = cacheHitFromAlias
      ? aliasKeyNormalized
      : cacheHitFromQuery
        ? queryKey
        : null;

    if (cached && cacheKeyUsed) {
      if (aliasKeyNormalized && !cacheHitFromAlias) {
        this.cache.put(aliasKeyNormalized, cached);
      }

      return toGeocodeResponse(
        cached,
        [buildAttempt("CACHE", query, aliasKeyNormalized, cacheKeyUsed, "CACHE_HIT")]
      );
    }

    const attempts: GeocodeLookupAttempt[] = [];
    const warnings: string[] = [];

    // Google Geocoding API is the primary fallback source.
    const googleLookup =
      this.newLookupsThisRun >= this.maxNewLookupsPerRun
        ? {
            hit: null,
            attempt: buildAttempt(
              "GOOGLE_GEOCODING",
              query,
              aliasKeyNormalized,
              queryKey,
              "LIMIT_REACHED"
            ),
          }
        : await this.googleProvider.lookup(query, aliasKeyNormalized, queryKey);

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
        this.cache.put(queryKey, googleLookup.hit);
        if (aliasKeyNormalized) {
          this.cache.put(aliasKeyNormalized, googleLookup.hit);
        }

        return toGeocodeResponse(googleLookup.hit, attempts);
      }
    }

    // Fall back to Nominatim when Google fails.
    const nominatimLookup = await this.nominatimProvider.lookup(query, aliasKeyNormalized, queryKey);
    attempts.push(nominatimLookup.attempt);

    if (nominatimLookup.hit) {
      if (isBlacklistedGeocodeResult(nominatimLookup.hit.displayName)) {
        warnings.push(
          `Rejected blacklisted Nominatim result "${nominatimLookup.hit.displayName}" for query "${query}"`
        );
      } else {
        this.cache.put(queryKey, nominatimLookup.hit);
        if (aliasKeyNormalized) {
          this.cache.put(aliasKeyNormalized, nominatimLookup.hit);
        }

        warnings.push(
          this.googleProvider.hasApiKey ? NOMINATIM_FALLBACK_WARNING : GOOGLE_KEY_MISSING_WARNING
        );

        return toGeocodeResponse(nominatimLookup.hit, attempts, warnings);
      }
    }

    warnings.push(
      this.googleProvider.hasApiKey ? NOMINATIM_FALLBACK_WARNING : GOOGLE_KEY_MISSING_WARNING
    );

    return {
      latitude: null,
      longitude: null,
      displayName: null,
      confidence: null,
      provider: null,
      warnings,
      attempts,
    };
  };

  // NOTE: Area names from Forestry Corporation are NOT used for geocoding.
  // They are organizational categories, not reliable geographic regions.
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
        : null,
    ].filter((value): value is string => Boolean(value));

    const uniqueCandidates = [...new Set(candidates)];

    const forestNameSignificantWords = extractSignificantWords(
      forestNameWithoutStateForest,
      directoryNameWithoutStateForest
    );

    const forestKey = `forest::${normalizedForestName}`;
    const aliasKeyNormalized = `alias:${normalizeKey(forestKey)}`;
    const attempts: GeocodeLookupAttempt[] = [];
    const warnings: string[] = [];

    // Fast path: check alias cache for this forest.
    const aliasHit = this.cache.get(aliasKeyNormalized);
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
        return toGeocodeResponse(
          aliasHit,
          [buildAttempt("CACHE", forestKey, aliasKeyNormalized, aliasKeyNormalized, "CACHE_HIT")]
        );
      }

      this.cache.delete(aliasKeyNormalized);
    }

    // -----------------------------------------------------------------------
    // FCNSW ArcGIS is the preferred source of truth for NSW state forests.
    // -----------------------------------------------------------------------
    const fcnswNames = [
      forestNameWithoutStateForest,
      ...(directoryNameWithoutStateForest &&
        directoryNameWithoutStateForest.toLowerCase() !== forestNameWithoutStateForest.toLowerCase()
          ? [directoryNameWithoutStateForest]
          : []),
    ].filter(Boolean);

    for (const fcnswCandidate of fcnswNames) {
      const fcnswCacheKey = `query:fcnsw:${normalizeKey(fcnswCandidate)}`;
      const fcnswCached = this.cache.get(fcnswCacheKey);

      if (fcnswCached && fcnswCached.provider === "FCNSW_ARCGIS") {
        this.cache.put(aliasKeyNormalized, fcnswCached);
        return toGeocodeResponse(
          fcnswCached,
          [buildAttempt("CACHE", fcnswCandidate, aliasKeyNormalized, fcnswCacheKey, "CACHE_HIT")],
        );
      }

      const fcnswLookup = await this.fcnswProvider.lookup(
        fcnswCandidate,
        aliasKeyNormalized,
        fcnswCacheKey
      );
      attempts.push(fcnswLookup.attempt);

      if (fcnswLookup.hit) {
        this.cache.put(fcnswCacheKey, fcnswLookup.hit);
        this.cache.put(aliasKeyNormalized, fcnswLookup.hit);
        return toGeocodeResponse(fcnswLookup.hit, attempts);
      }
    }

    // -----------------------------------------------------------------------
    // FCNSW lookup did not resolve — fall back to Google + Nominatim cascade.
    // -----------------------------------------------------------------------
    for (const query of uniqueCandidates) {
      const geocodeResult = await this.geocodeQuery(query);
      attempts.push(...(geocodeResult.attempts ?? []));
      warnings.push(...(geocodeResult.warnings ?? []));

      if (geocodeResult.latitude !== null && geocodeResult.longitude !== null) {
        const resultDisplayName = geocodeResult.displayName ?? query;

        if (!isPlausibleForestMatch(resultDisplayName, forestNameSignificantWords)) {
          warnings.push(
            `Rejected implausible result "${resultDisplayName}" for forest "${normalizedForestName}"`
          );

          // When Google returns implausible result, try Nominatim directly.
          const queryKey = `query:${normalizeKey(query)}`;
          const nominatimRetry = await this.nominatimProvider.lookup(query, null, queryKey);
          attempts.push(nominatimRetry.attempt);

          if (nominatimRetry.hit) {
            const nominatimDisplayName = nominatimRetry.hit.displayName;
            if (isPlausibleForestMatch(nominatimDisplayName, forestNameSignificantWords)) {
              this.cache.put(queryKey, nominatimRetry.hit);
              this.cache.put(aliasKeyNormalized, nominatimRetry.hit);
              return toGeocodeResponse(nominatimRetry.hit, attempts, [...new Set(warnings)]);
            }

            warnings.push(
              `Rejected implausible Nominatim result "${nominatimDisplayName}" for forest "${normalizedForestName}"`
            );
          }

          continue;
        }

        // When Google returns a result that doesn't mention "state forest",
        // also try Nominatim for a more precise centroid.
        const isGoogleResult = geocodeResult.provider === "GOOGLE_GEOCODING";
        const displayNameMentionsStateForest =
          resultDisplayName.toLowerCase().includes("state forest");

        if (isGoogleResult && !displayNameMentionsStateForest) {
          const queryKey = `query:${normalizeKey(query)}`;
          const nominatimSupplement = await this.nominatimProvider.lookup(query, null, queryKey);
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
              this.cache.put(queryKey, nominatimSupplement.hit);
              this.cache.put(aliasKeyNormalized, nominatimSupplement.hit);
              return toGeocodeResponse(
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
          updatedAt: new Date().toISOString(),
        };
        this.cache.put(aliasKeyNormalized, hit);

        return {
          ...geocodeResult,
          attempts,
          warnings: [...new Set(warnings)],
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
      warnings: [...new Set(warnings)],
    };
  }
}
