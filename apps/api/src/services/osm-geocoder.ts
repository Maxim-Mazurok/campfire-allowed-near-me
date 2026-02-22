import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

interface GeocodeHit {
  latitude: number;
  longitude: number;
  displayName: string;
  importance: number;
  updatedAt: string;
}

interface NominatimRow {
  lat: string;
  lon: string;
  display_name: string;
  importance?: number;
}

export type GeocodeLookupOutcome =
  | "CACHE_HIT"
  | "LOOKUP_SUCCESS"
  | "LIMIT_REACHED"
  | "HTTP_ERROR"
  | "REQUEST_FAILED"
  | "EMPTY_RESULT"
  | "INVALID_COORDINATES";

export interface GeocodeLookupAttempt {
  query: string;
  aliasKey: string | null;
  cacheKey: string;
  outcome: GeocodeLookupOutcome;
  httpStatus: number | null;
  resultCount: number | null;
  errorMessage: string | null;
}

export interface GeocodeResponse {
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  confidence: number | null;
  attempts?: GeocodeLookupAttempt[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message.trim();
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Unknown error";
};

export class OSMGeocoder {
  private readonly cacheDbPath: string;

  private readonly requestDelayMs: number;

  private readonly maxNewLookupsPerRun: number;

  private readonly db: DatabaseSync;

  private newLookupsThisRun = 0;

  constructor(options?: {
    cacheDbPath?: string;
    requestDelayMs?: number;
    maxNewLookupsPerRun?: number;
  }) {
    this.cacheDbPath = options?.cacheDbPath ?? "data/cache/coordinates.sqlite";
    this.requestDelayMs = options?.requestDelayMs ?? 1200;
    this.maxNewLookupsPerRun = options?.maxNewLookupsPerRun ?? 25;

    mkdirSync(dirname(this.cacheDbPath), { recursive: true });
    this.db = new DatabaseSync(this.cacheDbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        display_name TEXT NOT NULL,
        importance REAL NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  private toGeocodeResponse(
    hit: GeocodeHit,
    attempts: GeocodeLookupAttempt[]
  ): GeocodeResponse {
    return {
      latitude: hit.latitude,
      longitude: hit.longitude,
      displayName: hit.displayName,
      confidence: hit.importance,
      attempts
    };
  }

  private buildAttempt(
    query: string,
    aliasKey: string | null,
    cacheKey: string,
    outcome: GeocodeLookupOutcome,
    options?: {
      httpStatus?: number | null;
      resultCount?: number | null;
      errorMessage?: string | null;
    }
  ): GeocodeLookupAttempt {
    return {
      query,
      aliasKey,
      cacheKey,
      outcome,
      httpStatus: options?.httpStatus ?? null,
      resultCount: options?.resultCount ?? null,
      errorMessage: options?.errorMessage ?? null
    };
  }

  private normalizeKey(raw: string): string {
    return raw.toLowerCase().trim().replace(/\s+/g, " ");
  }

  private getCached(key: string): GeocodeHit | null {
    const row = this.db
      .prepare(
        "SELECT latitude, longitude, display_name, importance, updated_at FROM geocode_cache WHERE cache_key = ?"
      )
      .get(key) as
      | {
          latitude: number;
          longitude: number;
          display_name: string;
          importance: number;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      latitude: row.latitude,
      longitude: row.longitude,
      displayName: row.display_name,
      importance: row.importance,
      updatedAt: row.updated_at
    };
  }

  private putCached(key: string, hit: GeocodeHit): void {
    this.db
      .prepare(
        `
          INSERT INTO geocode_cache (
            cache_key, latitude, longitude, display_name, importance, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(cache_key) DO UPDATE SET
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            display_name = excluded.display_name,
            importance = excluded.importance,
            updated_at = excluded.updated_at
        `
      )
      .run(
        key,
        hit.latitude,
        hit.longitude,
        hit.displayName,
        hit.importance,
        hit.updatedAt
      );
  }

  private async geocodeQuery(query: string, aliasKey?: string): Promise<GeocodeResponse> {
    const queryKey = `query:${this.normalizeKey(query)}`;
    const aliasKeyNormalized = aliasKey
      ? `alias:${this.normalizeKey(aliasKey)}`
      : null;
    const cacheHitFromAlias = aliasKeyNormalized
      ? this.getCached(aliasKeyNormalized)
      : null;
    const cacheHitFromQuery = this.getCached(queryKey);

    const cached = cacheHitFromAlias ?? cacheHitFromQuery;
    const cacheKeyUsed = cacheHitFromAlias
      ? aliasKeyNormalized
      : cacheHitFromQuery
        ? queryKey
        : null;

    if (cached && cacheKeyUsed) {
      return this.toGeocodeResponse(cached, [
        this.buildAttempt(query, aliasKeyNormalized, cacheKeyUsed, "CACHE_HIT")
      ]);
    }

    if (this.newLookupsThisRun >= this.maxNewLookupsPerRun) {
      return {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          this.buildAttempt(query, aliasKeyNormalized, queryKey, "LIMIT_REACHED")
        ]
      };
    }

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("countrycodes", "au");
    url.searchParams.set("limit", "1");

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          "User-Agent":
            "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire ban lookup)",
          Accept: "application/json"
        }
      });
    } catch (error) {
      return {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          this.buildAttempt(query, aliasKeyNormalized, queryKey, "REQUEST_FAILED", {
            errorMessage: toErrorMessage(error)
          })
        ]
      };
    }

    if (!response.ok) {
      return {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          this.buildAttempt(query, aliasKeyNormalized, queryKey, "HTTP_ERROR", {
            httpStatus: response.status
          })
        ]
      };
    }

    let rows: NominatimRow[];
    try {
      rows = (await response.json()) as NominatimRow[];
    } catch (error) {
      this.newLookupsThisRun += 1;
      return {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          this.buildAttempt(query, aliasKeyNormalized, queryKey, "REQUEST_FAILED", {
            errorMessage: `Invalid JSON response: ${toErrorMessage(error)}`
          })
        ]
      };
    }

    const resultCount = rows.length;
    const top = rows[0];
    this.newLookupsThisRun += 1;

    if (!top?.lat || !top?.lon) {
      return {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          this.buildAttempt(query, aliasKeyNormalized, queryKey, "EMPTY_RESULT", {
            resultCount
          })
        ]
      };
    }

    const latitude = Number(top.lat);
    const longitude = Number(top.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        attempts: [
          this.buildAttempt(query, aliasKeyNormalized, queryKey, "INVALID_COORDINATES", {
            resultCount
          })
        ]
      };
    }

    const attempts = [
      this.buildAttempt(query, aliasKeyNormalized, queryKey, "LOOKUP_SUCCESS", {
        resultCount
      })
    ];

    const hit: GeocodeHit = {
      latitude,
      longitude,
      displayName: top.display_name,
      importance: top.importance ?? 0,
      updatedAt: new Date().toISOString()
    };

    this.putCached(queryKey, hit);
    if (aliasKeyNormalized) {
      this.putCached(aliasKeyNormalized, hit);
    }

    await sleep(this.requestDelayMs);

    return this.toGeocodeResponse(hit, attempts);
  }

  async geocodeForest(
    forestName: string,
    areaName?: string
  ): Promise<GeocodeResponse> {
    const queryForestName = /state forest/i.test(forestName)
      ? forestName
      : `${forestName} State Forest`;
    const normalizedAreaName = areaName?.trim();
    const query = normalizedAreaName
      ? `${queryForestName}, ${normalizedAreaName}, New South Wales, Australia`
      : `${queryForestName}, New South Wales, Australia`;
    const forestKey = `forest:${normalizedAreaName ?? ""}:${forestName}`;
    return this.geocodeQuery(query, forestKey);
  }

  async geocodeArea(
    areaName: string,
    areaUrl: string
  ): Promise<GeocodeResponse> {
    const fromUrl = areaUrl
      .split("/")
      .at(-1)
      ?.replace(/-/g, " ")
      .replace(/\b(state|forests?|around|native|pine|of|the)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    const queryCandidates = [
      `${areaName}, New South Wales, Australia`,
      fromUrl ? `${fromUrl}, New South Wales, Australia` : null
    ].filter((value): value is string => Boolean(value));

    const areaKey = `area:${areaUrl || areaName}`;
    const attempts: GeocodeLookupAttempt[] = [];

    for (const query of queryCandidates) {
      const hit = await this.geocodeQuery(query, areaKey);
      attempts.push(...(hit.attempts ?? []));
      if (hit.latitude !== null && hit.longitude !== null) {
        return {
          ...hit,
          attempts
        };
      }
    }

    return {
      latitude: null,
      longitude: null,
      displayName: null,
      confidence: null,
      attempts
    };
  }
}
