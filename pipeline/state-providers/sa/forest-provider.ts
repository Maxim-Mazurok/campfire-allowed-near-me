/**
 * South Australia State Provider
 *
 * Assembles PersistedForestPoint[] for South Australia using:
 *
 * 1. **Conservation Reserve Boundaries GeoJSON** (waterconnect.sa.gov.au)
 *    - Downloaded as ZIP containing GeoJSON with polygon boundaries
 *    - 361 reserves: NP (31), CP (272), CR (16), GR (10), RP (13), RR (5), WA (14)
 *    - Polygon centroids computed as latitude/longitude
 *    - Source: https://data.sa.gov.au/data/dataset/conservation-reserve-boundaries
 *
 * 2. **BOM fire danger districts** (national ArcGIS FeatureServer)
 *    - 10 SA fire weather districts:
 *      Adelaide Metropolitan, Yorke Peninsula, Kangaroo Island, Upper South East,
 *      Lower South East, Riverland, Murraylands, Mid North, Flinders, West Coast
 *    - Used as proxy for CFS total fire ban status (SA CFS does not provide
 *      machine-readable total fire ban data without JavaScript execution)
 *
 * Data quality: GOOD for park coverage. MODERATE for fire ban (danger proxy).
 *
 * See docs/research/03-south-australia.md for full research notes.
 */

import type {
  AustralianState,
  BanStatus,
  PersistedForestPoint,
} from "../../../shared/contracts.js";
import type { IStateProvider, StateProviderResult } from "../state-provider.js";
import { BomFireDistrictService } from "../bom-fire-districts.js";
import { slugify } from "../../../shared/text-utils.js";

const GEOJSON_ZIP_URL =
  "https://www.waterconnect.sa.gov.au/Content/Downloads/DEWNR/CONSERVATION_NpwsaReserves_geojson.zip";
const GEOJSON_FILENAME = "CONSERVATION_NpwsaReserves_GDA2020.geojson";
const CFS_SOURCE = "https://www.cfs.sa.gov.au/warnings-restrictions/restrictions/total-fire-bans-ratings/";
const DEW_SOURCE = "SA DEWNR Conservation Reserve Boundaries";

// ---------------------------------------------------------------------------
// Reserve types to include (those likely to have camping/recreation)
// ---------------------------------------------------------------------------
const INCLUDED_TYPES = new Set(["NP", "CP", "CR", "GR", "RP", "RR"]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SaReserve {
  name: string;
  restype: string;
  latitude: number;
  longitude: number;
}

type Ring = [number, number][];
type Polygon = Ring[];
type MultiPolygon = Polygon[];

const computeCentroid = (geometry: {
  type: string;
  coordinates: unknown;
}): [number, number] | null => {
  let allPoints: [number, number][] = [];

  if (geometry.type === "Polygon") {
    const coords = geometry.coordinates as Polygon;
    allPoints = (coords[0] ?? []) as [number, number][];
  } else if (geometry.type === "MultiPolygon") {
    const coords = geometry.coordinates as MultiPolygon;
    // Use the largest polygon ring (first ring of first polygon)
    let largest = 0;
    let largestRing: Ring = [];
    for (const poly of coords) {
      const ring = poly[0] ?? [];
      if (ring.length > largest) {
        largest = ring.length;
        largestRing = ring as Ring;
      }
    }
    allPoints = largestRing as [number, number][];
  }

  if (!allPoints.length) return null;

  const sumLng = allPoints.reduce((sum, p) => sum + p[0], 0);
  const sumLat = allPoints.reduce((sum, p) => sum + p[1], 0);
  return [sumLat / allPoints.length, sumLng / allPoints.length];
};

const fireDangerToBanStatus = (
  fireDanger: string | null
): { status: BanStatus; text: string } => {
  switch ((fireDanger ?? "").toLowerCase()) {
    case "catastrophic":
      return {
        status: "BANNED",
        text: "Fire danger: Catastrophic — campfires banned",
      };
    case "extreme":
      return {
        status: "BANNED",
        text: "Fire danger: Extreme — campfires likely banned; check CFS before visiting",
      };
    case "severe":
    case "very high":
      return {
        status: "UNKNOWN",
        text: `Fire danger: ${fireDanger} — check CFS SA for current fire ban status`,
      };
    case "high":
    case "moderate":
    case "no rating":
      return {
        status: "NOT_BANNED",
        text: `Fire danger: ${fireDanger || "No Rating"} — no fire ban in effect`,
      };
    default:
      return {
        status: "UNKNOWN",
        text: "Fire ban status unknown — check cfs.sa.gov.au",
      };
  }
};

// ---------------------------------------------------------------------------
// Fetch and parse the SA reserves GeoJSON from ZIP
// ---------------------------------------------------------------------------

const fetchSaReserves = async (fetchImpl: typeof fetch): Promise<SaReserve[]> => {
  const response = await fetchImpl(GEOJSON_ZIP_URL, {
    headers: {
      "User-Agent": "campfire-allowed-near-me/1.0",
      Accept: "application/zip, */*",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching SA reserves ZIP`);

  const buffer = await response.arrayBuffer();
  const bytes = Buffer.from(buffer);

  // Use AdmZip for ZIP extraction
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(bytes);

  const entry = zip.getEntry(GEOJSON_FILENAME);
  if (!entry) {
    throw new Error(`${GEOJSON_FILENAME} not found in SA reserves ZIP`);
  }

  const geojsonText = entry.getData().toString("utf8");
  const geojson = JSON.parse(geojsonText) as {
    type: string;
    features: Array<{
      type: string;
      properties: Record<string, string | number | null>;
      geometry: { type: string; coordinates: unknown };
    }>;
  };

  const reserves: SaReserve[] = [];
  for (const feature of geojson.features) {
    const props = feature.properties;
    const restype = typeof props["RESTYPE"] === "string" ? props["RESTYPE"] : "";
    if (!INCLUDED_TYPES.has(restype)) continue;

    const name =
      typeof props["RESNAMETYP"] === "string"
        ? props["RESNAMETYP"].trim()
        : typeof props["RESNAME"] === "string"
          ? props["RESNAME"].trim()
          : "Unknown Reserve";

    if (!name || name === "Unknown Reserve") continue;

    const centroid = computeCentroid(feature.geometry);
    if (!centroid) continue;

    reserves.push({
      name,
      restype,
      latitude: centroid[0],
      longitude: centroid[1],
    });
  }

  return reserves;
};

// ---------------------------------------------------------------------------
// Main provider
// ---------------------------------------------------------------------------

export class SouthAustraliaStateProvider implements IStateProvider {
  readonly stateCode: AustralianState = "SA";
  readonly stateName = "South Australia";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    const warnings: string[] = [
      "South Australia CFS total fire ban data requires JavaScript execution and is not " +
        "accessible via a public API. Ban status is inferred from BOM fire danger ratings — " +
        "always check https://www.cfs.sa.gov.au for current fire restrictions.",
    ];

    // 1. Fetch BOM fire districts for SA
    const bomService = new BomFireDistrictService({ fetchImpl: this.fetchImpl });
    let bomSnapshot;
    try {
      bomSnapshot = await bomService.fetchSnapshot();
      warnings.push(...bomSnapshot.warnings);
    } catch (err) {
      warnings.push(
        `Could not fetch BOM fire districts for SA: ${err instanceof Error ? err.message : String(err)}`
      );
      bomSnapshot = null;
    }

    // 2. Fetch SA conservation reserves
    let reserves: SaReserve[] = [];
    try {
      reserves = await fetchSaReserves(this.fetchImpl);
      if (!reserves.length) {
        warnings.push("No SA reserves retrieved from waterconnect.sa.gov.au.");
        return { points: [], warnings };
      }
    } catch (err) {
      warnings.push(
        `Could not fetch SA reserves from waterconnect.sa.gov.au: ${err instanceof Error ? err.message : String(err)}`
      );
      return { points: [], warnings };
    }

    // 3. Build PersistedForestPoint[] for each reserve
    const points: PersistedForestPoint[] = reserves.map((reserve) => {
      const id = `sa-${slugify(reserve.name)}`;

      // Look up BOM fire district for this reserve
      let districtName: string | null = null;
      let fireDanger: string | null = null;

      if (bomSnapshot) {
        const district = bomService.lookupDistrict(
          bomSnapshot,
          reserve.latitude,
          reserve.longitude,
          "SA"
        );
        if (district) {
          districtName = district.distName;
          fireDanger = district.fireDanger;
        }
      }

      const { status: banStatus, text: banStatusText } = fireDangerToBanStatus(fireDanger);

      return {
        id,
        state: "SA",
        source: DEW_SOURCE,
        areas: [
          {
            areaName: districtName ?? "South Australia",
            areaUrl: CFS_SOURCE,
            banStatus,
            banStatusText,
            banScope: "ALL",
          },
        ],
        forestName: reserve.name,
        forestUrl: null,
        totalFireBanStatus: banStatus,
        totalFireBanStatusText: banStatusText,
        latitude: reserve.latitude,
        longitude: reserve.longitude,
        geocodeName: reserve.name,
        geocodeDiagnostics: null,
        totalFireBanDiagnostics: {
          reason: districtName
            ? `BOM SA district "${districtName}" matched; fire danger: ${fireDanger ?? "unknown"}`
            : "No BOM district matched for coordinates",
          lookupCode: districtName ? "MATCHED" : "NO_AREA_MATCH",
          fireWeatherAreaName: districtName,
          debug: [],
        },
        facilities: {
          campfireAllowed: banStatus === "NOT_BANNED" ? true : banStatus === "BANNED" ? false : null,
          toilets: null,
          water: null,
          tables: null,
          bbqGas: null,
          bbqWood: null,
          bbqPit: null,
          bbqElec: null,
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
