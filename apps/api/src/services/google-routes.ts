import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import pLimit from "p-limit";
import { haversineDistanceKm } from "../utils/distance.js";
import type { UserLocation } from "../types/domain.js";

interface RouteOriginRow {
  id: number;
  latitude: number;
  longitude: number;
}

interface RouteCacheRow {
  forest_id: string;
  distance_km: number;
  duration_minutes: number;
}

interface ComputeRouteResponse {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
  }>;
}

interface RouteMetric {
  distanceKm: number;
  durationMinutes: number;
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

const ROUTE_CACHE_RADIUS_KM = 5;

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

const toAvoidTollsInt = (avoidTolls: boolean): number => (avoidTolls ? 1 : 0);

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

  private readonly cacheDbPath: string;

  private readonly maxConcurrentRequests: number;

  private db: DatabaseSync;

  constructor(options?: {
    apiKey?: string | null;
    cacheDbPath?: string;
    maxConcurrentRequests?: number;
  }) {
    this.apiKey = options?.apiKey?.trim() || null;
    this.cacheDbPath = options?.cacheDbPath ?? "data/cache/routes.sqlite";
    this.maxConcurrentRequests = options?.maxConcurrentRequests ?? 8;

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
      CREATE TABLE IF NOT EXISTS route_origin (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS route_cache (
        origin_id INTEGER NOT NULL,
        forest_id TEXT NOT NULL,
        avoid_tolls INTEGER NOT NULL,
        distance_km REAL NOT NULL,
        duration_minutes REAL NOT NULL,
        cached_at TEXT NOT NULL,
        PRIMARY KEY(origin_id, forest_id, avoid_tolls),
        FOREIGN KEY(origin_id) REFERENCES route_origin(id)
      );
    `);

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

  private findReusableOrigin(userLocation: UserLocation): RouteOriginRow | null {
    const rows = this.db
      .prepare("SELECT id, latitude, longitude FROM route_origin")
      .all() as unknown as RouteOriginRow[];

    let closest: { row: RouteOriginRow; distanceKm: number } | null = null;

    for (const row of rows) {
      const distanceKm = haversineDistanceKm(
        userLocation.latitude,
        userLocation.longitude,
        row.latitude,
        row.longitude
      );

      if (distanceKm > ROUTE_CACHE_RADIUS_KM) {
        continue;
      }

      if (!closest || distanceKm < closest.distanceKm) {
        closest = { row, distanceKm };
      }
    }

    return closest?.row ?? null;
  }

  private createOrigin(userLocation: UserLocation): RouteOriginRow {
    let insertedLastRowId: number | bigint = 0;

    this.runWriteStatement(() => {
      const inserted = this.db
        .prepare(
          "INSERT INTO route_origin (latitude, longitude, created_at) VALUES (?, ?, ?)"
        )
        .run(userLocation.latitude, userLocation.longitude, new Date().toISOString());
      insertedLastRowId = inserted.lastInsertRowid;
    });

    return {
      id: Number(insertedLastRowId),
      latitude: userLocation.latitude,
      longitude: userLocation.longitude
    };
  }

  private resolveOrigin(userLocation: UserLocation): RouteOriginRow {
    return this.findReusableOrigin(userLocation) ?? this.createOrigin(userLocation);
  }

  private getCachedMetrics(
    originId: number,
    forestIds: string[],
    avoidTolls: boolean
  ): Map<string, RouteMetric> {
    if (!forestIds.length) {
      return new Map();
    }

    const placeholders = forestIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
          SELECT forest_id, distance_km, duration_minutes
          FROM route_cache
          WHERE origin_id = ?
            AND avoid_tolls = ?
            AND forest_id IN (${placeholders})
        `
      )
      .all(originId, toAvoidTollsInt(avoidTolls), ...forestIds) as unknown as RouteCacheRow[];

    return new Map(
      rows.map((row) => [
        row.forest_id,
        {
          distanceKm: row.distance_km,
          durationMinutes: row.duration_minutes
        }
      ])
    );
  }

  private putCachedMetric(
    originId: number,
    forestId: string,
    avoidTolls: boolean,
    metric: RouteMetric
  ): void {
    this.runWriteStatement(() => {
      this.db
        .prepare(
          `
            INSERT INTO route_cache (
              origin_id, forest_id, avoid_tolls, distance_km, duration_minutes, cached_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(origin_id, forest_id, avoid_tolls)
            DO UPDATE SET
              distance_km = excluded.distance_km,
              duration_minutes = excluded.duration_minutes,
              cached_at = excluded.cached_at
          `
        )
        .run(
          originId,
          forestId,
          toAvoidTollsInt(avoidTolls),
          metric.distanceKm,
          metric.durationMinutes,
          new Date().toISOString()
        );
    });
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

    const origin = this.resolveOrigin(input.userLocation);
    const forestIds = input.forests.map((forest) => forest.id);

    const cached = this.getCachedMetrics(origin.id, forestIds, input.avoidTolls);
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
          this.putCachedMetric(origin.id, forest.id, input.avoidTolls, metric);
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
