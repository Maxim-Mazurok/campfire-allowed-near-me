import type { BanStatus } from "../../shared/contracts.js";

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

const RFS_TOTAL_FIRE_BAN_SOURCE_URL =
  "https://www.rfs.nsw.gov.au/fire-information/fdr-and-tobans";
const RFS_TOTAL_FIRE_BAN_RULES_URL =
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

interface TotalFireBanAreaStatus {
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

type Point = {
  latitude: number;
  longitude: number;
};

type Ring = Point[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

interface GeoBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

interface TotalFireBanGeoArea {
  areaId: string;
  areaName: string;
  geometryType: "Polygon" | "MultiPolygon";
  coordinates: Polygon | MultiPolygon;
  bounds: GeoBounds;
}

export type TotalFireBanLookupCode =
  | "MATCHED"
  | "NO_COORDINATES"
  | "NO_AREA_MATCH"
  | "MISSING_AREA_STATUS"
  | "DATA_UNAVAILABLE";

interface TotalFireBanLookupResult {
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

const parseCoordinatePoint = (value: unknown): Point | null => {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const longitude = value[0];
  const latitude = value[1];

  if (
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude)
  ) {
    return null;
  }

  return {
    latitude,
    longitude
  };
};

const computeBoundsForCoordinates = (
  coordinates: Polygon | MultiPolygon,
  geometryType: "Polygon" | "MultiPolygon"
): GeoBounds | null => {
  const bounds: GeoBounds = {
    minLatitude: Number.POSITIVE_INFINITY,
    maxLatitude: Number.NEGATIVE_INFINITY,
    minLongitude: Number.POSITIVE_INFINITY,
    maxLongitude: Number.NEGATIVE_INFINITY
  };

  const includePoint = (point: Point) => {
    bounds.minLatitude = Math.min(bounds.minLatitude, point.latitude);
    bounds.maxLatitude = Math.max(bounds.maxLatitude, point.latitude);
    bounds.minLongitude = Math.min(bounds.minLongitude, point.longitude);
    bounds.maxLongitude = Math.max(bounds.maxLongitude, point.longitude);
  };

  if (geometryType === "Polygon") {
    for (const ring of coordinates as Polygon) {
      for (const point of ring) {
        includePoint(point);
      }
    }
  } else {
    for (const polygon of coordinates as MultiPolygon) {
      for (const ring of polygon) {
        for (const point of ring) {
          includePoint(point);
        }
      }
    }
  }

  if (
    !Number.isFinite(bounds.minLatitude) ||
    !Number.isFinite(bounds.maxLatitude) ||
    !Number.isFinite(bounds.minLongitude) ||
    !Number.isFinite(bounds.maxLongitude)
  ) {
    return null;
  }

  return bounds;
};

const parsePolygon = (value: unknown): Polygon | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const polygon: Polygon = [];

  for (const rawRing of value) {
    if (!Array.isArray(rawRing)) {
      continue;
    }

    const ring: Ring = rawRing
      .map((entry) => parseCoordinatePoint(entry))
      .filter((entry): entry is Point => entry !== null);

    if (ring.length < 4) {
      continue;
    }

    polygon.push(ring);
  }

  return polygon.length ? polygon : null;
};

const parseMultiPolygon = (value: unknown): MultiPolygon | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const multipolygon: MultiPolygon = [];

  for (const rawPolygon of value) {
    const polygon = parsePolygon(rawPolygon);
    if (!polygon) {
      continue;
    }

    multipolygon.push(polygon);
  }

  return multipolygon.length ? multipolygon : null;
};

const isPointOnSegment = (point: Point, start: Point, end: Point): boolean => {
  const crossProduct =
    (point.latitude - start.latitude) * (end.longitude - start.longitude) -
    (point.longitude - start.longitude) * (end.latitude - start.latitude);

  if (Math.abs(crossProduct) > 1e-12) {
    return false;
  }

  const dotProduct =
    (point.longitude - start.longitude) * (end.longitude - start.longitude) +
    (point.latitude - start.latitude) * (end.latitude - start.latitude);

  if (dotProduct < 0) {
    return false;
  }

  const segmentLengthSquared =
    (end.longitude - start.longitude) ** 2 +
    (end.latitude - start.latitude) ** 2;

  if (dotProduct > segmentLengthSquared) {
    return false;
  }

  return true;
};

const isPointInRing = (point: Point, ring: Ring): boolean => {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index]!;
    const previousPoint = ring[previous]!;

    if (isPointOnSegment(point, previousPoint, currentPoint)) {
      return true;
    }

    const intersects =
      (currentPoint.latitude > point.latitude) !==
        (previousPoint.latitude > point.latitude) &&
      point.longitude <
        ((previousPoint.longitude - currentPoint.longitude) *
          (point.latitude - currentPoint.latitude)) /
          (previousPoint.latitude - currentPoint.latitude) +
          currentPoint.longitude;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
};

const isPointInPolygon = (point: Point, polygon: Polygon): boolean => {
  if (!polygon.length) {
    return false;
  }

  const outerRing = polygon[0]!;
  if (!isPointInRing(point, outerRing)) {
    return false;
  }

  for (let index = 1; index < polygon.length; index += 1) {
    if (isPointInRing(point, polygon[index]!)) {
      return false;
    }
  }

  return true;
};

const isPointInGeometry = (
  point: Point,
  geometryType: "Polygon" | "MultiPolygon",
  coordinates: Polygon | MultiPolygon
): boolean => {
  if (geometryType === "Polygon") {
    return isPointInPolygon(point, coordinates as Polygon);
  }

  return (coordinates as MultiPolygon).some((polygon) => isPointInPolygon(point, polygon));
};

const isWithinBounds = (point: Point, bounds: GeoBounds): boolean =>
  point.latitude >= bounds.minLatitude &&
  point.latitude <= bounds.maxLatitude &&
  point.longitude >= bounds.minLongitude &&
  point.longitude <= bounds.maxLongitude;

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
