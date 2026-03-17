import type {
  FcnswArcgisQueryResponse,
  GeocodeHit,
  GeocodeLookupAttempt,
  ProviderResult,
} from "./geocode-types.js";
import { FCNSW_ARCGIS_QUERY_URL } from "./geocode-types.js";
import {
  buildAttempt,
  extractCoreName,
  roundCoordinate,
  sleep,
  shouldRetryHttpStatus,
  toErrorMessage,
} from "./geocode-helpers.js";

/**
 * Compute the centroid of a polygon defined by its rings.
 * Uses the signed-area formula for the exterior ring (first ring).
 * Falls back to a simple bounding-box center if the area is degenerate.
 */
export const computePolygonCentroid = (
  rings: number[][][]
): { latitude: number; longitude: number } | null => {
  const exteriorRing = rings[0];
  if (!exteriorRing || exteriorRing.length < 3) {
    return null;
  }

  let signedArea = 0;
  let centroidX = 0;
  let centroidY = 0;

  for (let i = 0; i < exteriorRing.length - 1; i += 1) {
    const [x0, y0] = exteriorRing[i]!;
    const [x1, y1] = exteriorRing[i + 1]!;
    const crossProduct = x0! * y1! - x1! * y0!;
    signedArea += crossProduct;
    centroidX += (x0! + x1!) * crossProduct;
    centroidY += (y0! + y1!) * crossProduct;
  }

  signedArea /= 2;

  if (Math.abs(signedArea) < 1e-10) {
    // Degenerate polygon — fall back to bounding-box center.
    let minimumX = Infinity;
    let maximumX = -Infinity;
    let minimumY = Infinity;
    let maximumY = -Infinity;
    for (const [x, y] of exteriorRing) {
      if (x! < minimumX) minimumX = x!;
      if (x! > maximumX) maximumX = x!;
      if (y! < minimumY) minimumY = y!;
      if (y! > maximumY) maximumY = y!;
    }
    return {
      latitude: roundCoordinate((minimumY + maximumY) / 2),
      longitude: roundCoordinate((minimumX + maximumX) / 2),
    };
  }

  centroidX /= 6 * signedArea;
  centroidY /= 6 * signedArea;

  return {
    latitude: roundCoordinate(centroidY),
    longitude: roundCoordinate(centroidX),
  };
};

export interface FcnswArcgisProviderOptions {
  requestTimeoutMs: number;
  retryAttempts: number;
  retryBaseDelayMs: number;
}

export class FcnswArcgisProvider {
  constructor(private readonly options: FcnswArcgisProviderOptions) {}

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
    forestName: string,
    aliasKey: string | null,
    cacheKey: string
  ): Promise<ProviderResult> {
    const coreName = extractCoreName(forestName).toUpperCase();

    if (!coreName) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "EMPTY_RESULT",
          { errorMessage: "Core forest name is empty after stripping suffixes" }
        ),
      };
    }

    const queryUrl = new URL(FCNSW_ARCGIS_QUERY_URL);
    queryUrl.searchParams.set("where", `UPPER(SFName) LIKE '%${coreName}%'`);
    queryUrl.searchParams.set("outFields", "SFName,SFNo");
    queryUrl.searchParams.set("returnGeometry", "true");
    queryUrl.searchParams.set("outSR", "4326");
    queryUrl.searchParams.set("f", "json");

    const arcgisRequest = await this.runWithRetries(() =>
      this.fetchWithTimeout(queryUrl.toString(), {
        headers: { Accept: "application/json" },
      })
    );

    if (!arcgisRequest.response) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          { errorMessage: arcgisRequest.error }
        ),
      };
    }

    const response = arcgisRequest.response;

    if (!response.ok) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "HTTP_ERROR",
          { httpStatus: response.status }
        ),
      };
    }

    let arcgisResponse: FcnswArcgisQueryResponse;
    try {
      arcgisResponse = (await response.json()) as FcnswArcgisQueryResponse;
    } catch (error) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "REQUEST_FAILED",
          { errorMessage: `Invalid JSON response: ${toErrorMessage(error)}` }
        ),
      };
    }

    if (arcgisResponse.error) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "HTTP_ERROR",
          { errorMessage: `ArcGIS error ${arcgisResponse.error.code}: ${arcgisResponse.error.message}` }
        ),
      };
    }

    const features = arcgisResponse.features ?? [];

    if (features.length === 0) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "EMPTY_RESULT",
          { resultCount: 0 }
        ),
      };
    }

    // When multiple results match, prefer an exact name match over a partial
    // LIKE hit. If no exact match exists, report ambiguity.
    let selectedFeature = features[0]!;
    if (features.length > 1) {
      const exactMatch = features.find(
        (feature) => feature.attributes.SFName.toUpperCase() === coreName
      );
      if (exactMatch) {
        selectedFeature = exactMatch;
      } else {
        return {
          hit: null,
          attempt: buildAttempt(
            "FCNSW_ARCGIS",
            forestName,
            aliasKey,
            cacheKey,
            "FCNSW_MULTIPLE_MATCHES",
            {
              resultCount: features.length,
              errorMessage: `Ambiguous: ${features.length} forests match "${coreName}" — ${features.map((feature) => feature.attributes.SFName).join(", ")}`,
            }
          ),
        };
      }
    }

    const geometry = selectedFeature.geometry;
    if (!geometry?.rings?.length) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "INVALID_COORDINATES",
          { resultCount: features.length, errorMessage: "Feature has no geometry rings" }
        ),
      };
    }

    const centroid = computePolygonCentroid(geometry.rings);
    if (!centroid) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "INVALID_COORDINATES",
          { resultCount: features.length, errorMessage: "Unable to compute polygon centroid" }
        ),
      };
    }

    if (!Number.isFinite(centroid.latitude) || !Number.isFinite(centroid.longitude)) {
      return {
        hit: null,
        attempt: buildAttempt(
          "FCNSW_ARCGIS",
          forestName,
          aliasKey,
          cacheKey,
          "INVALID_COORDINATES",
          { resultCount: features.length }
        ),
      };
    }

    const sfName = selectedFeature.attributes.SFName;
    const sfNumber = selectedFeature.attributes.SFNo;
    const displayName = `${sfName} State Forest (SF${sfNumber})`;

    const hit: GeocodeHit = {
      latitude: centroid.latitude,
      longitude: centroid.longitude,
      displayName,
      importance: 1,
      provider: "FCNSW_ARCGIS",
      updatedAt: new Date().toISOString(),
    };

    return {
      hit,
      attempt: buildAttempt(
        "FCNSW_ARCGIS",
        forestName,
        aliasKey,
        cacheKey,
        "LOOKUP_SUCCESS",
        { resultCount: features.length }
      ),
    };
  }
}
