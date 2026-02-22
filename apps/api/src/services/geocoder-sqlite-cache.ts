import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type GeocodeProvider = "GOOGLE_PLACES" | "OSM_NOMINATIM";

export interface GeocodeHit {
  latitude: number;
  longitude: number;
  displayName: string;
  importance: number;
  provider: GeocodeProvider;
  updatedAt: string;
}

export class GeocoderSqliteCache {
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
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        display_name TEXT NOT NULL,
        importance REAL NOT NULL,
        provider TEXT NOT NULL DEFAULT 'OSM_NOMINATIM',
        updated_at TEXT NOT NULL
      );
    `);

    // Legacy caches created before provider support need a one-time migration.
    try {
      db.exec(
        "ALTER TABLE geocode_cache ADD COLUMN provider TEXT NOT NULL DEFAULT 'OSM_NOMINATIM';"
      );
    } catch {
      // Ignore duplicate-column failures.
    }

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

  normalizeKey(raw: string): string {
    return raw.toLowerCase().trim().replace(/\s+/g, " ");
  }

  getCached(key: string): GeocodeHit | null {
    const row = this.db
      .prepare(
        "SELECT latitude, longitude, display_name, importance, provider, updated_at FROM geocode_cache WHERE cache_key = ?"
      )
      .get(key) as
      | {
          latitude: number;
          longitude: number;
          display_name: string;
          importance: number;
          provider?: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const provider = row.provider === "GOOGLE_PLACES" ? "GOOGLE_PLACES" : "OSM_NOMINATIM";

    return {
      latitude: row.latitude,
      longitude: row.longitude,
      displayName: row.display_name,
      importance: row.importance,
      provider,
      updatedAt: row.updated_at
    };
  }

  putCached(key: string, hit: GeocodeHit): void {
    this.runWriteStatement(() => {
      this.db
        .prepare(
          `
            INSERT INTO geocode_cache (
              cache_key, latitude, longitude, display_name, importance, provider, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
              latitude = excluded.latitude,
              longitude = excluded.longitude,
              display_name = excluded.display_name,
              importance = excluded.importance,
              provider = excluded.provider,
              updated_at = excluded.updated_at
          `
        )
        .run(
          key,
          hit.latitude,
          hit.longitude,
          hit.displayName,
          hit.importance,
          hit.provider,
          hit.updatedAt
        );
    });
  }
}
