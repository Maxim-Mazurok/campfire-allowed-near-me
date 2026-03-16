/**
 * Tasmania Forest/Campground Provider
 *
 * Uses two sources from the Tasmania LIST (Land Information System Tasmania):
 *
 *  1. PWS Campground Layer (Layer 20):
 *     services.thelist.tas.gov.au/arcgis/rest/services/Public/PWSPublic/MapServer/20
 *     → 89 PWS-managed campgrounds with exact coordinates + CF_RULES (campfire rules)
 *     Fields: NAME, CF_ALLOWED, CF_RULES, geometry (point)
 *     CF_RULES values:
 *       "Fuel Stove Only"                                    → campfires permanently banned
 *       "Fires permitted in BYO Fire Pots"                   → campfires allowed (with fire pot)
 *       "Campfires Permitted (use provided fire pits where available)" → campfires allowed
 *       "Fires permitted in provided fire pits/structures"   → campfires allowed
 *
 *  2. Campfire Banned Areas Layer (Layer 18):
 *     Same MapServer, Layer 18 — polygons where campfires are currently banned.
 *     If a campground's point falls within one of these polygons, it is under a
 *     real-time campfire ban (seasonal/total fire ban).
 *
 * Fire Ban fallback: TFS total fire ban page scraping.
 */

import type {
  AustralianState,
  BanStatus,
  PersistedForestPoint,
} from "../../../shared/contracts.js";
import type { IStateProvider, StateProviderResult } from "../state-provider.js";
import { fetchTasFireBans } from "./fire-ban-provider.js";
import { slugify } from "../../../shared/text-utils.js";

// ---------------------------------------------------------------------------
// ArcGIS endpoints
// ---------------------------------------------------------------------------

const PWS_MAPSERVER =
  "https://services.thelist.tas.gov.au/arcgis/rest/services/Public/PWSPublic/MapServer";

const CAMPGROUND_LAYER = `${PWS_MAPSERVER}/20`;
const CAMPFIRE_BAN_LAYER = `${PWS_MAPSERVER}/18`;

const TFS_FIRE_BAN_URL = "https://www.fire.tas.gov.au/total-fire-bans-fire-permits-burn-registrations/";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CampgroundFeature {
  name: string;
  cfRules: string | null;
  latitude: number;
  longitude: number;
}

type Ring = Array<[number, number]>;

interface BanAreaFeature {
  rings: Ring[];
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const isPointInRing = (lat: number, lng: number, ring: Ring): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects =
      (yi! > lat) !== (yj! > lat) &&
      lng < ((xj! - xi!) * (lat - yi!)) / (yj! - yi!) + xi!;
    if (intersects) inside = !inside;
  }
  return inside;
};

const isPointInBanArea = (lat: number, lng: number, area: BanAreaFeature): boolean => {
  const outer = area.rings[0];
  if (!outer || !isPointInRing(lat, lng, outer)) return false;
  for (let i = 1; i < area.rings.length; i++) {
    if (isPointInRing(lat, lng, area.rings[i]!)) return false;
  }
  return true;
};

// ---------------------------------------------------------------------------
// ArcGIS fetchers
// ---------------------------------------------------------------------------

const fetchAllFeatures = async <T>(
  queryUrl: string,
  params: URLSearchParams,
  fetchImpl: typeof fetch
): Promise<T[]> => {
  const url = `${queryUrl}/query?${params}`;
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "campfire-allowed-near-me/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const json = (await response.json()) as { features?: T[]; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.features ?? [];
};

const fetchCampgrounds = async (fetchImpl: typeof fetch): Promise<CampgroundFeature[]> => {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "NAME,CF_ALLOWED,CF_RULES",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    resultRecordCount: "500",
  });

  const features = await fetchAllFeatures<{
    attributes: { NAME: string | null; CF_ALLOWED: string | null; CF_RULES: string | null };
    geometry: { x: number; y: number };
  }>(CAMPGROUND_LAYER, params, fetchImpl);

  const campgrounds: CampgroundFeature[] = [];
  for (const f of features) {
    const name = f.attributes.NAME?.trim();
    if (!name) continue;
    const { x, y } = f.geometry;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    campgrounds.push({
      name,
      cfRules: f.attributes.CF_RULES?.trim() ?? null,
      latitude: y,  // ArcGIS: x=longitude, y=latitude
      longitude: x,
    });
  }
  return campgrounds;
};

const fetchCampfireBanAreas = async (fetchImpl: typeof fetch): Promise<BanAreaFeature[]> => {
  const params = new URLSearchParams({
    where: "1=1",
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
    resultRecordCount: "500",
  });

  const features = await fetchAllFeatures<{
    geometry?: { rings?: Ring[] };
  }>(CAMPFIRE_BAN_LAYER, params, fetchImpl);

  const areas: BanAreaFeature[] = [];
  for (const f of features) {
    const rings = f.geometry?.rings;
    if (!rings?.length) continue;
    areas.push({ rings });
  }
  return areas;
};

// ---------------------------------------------------------------------------
// Campfire rule → BanStatus
// ---------------------------------------------------------------------------

const cfRulesToBanStatus = (cfRules: string | null): { status: BanStatus; statusText: string; banScope: string } => {
  if (!cfRules) {
    return { status: "UNKNOWN", statusText: "Campfire rules not specified", banScope: "ALL" };
  }
  const norm = cfRules.toLowerCase().trim();
  if (norm.includes("fuel stove only")) {
    return {
      status: "BANNED",
      statusText: "Campfires not permitted — fuel stove only (permanent rule)",
      banScope: "INCLUDING_CAMPS",
    };
  }
  if (
    norm.includes("fires permitted") ||
    norm.includes("campfires permitted") ||
    norm.includes("fire pits")
  ) {
    return {
      status: "NOT_BANNED",
      statusText: `Campfires permitted${cfRules.includes("BYO") ? " (BYO fire pot)" : " (use provided fire pits)"}`,
      banScope: "ALL",
    };
  }
  return { status: "UNKNOWN", statusText: cfRules, banScope: "ALL" };
};

// ---------------------------------------------------------------------------
// Main provider
// ---------------------------------------------------------------------------

export class TasmaniaStateProvider implements IStateProvider {
  readonly stateCode: AustralianState = "TAS";
  readonly stateName = "Tasmania";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    const warnings: string[] = [];

    // 1. Fetch campgrounds from ArcGIS
    let campgrounds: CampgroundFeature[] = [];
    try {
      campgrounds = await fetchCampgrounds(this.fetchImpl);
      if (!campgrounds.length) {
        warnings.push("TAS PWS campground layer returned no features.");
      }
    } catch (err) {
      warnings.push(
        `Could not fetch TAS campgrounds from TheList: ${err instanceof Error ? err.message : String(err)}`
      );
      return { points: [], warnings };
    }

    // 2. Fetch real-time campfire ban areas (Layer 18)
    let banAreas: BanAreaFeature[] = [];
    try {
      banAreas = await fetchCampfireBanAreas(this.fetchImpl);
    } catch (err) {
      warnings.push(
        `Could not fetch TAS campfire ban areas (Layer 18): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 3. Fetch TFS total fire ban status (for state-level TFB overlay)
    const fireBanResult = await fetchTasFireBans(this.fetchImpl);
    warnings.push(...fireBanResult.warnings);

    // 4. Build PersistedForestPoint[] for each campground
    const points: PersistedForestPoint[] = campgrounds.map((cg) => {
      const { status: defaultStatus, statusText: defaultStatusText } = cfRulesToBanStatus(cg.cfRules);

      // Check if this campground falls in a real-time fire ban area
      const inBanArea = banAreas.some((area) => isPointInBanArea(cg.latitude, cg.longitude, area));

      // Check for TFS total fire ban (state-wide)
      const tasFireBanActive = fireBanResult.anyBanActive ||
        Object.values(fireBanResult.districtBans).some((s) => s === "BANNED");

      let totalFireBanStatus: BanStatus;
      let totalFireBanStatusText: string;

      if (inBanArea || tasFireBanActive) {
        totalFireBanStatus = "BANNED";
        totalFireBanStatusText = inBanArea
          ? "Campfire ban in force at this location"
          : "Total Fire Ban declared in Tasmania";
      } else if (defaultStatus === "BANNED") {
        // Permanent fuel-stove-only rule — report as banned regardless of TFB
        totalFireBanStatus = "BANNED";
        totalFireBanStatusText = defaultStatusText;
      } else if (defaultStatus === "NOT_BANNED") {
        totalFireBanStatus = "NOT_BANNED";
        totalFireBanStatusText = defaultStatusText;
      } else {
        totalFireBanStatus = "UNKNOWN";
        totalFireBanStatusText = defaultStatusText;
      }

      const forestId = `tas-${slugify(cg.name)}`;

      return {
        id: forestId,
        state: "TAS",
        source: "Tasmania Parks and Wildlife Service (TheList)",
        areas: [
          {
            areaName: "Tasmania",
            areaUrl: TFS_FIRE_BAN_URL,
            banStatus: tasFireBanActive ? "BANNED" : "NOT_BANNED",
            banStatusText: tasFireBanActive
              ? "Total Fire Ban declared"
              : "No Total Fire Ban",
            banScope: "ALL",
          },
        ],
        forestName: cg.name,
        forestUrl: null,
        totalFireBanStatus,
        totalFireBanStatusText,
        latitude: cg.latitude,
        longitude: cg.longitude,
        geocodeName: cg.name,
        geocodeDiagnostics: null,
        totalFireBanDiagnostics: {
          reason: inBanArea
            ? "Campground falls within a current campfire ban area (TheList Layer 18)"
            : tasFireBanActive
              ? "TFS Total Fire Ban is active"
              : "No campfire ban area covers this campground",
          lookupCode: "MATCHED",
          fireWeatherAreaName: "Tasmania",
          debug: [],
        },
        facilities: {
          campfireAllowed: totalFireBanStatus === "NOT_BANNED",
          campfireRules: null,
        },
        closureStatus: "NONE",
        closureNotices: [],
        closureTags: {},
        closureImpactSummary: {
          campingImpact: "NONE",
          access2wdImpact: "NONE",
          access4wdImpact: "NONE",
        },
      };
    });

    return { points, warnings };
  }
}
