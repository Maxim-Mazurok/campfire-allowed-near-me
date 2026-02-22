import type { BanStatus } from "../types/domain.js";
import {
  type GeoBounds,
  type MultiPolygon,
  type Point,
  type Polygon,
  type TotalFireBanGeoArea,
  computeBoundsForCoordinates,
  isPointInGeometry,
  isWithinBounds,
  parseMultiPolygon,
  parsePolygon
} from "./total-fire-ban-geo.js";

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeAreaName = (value: string): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[&/]/g, " and ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TOTAL_FIRE_BAN_ACTIVE_STATUS_TEXT = "Total Fire Ban";
const TOTAL_FIRE_BAN_INACTIVE_STATUS_TEXT = "No Total Fire Ban";
export const UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT =
  "Unknown (Total Fire Ban status unavailable)";

export const RFS_TOTAL_FIRE_BAN_SOURCE_URL =
  "https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans";
export const RFS_TOTAL_FIRE_BAN_RULES_URL =
  "https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans/total-fire-ban-rules";

interface TotalFireBanServiceOptions {
  ratingsUrl: string;
  geoJsonUrl: string;
  timeoutMs: number;
}

interface TotalFireBanServiceConstructorOptions
  extends Partial<TotalFireBanServiceOptions> {
  fetchImpl?: typeof fetch;
}

const DEFAULT_OPTIONS: TotalFireBanServiceOptions = {
  ratingsUrl:
    "https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2",
  geoJsonUrl:
    "https://www.rfs.nsw.gov.au/_designs/geojson/fire-danger-ratings-geojson",
  timeoutMs: 20_000
};

export interface TotalFireBanAreaStatus {
  areaId: string;
  areaName: string;
  status: BanStatus;
  statusText: string;
  rawStatusText: string;
}

export interface TotalFireBanSnapshot {
  fetchedAt: string;
  lastUpdatedIso: string | null;
  areaStatuses: TotalFireBanAreaStatus[];
  geoAreas: TotalFireBanGeoArea[];
  warnings: string[];
}

export type { TotalFireBanGeoArea } from "./total-fire-ban-geo.js";

export type TotalFireBanLookupCode =
  | "MATCHED"
  | "NO_COORDINATES"
  | "NO_AREA_MATCH"
  | "MISSING_AREA_STATUS"
  | "DATA_UNAVAILABLE";

export interface TotalFireBanLookupResult {
  status: BanStatus;
  statusText: string;
  fireWeatherAreaName: string | null;
  lookupCode: TotalFireBanLookupCode;
  rawStatusText: string | null;
}

interface TotalFireBanRatingsPayload {
  fireWeatherAreaRatings?: unknown;
  lastUpdatedIso?: unknown;
}

interface TotalFireBanGeoJsonPayload {
  features?: unknown;
}

const parseTotalFireBanStatus = (value: string): BanStatus => {
  const normalized = normalizeText(value).toLowerCase();

  if (!normalized) {
    return "UNKNOWN";
  }

  if (["yes", "y", "true", "1"].includes(normalized)) {
    return "BANNED";
  }

  if (["no", "n", "false", "0"].includes(normalized)) {
    return "NOT_BANNED";
  }

  return "UNKNOWN";
};

const statusTextForTotalFireBan = (status: BanStatus): string => {
  if (status === "BANNED") {
    return TOTAL_FIRE_BAN_ACTIVE_STATUS_TEXT;
  }

  if (status === "NOT_BANNED") {
    return TOTAL_FIRE_BAN_INACTIVE_STATUS_TEXT;
  }

  return UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseAreaId = (value: unknown): string => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    return normalizeText(value);
  }

  return "";
};

const parseAreaName = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  return normalizeText(value);
};

export class TotalFireBanService {
  private readonly options: TotalFireBanServiceOptions;

  private readonly fetchImpl: typeof fetch;

  constructor(options?: TotalFireBanServiceConstructorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        headers: {
          "User-Agent":
            "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: total fire ban lookup)",
          Accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private parseRatingsPayload(payload: unknown): {
    areaStatuses: TotalFireBanAreaStatus[];
    lastUpdatedIso: string | null;
  } {
    if (!isObjectRecord(payload)) {
      return {
        areaStatuses: [],
        lastUpdatedIso: null
      };
    }

    const typedPayload = payload as TotalFireBanRatingsPayload;
    const rows = Array.isArray(typedPayload.fireWeatherAreaRatings)
      ? typedPayload.fireWeatherAreaRatings
      : [];

    const areaStatuses: TotalFireBanAreaStatus[] = rows
      .map((row) => {
        if (!isObjectRecord(row)) {
          return null;
        }

        const areaId = parseAreaId(row.areaId);
        const areaName = parseAreaName(row.areaName);
        if (!areaId || !areaName) {
          return null;
        }

        const rawStatusText =
          typeof row.tobanToday === "string" ? normalizeText(row.tobanToday) : "";
        const status = parseTotalFireBanStatus(rawStatusText);

        return {
          areaId,
          areaName,
          status,
          statusText: statusTextForTotalFireBan(status),
          rawStatusText
        };
      })
      .filter((row): row is TotalFireBanAreaStatus => row !== null)
      .sort((left, right) => left.areaName.localeCompare(right.areaName));

    const lastUpdatedIso =
      typeof typedPayload.lastUpdatedIso === "string" &&
      !Number.isNaN(Date.parse(typedPayload.lastUpdatedIso))
        ? typedPayload.lastUpdatedIso
        : null;

    return {
      areaStatuses,
      lastUpdatedIso
    };
  }

  private parseGeoJsonPayload(payload: unknown): TotalFireBanGeoArea[] {
    if (!isObjectRecord(payload)) {
      return [];
    }

    const typedPayload = payload as TotalFireBanGeoJsonPayload;
    const features = Array.isArray(typedPayload.features) ? typedPayload.features : [];

    const areaById = new Map<string, TotalFireBanGeoArea>();

    for (const feature of features) {
      if (!isObjectRecord(feature)) {
        continue;
      }

      const properties = isObjectRecord(feature.properties)
        ? feature.properties
        : ({} as Record<string, unknown>);
      const geometry = isObjectRecord(feature.geometry)
        ? feature.geometry
        : ({} as Record<string, unknown>);

      const areaId = parseAreaId(properties.FIREAREAID);
      const areaName = parseAreaName(properties.FIREAREA);
      if (!areaId || !areaName) {
        continue;
      }

      const geometryType = geometry.type;
      const rawCoordinates = geometry.coordinates;

      let coordinates: Polygon | MultiPolygon | null = null;
      if (geometryType === "Polygon") {
        coordinates = parsePolygon(rawCoordinates);
      } else if (geometryType === "MultiPolygon") {
        coordinates = parseMultiPolygon(rawCoordinates);
      }

      if (!coordinates) {
        continue;
      }

      const bounds = computeBoundsForCoordinates(
        coordinates,
        geometryType as "Polygon" | "MultiPolygon"
      );
      if (!bounds) {
        continue;
      }

      if (areaById.has(areaId)) {
        continue;
      }

      areaById.set(areaId, {
        areaId,
        areaName,
        geometryType: geometryType as "Polygon" | "MultiPolygon",
        coordinates,
        bounds
      });
    }

    return [...areaById.values()].sort((left, right) => left.areaName.localeCompare(right.areaName));
  }

  async fetchCurrentSnapshot(): Promise<TotalFireBanSnapshot> {
    const warnings = new Set<string>();

    const [ratingsResult, geoJsonResult] = await Promise.allSettled([
      this.fetchJson<unknown>(this.options.ratingsUrl),
      this.fetchJson<unknown>(this.options.geoJsonUrl)
    ]);

    let areaStatuses: TotalFireBanAreaStatus[] = [];
    let lastUpdatedIso: string | null = null;

    if (ratingsResult.status === "fulfilled") {
      const parsed = this.parseRatingsPayload(ratingsResult.value);
      areaStatuses = parsed.areaStatuses;
      lastUpdatedIso = parsed.lastUpdatedIso;

      if (!areaStatuses.length) {
        warnings.add(
          "Total Fire Ban status feed returned no fire weather areas; statuses are temporarily unknown."
        );
      }
    } else {
      warnings.add(
        `Could not load Total Fire Ban status feed from NSW RFS (${this.options.ratingsUrl}).`
      );
    }

    let geoAreas: TotalFireBanGeoArea[] = [];
    if (geoJsonResult.status === "fulfilled") {
      geoAreas = this.parseGeoJsonPayload(geoJsonResult.value);
      if (!geoAreas.length) {
        warnings.add(
          "Total Fire Ban map geometry feed returned no usable fire weather areas; status mapping is temporarily unavailable."
        );
      }
    } else {
      warnings.add(
        `Could not load Total Fire Ban map geometry feed from NSW RFS (${this.options.geoJsonUrl}).`
      );
    }

    return {
      fetchedAt: new Date().toISOString(),
      lastUpdatedIso,
      areaStatuses,
      geoAreas,
      warnings: [...warnings]
    };
  }

  lookupStatusByCoordinates(
    snapshot: TotalFireBanSnapshot,
    latitude: number | null,
    longitude: number | null
  ): TotalFireBanLookupResult {
    if (latitude === null || longitude === null) {
      return {
        status: "UNKNOWN",
        statusText: UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT,
        fireWeatherAreaName: null,
        lookupCode: "NO_COORDINATES",
        rawStatusText: null
      };
    }

    if (!snapshot.areaStatuses.length || !snapshot.geoAreas.length) {
      return {
        status: "UNKNOWN",
        statusText: UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT,
        fireWeatherAreaName: null,
        lookupCode: "DATA_UNAVAILABLE",
        rawStatusText: null
      };
    }

    const point: Point = { latitude, longitude };

    const matchedArea = snapshot.geoAreas.find(
      (area) =>
        isWithinBounds(point, area.bounds) &&
        isPointInGeometry(point, area.geometryType, area.coordinates)
    );

    if (!matchedArea) {
      return {
        status: "UNKNOWN",
        statusText: UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT,
        fireWeatherAreaName: null,
        lookupCode: "NO_AREA_MATCH",
        rawStatusText: null
      };
    }

    const statusByAreaId = new Map(
      snapshot.areaStatuses.map((areaStatus) => [areaStatus.areaId, areaStatus])
    );

    const normalizedMatchedAreaName = normalizeAreaName(matchedArea.areaName);
    const statusByAreaName = new Map(
      snapshot.areaStatuses.map((areaStatus) => [
        normalizeAreaName(areaStatus.areaName),
        areaStatus
      ])
    );

    const matchedStatus =
      statusByAreaId.get(matchedArea.areaId) ?? statusByAreaName.get(normalizedMatchedAreaName);

    if (!matchedStatus) {
      return {
        status: "UNKNOWN",
        statusText: UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT,
        fireWeatherAreaName: matchedArea.areaName,
        lookupCode: "MISSING_AREA_STATUS",
        rawStatusText: null
      };
    }

    return {
      status: matchedStatus.status,
      statusText: matchedStatus.statusText,
      fireWeatherAreaName: matchedStatus.areaName,
      lookupCode: "MATCHED",
      rawStatusText: matchedStatus.rawStatusText
    };
  }
}
