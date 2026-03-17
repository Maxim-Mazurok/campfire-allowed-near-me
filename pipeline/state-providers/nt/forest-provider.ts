/**
 * Northern Territory State Provider
 *
 * Assembles PersistedForestPoint[] for the Northern Territory using:
 *
 * 1. **OSM Overpass API** (campground locations)
 *    - Bounding-box query for tourism=camp_site in the NT administrative area
 *    - Returns ~300 campgrounds with exact coordinates
 *    - Named campgrounds only (unnamed excluded)
 *
 * 2. **BOM fire danger districts** (national ArcGIS FeatureServer)
 *    - 80 NT fire weather districts
 *    - Used as proxy for fire ban status (SecureNT fire ban data not accessible
 *      without JavaScript execution)
 *    - Always check https://securent.nt.gov.au for authoritative fire ban status
 *
 * Data quality: GOOD for campground coverage (OSM NT data is relatively complete
 * for managed campgrounds in national parks). MODERATE for fire ban (BOM proxy).
 *
 * Note: The NT uniquely allows small cooking fires even during declared fire bans
 * (provided fire is attended, 4m clearance, extinguished immediately after cooking).
 * This nuance is noted in warning messages.
 *
 * See docs/research/06-northern-territory.md for full research notes.
 */

import type {
  AustralianState,
  BanStatus,
  PersistedForestPoint,
} from "../../../shared/contracts.js";
import type { IStateProvider, StateProviderResult } from "../state-provider.js";
import { BomFireDistrictService } from "../bom-fire-districts.js";
import { slugify } from "../../../shared/text-utils.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const SECURENT_SOURCE = "https://securent.nt.gov.au/";

// NT administrative area name for Overpass
const NT_AREA_QUERY =
  'area["name"="Northern Territory"]["boundary"="administrative"]["admin_level"="4"]->.ntArea;';

// ---------------------------------------------------------------------------
// OSM campground fetch
// ---------------------------------------------------------------------------

interface OsmElement {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface NtCampground {
  name: string;
  latitude: number;
  longitude: number;
  osmId: number;
}

const buildOverpassQuery = (): string =>
  `[out:json][timeout:35];${NT_AREA_QUERY}(node["tourism"="camp_site"](area.ntArea);way["tourism"="camp_site"](area.ntArea););out center;`;

const fetchNtCampgrounds = async (
  fetchImpl: typeof fetch
): Promise<{ campgrounds: NtCampground[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const campgrounds: NtCampground[] = [];

  try {
    const query = buildOverpassQuery();
    const resp = await fetchImpl(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "campfire-allowed-near-me/1.0",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!resp.ok) {
      if (resp.status === 429) {
        warnings.push(
          "Overpass API rate limited (429). NT campground data unavailable — try again shortly."
        );
        return { campgrounds: [], warnings };
      }
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as { elements: OsmElement[] };
    for (const el of data.elements ?? []) {
      const name = el.tags?.name?.trim();
      if (!name) continue;
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat === undefined || lng === undefined) continue;
      campgrounds.push({ name, latitude: lat, longitude: lng, osmId: el.id });
    }

    if (!campgrounds.length) {
      warnings.push(
        "No NT campgrounds returned from OSM Overpass — the area query may have timed out."
      );
    }
  } catch (err) {
    warnings.push(
      `Could not fetch NT campgrounds from OSM Overpass: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return { campgrounds, warnings };
};

// ---------------------------------------------------------------------------
// Fire danger → ban status
// ---------------------------------------------------------------------------

const fireDangerToBanStatus = (
  fireDanger: string | null
): { status: BanStatus; text: string } => {
  switch ((fireDanger ?? "").toLowerCase()) {
    case "catastrophic":
      return {
        status: "BANNED",
        text: "Fire danger: Catastrophic — campfires banned; check securent.nt.gov.au",
      };
    case "extreme":
      return {
        status: "BANNED",
        text:
          "Fire danger: Extreme — campfires likely banned; check securent.nt.gov.au. " +
          "Note: small cooking fires may still be permitted if attended and extinguished immediately.",
      };
    case "severe":
    case "very high":
      return {
        status: "UNKNOWN",
        text: `Fire danger: ${fireDanger} — check securent.nt.gov.au for fire ban status`,
      };
    case "high":
    case "moderate":
    case "no rating":
      return {
        status: "NOT_BANNED",
        text: `Fire danger: ${fireDanger || "No Rating"} — no fire ban indicated`,
      };
    default:
      return {
        status: "UNKNOWN",
        text: "Fire ban status unknown — check securent.nt.gov.au",
      };
  }
};

// ---------------------------------------------------------------------------
// Main provider
// ---------------------------------------------------------------------------

export class NorthernTerritoryStateProvider implements IStateProvider {
  readonly stateCode: AustralianState = "NT";
  readonly stateName = "Northern Territory";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    const warnings: string[] = [
      "Northern Territory SecureNT fire ban data is not accessible via a public API. " +
        "Ban status is inferred from BOM fire danger ratings — always check " +
        "https://securent.nt.gov.au for current fire ban declarations. " +
        "Note: NT allows small cooking fires even during fire bans (attended, 4m clearance, extinguished after cooking).",
    ];

    // 1. Fetch BOM fire districts for NT
    const bomService = new BomFireDistrictService({ fetchImpl: this.fetchImpl });
    let bomSnapshot;
    try {
      bomSnapshot = await bomService.fetchSnapshot();
      warnings.push(...bomSnapshot.warnings);
    } catch (err) {
      warnings.push(
        `Could not fetch BOM fire districts for NT: ${err instanceof Error ? err.message : String(err)}`
      );
      bomSnapshot = null;
    }

    // 2. Fetch NT campgrounds from OSM
    const { campgrounds, warnings: osmWarnings } = await fetchNtCampgrounds(
      this.fetchImpl
    );
    warnings.push(...osmWarnings);

    if (!campgrounds.length) {
      warnings.push("No NT campgrounds retrieved from OSM — returning empty result.");
      return { points: [], warnings };
    }

    // 3. Build PersistedForestPoint[] for each campground
    const points: PersistedForestPoint[] = campgrounds.map((cg) => {
      const id = `nt-${slugify(cg.name)}`;

      // Look up BOM fire district
      let districtName: string | null = null;
      let fireDanger: string | null = null;
      if (bomSnapshot) {
        const district = bomService.lookupDistrict(
          bomSnapshot,
          cg.latitude,
          cg.longitude,
          "NT"
        );
        if (district) {
          districtName = district.distName;
          fireDanger = district.fireDanger;
        }
      }

      const { status: banStatus, text: banStatusText } =
        fireDangerToBanStatus(fireDanger);

      return {
        id,
        state: "NT",
        source: "OSM / Overpass API",
        areas: [
          {
            areaName: districtName ?? "Northern Territory",
            areaUrl: SECURENT_SOURCE,
            banStatus,
            banStatusText,
            banScope: "ALL",
          },
        ],
        forestName: cg.name,
        forestUrl: null,
        totalFireBanStatus: banStatus,
        totalFireBanStatusText: banStatusText,
        latitude: cg.latitude,
        longitude: cg.longitude,
        geocodeName: cg.name,
        geocodeDiagnostics: null,
        totalFireBanDiagnostics: {
          reason: districtName
            ? `BOM NT district "${districtName}" matched; fire danger: ${fireDanger ?? "unknown"}`
            : "No BOM district matched for coordinates",
          lookupCode: districtName ? "MATCHED" : "NO_AREA_MATCH",
          fireWeatherAreaName: districtName,
          debug: [],
        },
        facilities: {
          campfireAllowed:
            banStatus === "NOT_BANNED"
              ? true
              : banStatus === "BANNED"
                ? false
                : null,
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
