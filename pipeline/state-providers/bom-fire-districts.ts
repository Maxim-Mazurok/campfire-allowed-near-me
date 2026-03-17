/**
 * National BOM Fire Danger Districts Service
 *
 * Uses the Bureau of Meteorology / Esri Australia fire districts FeatureServer:
 *   services1.arcgis.com/vHnIGBHHqDR6y0CR → Fire_Districts_-_4_Day_Forecast → Layer 5
 *
 * Covers all 8 Australian states/territories. Returns live fire danger ratings
 * per district, plus polygon geometry for point-in-polygon lookups.
 *
 * Note: This service provides FireDanger (rating), NOT TotalFireBan status.
 * Total fire ban status must come from state-specific sources.
 */

import type { AustralianState } from "../../shared/contracts.js";

const BOM_FEATURE_SERVER_URL =
  "https://services1.arcgis.com/vHnIGBHHqDR6y0CR/arcgis/rest/services/Fire_Districts_-_4_Day_Forecast/FeatureServer/5/query";

export type FireDangerRating =
  | "Catastrophic"
  | "Extreme"
  | "Severe"
  | "Very High"
  | "High"
  | "Moderate"
  | "Low-Moderate"
  | "No Rating"
  | "Unknown";

type Point = { latitude: number; longitude: number };
type Ring = Point[];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

interface GeoBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface BomFireDistrict {
  distName: string;
  stateCode: AustralianState;
  fireDanger: FireDangerRating;
  forecastPeriod: number;
  startTime: string | null;
  bounds: GeoBounds;
  geometryType: "Polygon" | "MultiPolygon";
  coordinates: Polygon | MultiPolygon;
}

export interface BomFireDistrictSnapshot {
  fetchedAt: string;
  districts: BomFireDistrict[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Geometry helpers (mirrors total-fire-ban-service.ts approach)
// ---------------------------------------------------------------------------

const isPointInRing = (p: Point, ring: Ring): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ci = ring[i]!;
    const cj = ring[j]!;
    if (ci.latitude === p.latitude && ci.longitude === p.longitude) return true;
    const intersects =
      (ci.latitude > p.latitude) !== (cj.latitude > p.latitude) &&
      p.longitude <
        ((cj.longitude - ci.longitude) * (p.latitude - ci.latitude)) /
          (cj.latitude - ci.latitude) +
          ci.longitude;
    if (intersects) inside = !inside;
  }
  return inside;
};

const isPointInPolygon = (p: Point, polygon: Polygon): boolean => {
  const outer = polygon[0];
  if (!outer || !isPointInRing(p, outer)) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (isPointInRing(p, polygon[i]!)) return false;
  }
  return true;
};

const isPointInGeometry = (
  p: Point,
  type: "Polygon" | "MultiPolygon",
  coords: Polygon | MultiPolygon
): boolean => {
  if (type === "Polygon") return isPointInPolygon(p, coords as Polygon);
  return (coords as MultiPolygon).some((poly) => isPointInPolygon(p, poly));
};

const isWithinBounds = (p: Point, b: GeoBounds): boolean =>
  p.latitude >= b.minLat &&
  p.latitude <= b.maxLat &&
  p.longitude >= b.minLng &&
  p.longitude <= b.maxLng;

// ---------------------------------------------------------------------------
// ArcGIS geometry parsing
// ---------------------------------------------------------------------------

const parseRings = (rawRings: unknown[][]): Ring[] => {
  const rings: Ring[] = [];
  for (const rawRing of rawRings) {
    const ring: Ring = [];
    for (const pt of rawRing) {
      if (Array.isArray(pt) && pt.length >= 2) {
        const [lng, lat] = pt as [number, number];
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          ring.push({ latitude: lat, longitude: lng });
        }
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
};

const computeBounds = (coords: Polygon | MultiPolygon, type: "Polygon" | "MultiPolygon"): GeoBounds => {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const rings: Ring[] = type === "Polygon"
    ? (coords as Polygon).flat(0)
    : (coords as MultiPolygon).flat(1);
  for (const ring of rings) {
    for (const p of ring) {
      if (p.latitude < minLat) minLat = p.latitude;
      if (p.latitude > maxLat) maxLat = p.latitude;
      if (p.longitude < minLng) minLng = p.longitude;
      if (p.longitude > maxLng) maxLng = p.longitude;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
};

// ---------------------------------------------------------------------------
// Fire danger rating normalisation
// ---------------------------------------------------------------------------

const FIRE_DANGER_MAP: Record<string, FireDangerRating> = {
  "catastrophic": "Catastrophic",
  "extreme": "Extreme",
  "severe": "Severe",
  "very high": "Very High",
  "high": "High",
  "moderate": "Moderate",
  "low-moderate": "Low-Moderate",
  "no rating": "No Rating",
  "no forecast": "No Rating",
};

const parseFireDanger = (raw: unknown): FireDangerRating => {
  if (typeof raw !== "string") return "Unknown";
  return FIRE_DANGER_MAP[raw.toLowerCase().trim()] ?? "Unknown";
};

const parseStateCode = (raw: unknown): AustralianState | null => {
  const valid: AustralianState[] = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
  if (typeof raw === "string" && (valid as string[]).includes(raw)) {
    return raw as AustralianState;
  }
  return null;
};

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export class BomFireDistrictService {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options?: { fetchImpl?: typeof fetch; timeoutMs?: number }) {
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.timeoutMs = options?.timeoutMs ?? 30_000;
  }

  async fetchSnapshot(forecastPeriod = 1): Promise<BomFireDistrictSnapshot> {
    const warnings: string[] = [];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let rawFeatures: unknown[] = [];
    try {
      const params = new URLSearchParams({
        where: `Forecast_Period=${forecastPeriod}`,
        outFields: "DIST_NAME,STATE_CODE,FireDanger,Forecast_Period,Start_Time",
        returnGeometry: "true",
        outSR: "4326",
        f: "json",
        resultRecordCount: "2000",
      });
      const url = `${BOM_FEATURE_SERVER_URL}?${params}`;
      const response = await this.fetchImpl(url, {
        headers: {
          "User-Agent":
            "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire-danger-lookup)",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as { features?: unknown[]; error?: { message: string } };
      if (json.error) throw new Error(json.error.message);
      rawFeatures = json.features ?? [];
    } catch (err) {
      warnings.push(
        `Could not load BOM fire danger districts: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const districts: BomFireDistrict[] = [];

    for (const feature of rawFeatures) {
      if (typeof feature !== "object" || feature === null) continue;
      const f = feature as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> };
      const attrs = f.attributes ?? {};
      const geom = f.geometry ?? {};

      const stateCode = parseStateCode(attrs["STATE_CODE"]);
      if (!stateCode) continue;

      const distName = typeof attrs["DIST_NAME"] === "string" ? attrs["DIST_NAME"].trim() : "";
      if (!distName) continue;

      const fireDanger = parseFireDanger(attrs["FireDanger"]);
      const forecastPeriodVal = typeof attrs["Forecast_Period"] === "number" ? attrs["Forecast_Period"] : 1;
      const startTime =
        typeof attrs["Start_Time"] === "number"
          ? new Date(attrs["Start_Time"]).toISOString()
          : null;

      // Parse geometry
      const rawRings = geom["rings"] as unknown[][] | undefined;
      if (!rawRings || !Array.isArray(rawRings)) continue;

      const rings = parseRings(rawRings);
      if (!rings.length) continue;

      const polygon: Polygon = rings;
      const bounds = computeBounds(polygon, "Polygon");

      districts.push({
        distName,
        stateCode,
        fireDanger,
        forecastPeriod: forecastPeriodVal,
        startTime,
        bounds,
        geometryType: "Polygon",
        coordinates: polygon,
      });
    }

    if (!districts.length) {
      warnings.push("BOM fire danger districts returned no usable features.");
    }

    return {
      fetchedAt: new Date().toISOString(),
      districts,
      warnings,
    };
  }

  /**
   * Look up the fire danger district for a given lat/lng.
   * Returns the first matching district, or null if no match.
   */
  lookupDistrict(
    snapshot: BomFireDistrictSnapshot,
    latitude: number,
    longitude: number,
    stateCode?: AustralianState
  ): BomFireDistrict | null {
    const point: Point = { latitude, longitude };
    const candidates = stateCode
      ? snapshot.districts.filter((d) => d.stateCode === stateCode)
      : snapshot.districts;

    return (
      candidates.find(
        (d) =>
          isWithinBounds(point, d.bounds) &&
          isPointInGeometry(point, d.geometryType, d.coordinates)
      ) ?? null
    );
  }
}
