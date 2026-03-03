import type {
  ComputeRouteMatrixRequest,
  RouteMatrixElement
} from "./routes-rest-types.js";
import {
  ROUTES_API_URL,
  buildRoutesApiHeaders
} from "./routes-rest-types.js";

interface LatLng {
  latitude: number;
  longitude: number;
}

interface Environment {
  GOOGLE_MAPS_API_KEY: string;
  ROUTES_CACHE?: KVNamespace;
}

interface Destination {
  id: string;
  latitude: number;
  longitude: number;
}

interface RouteRequest {
  origin: LatLng;
  destinations: Destination[];
  avoidTolls?: boolean;
}

interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
}

interface CachedRouteData {
  routes: Record<string, RouteResult>;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Origin bucketing — rounds coordinates to ~4.4 km grid cells so nearby
// users share the same cache entry.
// ---------------------------------------------------------------------------

/** Approximate grid size in degrees (~4.4 km at mid-latitudes). */
const BUCKET_DEGREES = 0.04;

const bucketCoordinate = (value: number): number =>
  Math.round(value / BUCKET_DEGREES) * BUCKET_DEGREES;

const buildCacheKey = (
  latitude: number,
  longitude: number,
  avoidTolls: boolean
): string => {
  const bucketedLatitude = bucketCoordinate(latitude).toFixed(4);
  const bucketedLongitude = bucketCoordinate(longitude).toFixed(4);
  return `routes:${bucketedLatitude}:${bucketedLongitude}:${avoidTolls ? "no-tolls" : "tolls"}`;
};

/** Cache entries expire after 7 days. */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const jsonResponse = (
  body: unknown,
  status = 200
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });

const errorResponse = (message: string, status: number): Response =>
  jsonResponse({ error: message }, status);

const parseDurationSeconds = (duration: string | undefined): number | null => {
  if (!duration) return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  return match ? Number(match[1]) : null;
};

const computeRouteMatrix = async (
  apiKey: string,
  origin: LatLng,
  destinations: Destination[],
  avoidTolls: boolean
): Promise<RouteMatrixElement[]> => {
  const requestBody: ComputeRouteMatrixRequest = {
    origins: [
      {
        waypoint: {
          location: {
            latLng: {
              latitude: origin.latitude,
              longitude: origin.longitude
            }
          }
        },
        routeModifiers: {
          avoidTolls
        }
      }
    ],
    destinations: destinations.map((destination) => ({
      waypoint: {
        location: {
          latLng: {
            latitude: destination.latitude,
            longitude: destination.longitude
          }
        }
      }
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE"
  };

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: buildRoutesApiHeaders(
      apiKey,
      "originIndex,destinationIndex,condition,distanceMeters,staticDuration"
    ),
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429 || body.includes("RESOURCE_EXHAUSTED")) {
      throw new QuotaExhaustedError(
        `Google Routes API quota exhausted (HTTP ${response.status})`
      );
    }
    throw new Error(
      `Google Routes API error (HTTP ${response.status}): ${body}`
    );
  }

  return (await response.json()) as RouteMatrixElement[];
};

class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

const readCachedRoutes = async (
  kvNamespace: KVNamespace | undefined,
  cacheKey: string
): Promise<CachedRouteData | null> => {
  if (!kvNamespace) {
    return null;
  }
  try {
    return await kvNamespace.get<CachedRouteData>(cacheKey, "json");
  } catch {
    return null;
  }
};

const writeCachedRoutes = async (
  kvNamespace: KVNamespace | undefined,
  cacheKey: string,
  data: CachedRouteData
): Promise<void> => {
  if (!kvNamespace) {
    return;
  }
  try {
    await kvNamespace.put(cacheKey, JSON.stringify(data), {
      expirationTtl: CACHE_TTL_SECONDS
    });
  } catch {
    // Non-critical — cache write failures are silently ignored.
  }
};

const handleRouteRequest = async (
  request: Request,
  environment: Environment
): Promise<Response> => {
  let body: RouteRequest;
  try {
    body = (await request.json()) as RouteRequest;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (
    !body.origin ||
    typeof body.origin.latitude !== "number" ||
    typeof body.origin.longitude !== "number"
  ) {
    return errorResponse("Missing or invalid origin coordinates", 400);
  }

  if (!Array.isArray(body.destinations) || body.destinations.length === 0) {
    return errorResponse("destinations must be a non-empty array", 400);
  }

  if (body.destinations.length > 25) {
    return errorResponse("Maximum 25 destinations per request", 400);
  }

  for (const destination of body.destinations) {
    if (
      !destination.id ||
      typeof destination.latitude !== "number" ||
      typeof destination.longitude !== "number"
    ) {
      return errorResponse(
        "Each destination must have id, latitude, and longitude",
        400
      );
    }
  }

  const avoidTolls = body.avoidTolls ?? true;
  const destinations = body.destinations;

  // --- Cache lookup ---
  const cacheKey = buildCacheKey(
    body.origin.latitude,
    body.origin.longitude,
    avoidTolls
  );
  const cachedData = await readCachedRoutes(
    environment.ROUTES_CACHE,
    cacheKey
  );
  const cachedRoutes = cachedData?.routes ?? {};

  // Separate cached vs uncached destinations
  const uncachedDestinations = destinations.filter(
    (destination) => !cachedRoutes[destination.id]
  );

  // Collect cached results for the requested destinations
  const routes: Record<string, RouteResult> = {};
  let cachedCount = 0;
  for (const destination of destinations) {
    const cached = cachedRoutes[destination.id];
    if (cached) {
      routes[destination.id] = cached;
      cachedCount++;
    }
  }

  console.log(
    `[routes] key=${cacheKey} requested=${destinations.length} cached=${cachedCount} uncached=${uncachedDestinations.length}`
  );

  const warnings: string[] = [];
  let quotaExhausted = false;

  // --- Fetch uncached routes from Google ---
  if (uncachedDestinations.length > 0) {
    try {
      const matrixResults = await computeRouteMatrix(
        environment.GOOGLE_MAPS_API_KEY,
        body.origin,
        uncachedDestinations,
        avoidTolls
      );

      const newRoutes: Record<string, RouteResult> = {};

      for (const element of matrixResults) {
        const destinationIndex = element.destinationIndex ?? 0;
        const destination = uncachedDestinations[destinationIndex];
        if (!destination) continue;

        if (
          element.condition === "ROUTE_NOT_FOUND" ||
          !element.distanceMeters
        ) {
          console.log(`[routes] no route found for ${destination.id}`);
          warnings.push(
            `No route found for forest ${destination.id}`
          );
          continue;
        }

        const durationSeconds = parseDurationSeconds(element.staticDuration);

        const routeResult: RouteResult = {
          distanceKm: element.distanceMeters / 1_000,
          durationMinutes:
            durationSeconds !== null ? durationSeconds / 60 : 0
        };

        newRoutes[destination.id] = routeResult;
        routes[destination.id] = routeResult;
      }

      // Merge new routes into cache and persist
      console.log(
        `[routes] fetched ${Object.keys(newRoutes).length} new routes from Google`
      );
      await writeCachedRoutes(environment.ROUTES_CACHE, cacheKey, {
        routes: { ...cachedRoutes, ...newRoutes },
        updatedAt: Date.now()
      });
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        quotaExhausted = true;
        console.warn(`[routes] ${error.message}`);
        warnings.push(error.message);
      } else {
        throw error;
      }
    }
  }

  return jsonResponse({ routes, warnings, quotaExhausted });
};

export default {
  async fetch(
    request: Request,
    environment: Environment
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname === "/api/routes" && request.method === "POST") {
      try {
        return await handleRouteRequest(request, environment);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Internal server error";
        return errorResponse(message, 500);
      }
    }

    return errorResponse("Not found", 404);
  }
};
