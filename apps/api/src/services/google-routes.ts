import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

interface RouteMetric {
  distanceKm: number;
  durationMinutes: number;
}

interface ProxyRouteResponse {
  routes: Record<string, RouteMetric>;
  warnings: string[];
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

/** Maximum forest IDs per proxy request (proxy enforces this limit). */
const PROXY_BATCH_SIZE = 25;

const toAvoidTollsInt = (avoidTolls: boolean): number => (avoidTolls ? 1 : 0);

export class GoogleRoutesService implements RouteService {
  private readonly routesProxyUrl: string;

  private readonly cacheDbPath: string;

  private db: DatabaseSync;

  constructor(options?: {
    routesProxyUrl?: string;
    cacheDbPath?: string;
  }) {
    this.routesProxyUrl =
      options?.routesProxyUrl ?? "http://localhost:8787/api/routes";
    this.cacheDbPath = options?.cacheDbPath ?? "data/cache/routes.sqlite";

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

  private async fetchRoutesFromProxy(
    userLocation: UserLocation,
    forestIds: string[],
    avoidTolls: boolean
  ): Promise<ProxyRouteResponse> {
    const response = await fetch(this.routesProxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: {
          latitude: userLocation.latitude,
          longitude: userLocation.longitude
        },
        forestIds,
        avoidTolls
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Routes proxy error (HTTP ${response.status}): ${body || response.statusText}`
      );
    }

    return (await response.json()) as ProxyRouteResponse;
  }

  async getDrivingRouteMetrics(input: RouteLookupInput): Promise<RouteLookupResult> {
    const warnings: string[] = [];
    const byForestId = new Map<string, RouteMetric>();

    if (!input.forests.length) {
      return { byForestId, warnings };
    }

    const origin = this.resolveOrigin(input.userLocation);
    const forestIds = input.forests.map((forest) => forest.id);

    const cached = this.getCachedMetrics(origin.id, forestIds, input.avoidTolls);
    for (const [forestId, metric] of cached.entries()) {
      byForestId.set(forestId, metric);
    }

    const missingForestIds = input.forests
      .filter((forest) => !byForestId.has(forest.id))
      .map((forest) => forest.id);

    input.progressCallback?.({
      completed: 0,
      total: missingForestIds.length,
      message: `Computing driving routes (0/${missingForestIds.length}).`
    });

    if (!missingForestIds.length) {
      return { byForestId, warnings };
    }

    const chunks: string[][] = [];
    for (let i = 0; i < missingForestIds.length; i += PROXY_BATCH_SIZE) {
      chunks.push(missingForestIds.slice(i, i + PROXY_BATCH_SIZE));
    }

    let completedRouteRequests = 0;

    for (const chunk of chunks) {
      try {
        const proxyResponse = await this.fetchRoutesFromProxy(
          input.userLocation,
          chunk,
          input.avoidTolls
        );

        for (const [forestId, metric] of Object.entries(proxyResponse.routes)) {
          byForestId.set(forestId, metric);
          this.putCachedMetric(origin.id, forestId, input.avoidTolls, metric);
        }

        warnings.push(...proxyResponse.warnings);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown proxy error";
        warnings.push(
          `Routes proxy failed for ${chunk.length} forest(s): ${message}`
        );
      }

      completedRouteRequests += chunk.length;
      input.progressCallback?.({
        completed: completedRouteRequests,
        total: missingForestIds.length,
        message: `Computing driving routes (${completedRouteRequests}/${missingForestIds.length}).`
      });
    }

    return { byForestId, warnings };
  }
}
