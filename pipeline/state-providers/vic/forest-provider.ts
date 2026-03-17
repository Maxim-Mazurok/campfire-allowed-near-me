/**
 * Victoria Forest/Campsite Provider
 *
 * Uses the DataVic (DEECA) Campsites and Picnic Grounds ArcGIS FeatureServer:
 *   services6.arcgis.com/GB33F62SbDxJjwEL/arcgis/rest/services/Campsites_and_Picnic_Grounds/FeatureServer/2
 *
 * 279 camping sites across Victoria's state forests with LATITUDE/LONGITUDE
 * and detailed attributes including access type, site class, and closure status.
 *
 * Fire ban status comes from the CFA RSS feed, matched by district name.
 * District boundaries are looked up using the national BOM fire district service.
 *
 * For campfire rules in VIC state forests: campfires are generally permitted
 * outside declared Total Fire Ban periods. During TFB, all outdoor fires
 * (including campfires) are prohibited. The CAMPING_C (description) field
 * sometimes mentions fire restrictions but is inconsistently populated.
 */

import type {
  AustralianState,
  BanStatus,
  PersistedForestPoint,
} from "../../../shared/contracts.js";
import type { IStateProvider, StateProviderResult } from "../state-provider.js";
import { fetchCfaFireBans, type CfaFireBanDistrict } from "./fire-ban-provider.js";
import { BomFireDistrictService } from "../bom-fire-districts.js";
import { slugify } from "../../../shared/text-utils.js";

// ---------------------------------------------------------------------------
// ArcGIS endpoint
// ---------------------------------------------------------------------------

const DATAVIC_CAMPSITES_URL =
  "https://services6.arcgis.com/GB33F62SbDxJjwEL/arcgis/rest/services/Campsites_and_Picnic_Grounds/FeatureServer/2/query";

const CFA_FIRE_BAN_SOURCE_URL =
  "https://www.cfa.vic.gov.au/warnings-restrictions/total-fire-bans-and-ratings";

const DATAVIC_SOURCE = "DataVic — DEECA State Forest Campsites & Picnic Grounds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CampsiteFeature {
  name: string;
  latitude: number;
  longitude: number;
  siteClass: string | null;
  disAccess: string | null;
  accessDsc: string | null;
  campingDesc: string | null;
  closureStatus: string | null;
  closureDesc: string | null;
  maintainedBy: string | null;
  bbqWood: boolean;
  bbqPit: boolean;
  bbqGas: boolean;
  bbqElec: boolean;
}

// ---------------------------------------------------------------------------
// Fetch campsite data
// ---------------------------------------------------------------------------

const fetchVicCampsites = async (fetchImpl: typeof fetch): Promise<CampsiteFeature[]> => {
  const params = new URLSearchParams({
    where: "CAMPING='Y' AND PUBLISHED='Y'",
    outFields: [
      "NAME", "LATITUDE", "LONGITUDE", "SITE_CLASS", "DIS_ACCESS",
      "ACCESS_DSC", "CAMPING_C", "CLOS_STAT", "CLOS_DESC",
      "MAINTAINED_BY", "BBQ_WOOD", "BBQ_PIT", "BBQ_GAS", "BBQ_ELEC",
    ].join(","),
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "2000",
  });

  const url = `${DATAVIC_CAMPSITES_URL}?${params}`;
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "campfire-allowed-near-me/1.0",
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching DataVic campsites`);

  const json = (await response.json()) as {
    features?: Array<{ attributes: Record<string, unknown> }>;
    error?: { message: string };
  };
  if (json.error) throw new Error(json.error.message);

  const sites: CampsiteFeature[] = [];
  for (const f of json.features ?? []) {
    const a = f.attributes;
    const name = typeof a["NAME"] === "string" ? a["NAME"].trim() : "";
    if (!name) continue;
    const lat = typeof a["LATITUDE"] === "number" ? a["LATITUDE"] : null;
    const lng = typeof a["LONGITUDE"] === "number" ? a["LONGITUDE"] : null;
    if (lat === null || lng === null) continue;

    sites.push({
      name,
      latitude: lat,
      longitude: lng,
      siteClass: typeof a["SITE_CLASS"] === "string" ? a["SITE_CLASS"] : null,
      disAccess: typeof a["DIS_ACCESS"] === "string" ? a["DIS_ACCESS"] : null,
      accessDsc: typeof a["ACCESS_DSC"] === "string" ? a["ACCESS_DSC"] : null,
      campingDesc: typeof a["CAMPING_C"] === "string" ? a["CAMPING_C"] : null,
      closureStatus: typeof a["CLOS_STAT"] === "string" ? a["CLOS_STAT"] : null,
      closureDesc: typeof a["CLOS_DESC"] === "string" ? a["CLOS_DESC"] : null,
      maintainedBy: typeof a["MAINTAINED_BY"] === "string" ? a["MAINTAINED_BY"] : null,
      bbqWood: a["BBQ_WOOD"] === "Y" || a["BBQ_WOOD"] === "1",
      bbqPit: a["BBQ_PIT"] === "Y" || a["BBQ_PIT"] === "1",
      bbqGas: a["BBQ_GAS"] === "Y" || a["BBQ_GAS"] === "1",
      bbqElec: a["BBQ_ELEC"] === "Y" || a["BBQ_ELEC"] === "1",
    });
  }
  return sites;
};

// ---------------------------------------------------------------------------
// CFA district name → BanStatus lookup
// ---------------------------------------------------------------------------

const lookupCfaBanStatus = (
  districts: CfaFireBanDistrict[],
  districtName: string | null
): { status: BanStatus; statusText: string; districtName: string } => {
  if (!districtName) {
    return {
      status: "UNKNOWN",
      statusText: "Fire district could not be determined",
      districtName: "Unknown",
    };
  }

  const district = districts.find(
    (d) => d.name.toLowerCase() === districtName.toLowerCase()
  );

  if (!district) {
    return {
      status: "UNKNOWN",
      statusText: `CFA district "${districtName}" not found in fire ban data`,
      districtName,
    };
  }

  return {
    status: district.banStatus,
    statusText: district.banStatusText,
    districtName: district.name,
  };
};

// ---------------------------------------------------------------------------
// Main provider
// ---------------------------------------------------------------------------

export class VictoriaStateProvider implements IStateProvider {
  readonly stateCode: AustralianState = "VIC";
  readonly stateName = "Victoria";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    const warnings: string[] = [];

    // 1. Fetch campsites from DataVic
    let campsites: CampsiteFeature[] = [];
    try {
      campsites = await fetchVicCampsites(this.fetchImpl);
      if (!campsites.length) {
        warnings.push("DataVic campsites layer returned no features.");
      }
    } catch (err) {
      warnings.push(
        `Could not fetch Victoria campsites from DataVic: ${err instanceof Error ? err.message : String(err)}`
      );
      return { points: [], warnings };
    }

    // 2. Fetch CFA fire ban status
    const cfaSnapshot = await fetchCfaFireBans(this.fetchImpl);
    warnings.push(...cfaSnapshot.warnings);

    // 3. Fetch BOM fire district boundaries for point-in-polygon district lookup
    const bomService = new BomFireDistrictService({ fetchImpl: this.fetchImpl });
    let bomSnapshot;
    try {
      bomSnapshot = await bomService.fetchSnapshot();
      warnings.push(...bomSnapshot.warnings);
    } catch (err) {
      warnings.push(
        `Could not fetch BOM fire districts: ${err instanceof Error ? err.message : String(err)}`
      );
      bomSnapshot = null;
    }

    // 4. Build PersistedForestPoint[] for each campsite
    const points: PersistedForestPoint[] = campsites.map((site) => {
      // Look up which CFA district this campsite is in via BOM geometry
      let cfaDistrictName: string | null = null;
      if (bomSnapshot && site.latitude !== null && site.longitude !== null) {
        const district = bomService.lookupDistrict(
          bomSnapshot,
          site.latitude,
          site.longitude,
          "VIC"
        );
        if (district) cfaDistrictName = district.distName;
      }

      // Get fire ban status for this district
      const { status: banStatus, statusText: banStatusText, districtName } =
        lookupCfaBanStatus(cfaSnapshot.districts, cfaDistrictName);

      const siteId = `vic-${slugify(site.name)}`;

      // Determine if campfire is allowed
      // In VIC state forests, campfires are generally permitted unless TFB is active
      const campfireAllowed = banStatus === "NOT_BANNED" ? true : banStatus === "BANNED" ? false : null;

      return {
        id: siteId,
        state: "VIC",
        source: DATAVIC_SOURCE,
        areas: [
          {
            areaName: districtName,
            areaUrl: CFA_FIRE_BAN_SOURCE_URL,
            banStatus,
            banStatusText,
            banScope: "ALL",
          },
        ],
        forestName: site.name,
        forestUrl: null,
        totalFireBanStatus: banStatus,
        totalFireBanStatusText: banStatusText,
        latitude: site.latitude,
        longitude: site.longitude,
        geocodeName: site.name,
        geocodeDiagnostics: null,
        totalFireBanDiagnostics: {
          reason: cfaDistrictName
            ? `CFA district "${cfaDistrictName}" matched via BOM fire district geometry`
            : "Could not determine CFA fire district from coordinates",
          lookupCode: banStatus !== "UNKNOWN" ? "MATCHED" : "NO_AREA_MATCH",
          fireWeatherAreaName: cfaDistrictName,
          debug: [],
        },
        facilities: {
          campfireAllowed,
          toilets: null,
          water: null,
          tables: null,
          bbqGas: site.bbqGas ? true : null,
          bbqWood: site.bbqWood ? true : null,
          bbqPit: site.bbqPit ? true : null,
          bbqElec: site.bbqElec ? true : null,
        },
        closureStatus: site.closureStatus ? "NOTICE" : "NONE",
        closureNotices: site.closureStatus && site.closureDesc
          ? [
              {
                id: `vic-closure-${siteId}`,
                title: site.closureDesc,
                detailUrl: "",
                listedAt: null,
                listedAtText: null,
                untilAt: null,
                untilText: null,
                forestNameHint: site.name,
                status: "NOTICE",
                tags: [],
              },
            ]
          : [],
        closureTags: {},
        closureImpactSummary: {
          campingImpact: "NONE",
          access2wdImpact: site.disAccess === "NONE" ? "NONE" : "UNKNOWN",
          access4wdImpact: "NONE",
        },
      };
    });

    return { points, warnings };
  }
}
