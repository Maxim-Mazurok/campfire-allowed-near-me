import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { haversineDistanceKm } from "../utils/distance.js";
import type { UserLocation } from "../types/domain.js";

export interface RouteMetric {
  distanceKm: number;
  durationMinutes: number;
}

export interface RouteOriginRow {
  id: number;
  latitude: number;
  longitude: number;
}

interface RouteCacheRow {
  forest_id: string;
  distance_km: number;
  duration_minutes: number;
}

const ROUTE_CACHE_RADIUS_KM = 5;

const toAvoidTollsInt = (avoidTolls: boolean): number => (avoidTolls ? 1 : 0);

export class RoutesSqliteCache {
  private readonly cacheDbPath: string;

  private db: DatabaseSync;

  constructor(cacheDbPath: string) {
    this.cacheDbPath = cacheDbPath;
    mkdirSync(dirname(cacheDbPath), { recursive: true });
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

  resolveOrigin(userLocation: UserLocation): RouteOriginRow {
    return this.findReusableOrigin(userLocation) ?? this.createOrigin(userLocation);
  }

  getCachedMetrics(
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

  putCachedMetric(
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
}
