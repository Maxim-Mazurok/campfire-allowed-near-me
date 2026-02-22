import pLimit from "p-limit";
import type { UserLocation } from "../types/domain.js";
import { type RouteMetric, type RouteOriginRow, RoutesSqliteCache } from "./routes-sqlite-cache.js";

interface ComputeRouteResponse {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
}

export interface RouteLookupForest {
  id: string;
  latitude: number;
  longitude: number;
}

export interface RouteLookupInput {
  userLocation: UserLocation;
  forests: RouteLookupForest[];
  avoidTolls: boolean;
  progressCallback?: (progress: { completed: number; total: number; message: string }) => void;
}

export interface RouteLookupResult {
  byForestId: Map<string, RouteMetric>;
  warnings: string[];
}

export interface RouteService {
  getDrivingRouteMetrics(input: RouteLookupInput): Promise<RouteLookupResult>;
}

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message.trim();
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Unknown error";
};

const parseDurationMinutes = (rawDuration: string | undefined): number | null => {
  if (!rawDuration) {
    return null;
  }

  const match = rawDuration.match(/^([0-9]+(?:\.[0-9]+)?)s$/);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds)) {
    return null;
  }

  return seconds / 60;
};

const buildNextSaturdayAtTenAm = (now = new Date()): Date => {
  const departure = new Date(now);
  departure.setHours(10, 0, 0, 0);

  const dayOfWeek = now.getDay();
  let daysUntilSaturday = (6 - dayOfWeek + 7) % 7;
  if (daysUntilSaturday === 0 && now.getTime() >= departure.getTime()) {
    daysUntilSaturday = 7;
  }

  departure.setDate(now.getDate() + daysUntilSaturday);
  return departure;
};

export class GoogleRoutesService implements RouteService {
  private readonly apiKey: string | null;

  private readonly maxConcurrentRequests: number;

  private readonly cache: RoutesSqliteCache;

  constructor(options?: {
    apiKey?: string | null;
    cacheDbPath?: string;
    maxConcurrentRequests?: number;
  }) {
    this.apiKey = options?.apiKey?.trim() || null;
    this.maxConcurrentRequests = options?.maxConcurrentRequests ?? 8;
    this.cache = new RoutesSqliteCache(options?.cacheDbPath ?? "data/cache/routes.sqlite");
  }

  private async lookupGoogleRoute(
    userLocation: UserLocation,
    destination: RouteLookupForest,
    avoidTolls: boolean,
    departureTimeIso: string
  ): Promise<{ metric: RouteMetric | null; error: string | null }> {
    if (!this.apiKey) {
      return {
        metric: null,
        error: "GOOGLE_MAPS_API_KEY is not configured"
      };
    }

    const requestBody = {
      origin: {
        location: {
          latLng: {
            latitude: userLocation.latitude,
            longitude: userLocation.longitude
          }
        }
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.latitude,
            longitude: destination.longitude
          }
        }
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE_OPTIMAL",
      departureTime: departureTimeIso,
      routeModifiers: {
        avoidTolls,
        avoidHighways: false,
        avoidFerries: false
      },
      units: "METRIC"
    };

    let response: Response;
    try {
      response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration"
        },
        body: JSON.stringify(requestBody)
      });
    } catch (error) {
      return {
        metric: null,
        error: `Request failed (${toErrorMessage(error)})`
      };
    }

    if (!response.ok) {
      return {
        metric: null,
        error: `HTTP ${response.status}`
      };
    }

    let body: ComputeRouteResponse;
    try {
      body = (await response.json()) as ComputeRouteResponse;
    } catch (error) {
      return {
        metric: null,
        error: `Invalid JSON (${toErrorMessage(error)})`
      };
    }

    const firstRoute = body.routes?.[0];
    const distanceMeters = firstRoute?.distanceMeters;
    const durationMinutes = parseDurationMinutes(firstRoute?.duration);

    if (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters)) {
      return {
        metric: null,
        error: "No route was returned"
      };
    }

    if (durationMinutes === null) {
      return {
        metric: null,
        error: "No route was returned"
      };
    }

    return {
      metric: {
        distanceKm: distanceMeters / 1000,
        durationMinutes
      },
      error: null
    };
  }

  async getDrivingRouteMetrics(input: RouteLookupInput): Promise<RouteLookupResult> {
    const warnings = new Set<string>();
    const byForestId = new Map<string, RouteMetric>();

    if (!input.forests.length) {
      return {
        byForestId,
        warnings: []
      };
    }

    const origin = this.cache.resolveOrigin(input.userLocation);
    const forestIds = input.forests.map((forest) => forest.id);

    const cached = this.cache.getCachedMetrics(origin.id, forestIds, input.avoidTolls);
    for (const [forestId, metric] of cached.entries()) {
      byForestId.set(forestId, metric);
    }

    const missingForests = input.forests.filter((forest) => !byForestId.has(forest.id));
    const routeRequestTotal = missingForests.length;
    let completedRouteRequests = 0;

    input.progressCallback?.({
      completed: completedRouteRequests,
      total: routeRequestTotal,
      message: `Computing driving routes (${completedRouteRequests}/${routeRequestTotal}).`
    });

    if (!missingForests.length) {
      return {
        byForestId,
        warnings: []
      };
    }

    const departureTimeIso = buildNextSaturdayAtTenAm().toISOString();

    if (!this.apiKey) {
      warnings.add(
        "Google Routes is unavailable because GOOGLE_MAPS_API_KEY is not configured; driving distance/time could not be calculated for some forests."
      );
      return {
        byForestId,
        warnings: [...warnings]
      };
    }

    const limit = pLimit(this.maxConcurrentRequests);
    let failedLookups = 0;
    const sampleErrors = new Set<string>();

    await Promise.all(
      missingForests.map((forest) =>
        limit(async () => {
          const { metric, error } = await this.lookupGoogleRoute(
            input.userLocation,
            forest,
            input.avoidTolls,
            departureTimeIso
          );

          completedRouteRequests += 1;
          input.progressCallback?.({
            completed: completedRouteRequests,
            total: routeRequestTotal,
            message: `Computing driving routes (${completedRouteRequests}/${routeRequestTotal}).`
          });

          if (!metric) {
            failedLookups += 1;
            if (error && sampleErrors.size < 3) {
              sampleErrors.add(error);
            }
            return;
          }

          byForestId.set(forest.id, metric);
          this.cache.putCachedMetric(origin.id, forest.id, input.avoidTolls, metric);
        })
      )
    );

    if (failedLookups > 0) {
      const suffix = sampleErrors.size
        ? ` Examples: ${[...sampleErrors].join("; ")}.`
        : "";
      warnings.add(
        `Google Routes failed for ${failedLookups} forest route(s); driving distance/time is unavailable for those forests.${suffix}`
      );
    }

    return {
      byForestId,
      warnings: [...warnings]
    };
  }
}
