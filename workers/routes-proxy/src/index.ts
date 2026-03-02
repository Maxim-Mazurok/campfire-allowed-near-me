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
    routingPreference: "TRAFFIC_AWARE"
  };

  const response = await fetch(ROUTES_API_URL, {
    method: "POST",
    headers: buildRoutesApiHeaders(
      apiKey,
      "originIndex,destinationIndex,condition,distanceMeters,duration"
    ),
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Google Routes API error (HTTP ${response.status}): ${body}`
    );
  }

  return (await response.json()) as RouteMatrixElement[];
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

  const matrixResults = await computeRouteMatrix(
    environment.GOOGLE_MAPS_API_KEY,
    body.origin,
    destinations,
    avoidTolls
  );

  const routes: Record<string, RouteResult> = {};
  const warnings: string[] = [];

  for (const element of matrixResults) {
    const destinationIndex = element.destinationIndex ?? 0;
    const destination = destinations[destinationIndex];
    if (!destination) continue;

    if (
      element.condition === "ROUTE_NOT_FOUND" ||
      !element.distanceMeters
    ) {
      warnings.push(
        `No route found for forest ${destination.id}`
      );
      continue;
    }

    const durationSeconds = parseDurationSeconds(element.duration);

    routes[destination.id] = {
      distanceKm: element.distanceMeters / 1000,
      durationMinutes: durationSeconds !== null ? durationSeconds / 60 : 0
    };
  }

  return jsonResponse({ routes, warnings });
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
