import type {
  GeocodeHit,
  GoogleGeocodingResponse,
  ProviderResult,
} from "./geocode-types.js";
import {
  buildAttempt,
  deriveGoogleConfidence,
  isStreetLevelGoogleResult,
  roundCoordinate,
  sleep,
  shouldRetryHttpStatus,
  toErrorMessage,
} from "./geocode-helpers.js";

export interface GoogleGeocodingProviderOptions {
  googleApiKey: string | null;
  requestTimeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  requestDelayMs: number;
}

export class GoogleGeocodingProvider {
  constructor(private readonly options: GoogleGeocodingProviderOptions) {}

  get hasApiKey(): boolean {
    return this.options.googleApiKey !== null;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, this.options.requestTimeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private async runWithRetries(
    executeAttempt: () => Promise<Response>
  ): Promise<{ response: Response | null; error: string | null }> {
    let lastError: string | null = null;

    for (let attemptNumber = 1; attemptNumber <= this.options.retryAttempts; attemptNumber += 1) {
      try {
        const response = await executeAttempt();

        if (shouldRetryHttpStatus(response.status) && attemptNumber < this.options.retryAttempts) {
          const backoffDelayMs = this.options.retryBaseDelayMs * 2 ** (attemptNumber - 1);
          await sleep(backoffDelayMs);
          continue;
        }

        return { response, error: null };
      } catch (error) {
        lastError = toErrorMessage(error);
        if (attemptNumber < this.options.retryAttempts) {
          const backoffDelayMs = this.options.retryBaseDelayMs * 2 ** (attemptNumber - 1);
          await sleep(backoffDelayMs);
          continue;
        }
      }
    }

    return { response: null, error: lastError };
  }

  async lookup(
    query: string,
    aliasKey: string | null,
    cacheKey: string
  ): Promise<ProviderResult> {
    const googleApiKey = this.options.googleApiKey;
    if (!googleApiKey) {
      return {
        hit: null,
        attempt: buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "GOOGLE_API_KEY_MISSING"
        ),
      };
    }

    const geocodeUrl = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    geocodeUrl.searchParams.set("address", query);
    geocodeUrl.searchParams.set("region", "au");
    geocodeUrl.searchParams.set("language", "en");
    geocodeUrl.searchParams.set("key", googleApiKey);

    const googleRequest = await this.runWithRetries(() =>
      this.fetchWithTimeout(geocodeUrl.toString(), {
        headers: { Accept: "application/json" },
      })
    );

    if (!googleRequest.response) {
      return {
        hit: null,
        attempt: buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          { errorMessage: googleRequest.error }
        ),
      };
    }

    const response = googleRequest.response;

    if (!response.ok) {
      return {
        hit: null,
        attempt: buildAttempt("GOOGLE_GEOCODING", query, aliasKey, cacheKey, "HTTP_ERROR", {
          httpStatus: response.status,
        }),
      };
    }

    let geocodingResponse: GoogleGeocodingResponse;
    try {
      geocodingResponse = (await response.json()) as GoogleGeocodingResponse;
    } catch (error) {
      return {
        hit: null,
        attempt: buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          { errorMessage: `Invalid JSON response: ${toErrorMessage(error)}` }
        ),
      };
    }

    const results = geocodingResponse.results ?? [];
    const first = results[0];

    if (!first?.geometry?.location) {
      return {
        hit: null,
        attempt: buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "EMPTY_RESULT",
          { resultCount: results.length }
        ),
      };
    }

    const latitude = roundCoordinate(Number(first.geometry.location.lat));
    const longitude = roundCoordinate(Number(first.geometry.location.lng));

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        hit: null,
        attempt: buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "INVALID_COORDINATES",
          { resultCount: results.length }
        ),
      };
    }

    const displayName = first.formatted_address?.trim() || query;
    const resultTypes = first.types ?? [];

    // Reject street-level results — a street address is never a valid forest.
    if (isStreetLevelGoogleResult(resultTypes)) {
      return {
        hit: null,
        attempt: buildAttempt(
          "GOOGLE_GEOCODING",
          query,
          aliasKey,
          cacheKey,
          "EMPTY_RESULT",
          {
            resultCount: results.length,
            errorMessage: `Rejected street-level result type [${resultTypes.join(", ")}]: "${displayName}"`,
          }
        ),
      };
    }

    const hit: GeocodeHit = {
      latitude,
      longitude,
      displayName,
      importance: deriveGoogleConfidence(resultTypes),
      provider: "GOOGLE_GEOCODING",
      updatedAt: new Date().toISOString(),
    };

    return {
      hit,
      attempt: buildAttempt("GOOGLE_GEOCODING", query, aliasKey, cacheKey, "LOOKUP_SUCCESS", {
        resultCount: results.length,
      }),
    };
  }
}
