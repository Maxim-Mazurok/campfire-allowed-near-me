import type {
  GeocodeHit,
  NominatimRow,
  ProviderResult,
} from "./geocode-types.js";
import { DEFAULT_NOMINATIM_BASE_URL } from "./geocode-types.js";
import {
  buildAttempt,
  isLocalNominatimBaseUrl,
  roundCoordinate,
  sleep,
  shouldRetryHttpStatus,
  toErrorMessage,
} from "./geocode-helpers.js";

export interface NominatimProviderOptions {
  nominatimBaseUrl: string;
  requestTimeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
  requestDelayMs: number;
  localNominatimDelayMs: number;
  localNominatimHttp429Retries: number;
  localNominatimHttp429RetryDelayMs: number;
}

export class NominatimProvider {
  constructor(private readonly options: NominatimProviderOptions) {}

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
    const nominatimBaseUrls = [this.options.nominatimBaseUrl, DEFAULT_NOMINATIM_BASE_URL];
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
              Accept: "application/json",
            },
          })
        );

        if (isLocalNominatim && this.options.localNominatimDelayMs > 0) {
          await sleep(this.options.localNominatimDelayMs);
        }

        if (!isLocalNominatim && this.options.requestDelayMs > 0) {
          await sleep(this.options.requestDelayMs);
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
            localNominatimHttp429RetryCount < this.options.localNominatimHttp429Retries
          ) {
            localNominatimHttp429RetryCount += 1;

            if (this.options.localNominatimHttp429RetryDelayMs > 0) {
              await sleep(this.options.localNominatimHttp429RetryDelayMs);
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
          updatedAt: new Date().toISOString(),
        };

        return {
          hit,
          attempt: buildAttempt(
            "OSM_NOMINATIM",
            query,
            aliasKey,
            cacheKey,
            "LOOKUP_SUCCESS",
            { resultCount }
          ),
        };
      }
    }

    if (lastHttpStatus !== null) {
      return {
        hit: null,
        attempt: buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "HTTP_ERROR", {
          httpStatus: lastHttpStatus,
          errorMessage: lastErrorMessage,
        }),
      };
    }

    if (lastErrorMessage) {
      return {
        hit: null,
        attempt: buildAttempt(
          "OSM_NOMINATIM",
          query,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          { errorMessage: lastErrorMessage }
        ),
      };
    }

    return {
      hit: null,
      attempt: buildAttempt("OSM_NOMINATIM", query, aliasKey, cacheKey, "EMPTY_RESULT"),
    };
  }
}
