/**
 * Australian Capital Territory (ACT) State Provider
 *
 * Assembles PersistedForestPoint[] for the ACT using:
 *
 * 1. **Static campground list** (manually curated)
 *    - The ACT has only ~6 designated campfire/camping locations:
 *        Namadgi National Park (multiple bush camping areas + Woods Reserve)
 *        Tidbinbilla Nature Reserve
 *        Cotter Campground
 *        Uriarra Crossing
 *    - Given the small number, hardcoded coordinates are used
 *
 * 2. **NSW RFS fire danger ratings XML** (includes ACT areaId=8)
 *    - The same NSW RFS feed used for NSW also covers the ACT
 *    - The ACT is treated as a single fire weather area
 *    - Source: https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2
 *
 * Data quality: EXCELLENT (ACT is trivially small with only a handful of campgrounds).
 *
 * ACT campfire rules:
 * - Campfires allowed only at designated locations with fire pits/hearths
 * - During Total Fire Ban (declared by ACT ESA): no open fires
 * - Bush Fire Season (1 Oct – 31 Mar): campfires only at designated locations
 * - Always check https://esa.act.gov.au for current fire ban status
 *
 * See docs/research/07-act.md for full research notes.
 */

import type {
  AustralianState,
  BanStatus,
  PersistedForestPoint,
} from "../../../shared/contracts.js";
import type { IStateProvider, StateProviderResult } from "../state-provider.js";

const ACT_ESA_SOURCE = "https://esa.act.gov.au/be-emergency-ready/total-fire-bans";
const RFS_RATINGS_URL =
  "https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2";
const ACT_AREA_ID = "8";

// ---------------------------------------------------------------------------
// Static ACT campground list
// Coordinates verified from ACT Parks website and Google Maps
// ---------------------------------------------------------------------------

const ACT_CAMPGROUNDS: Array<{
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  campfiresNormally: boolean;
}> = [
  {
    id: "act-namadgi-woods-reserve",
    name: "Woods Reserve Campground (Namadgi NP)",
    latitude: -35.5897,
    longitude: 148.7836,
    campfiresNormally: true,
  },
  {
    id: "act-namadgi-orroral-valley",
    name: "Orroral Valley Campground (Namadgi NP)",
    latitude: -35.667,
    longitude: 148.941,
    campfiresNormally: true,
  },
  {
    id: "act-namadgi-honeysuckle",
    name: "Honeysuckle Creek Camping Area (Namadgi NP)",
    latitude: -35.638,
    longitude: 148.824,
    campfiresNormally: true,
  },
  {
    id: "act-cotter-campground",
    name: "Cotter Campground",
    latitude: -35.3879,
    longitude: 148.9592,
    campfiresNormally: true,
  },
  {
    id: "act-uriarra-crossing",
    name: "Uriarra Crossing",
    latitude: -35.2831,
    longitude: 148.9696,
    campfiresNormally: true,
  },
  {
    id: "act-tidbinbilla",
    name: "Tidbinbilla Nature Reserve",
    latitude: -35.5156,
    longitude: 148.9542,
    campfiresNormally: false, // day-use only by default
  },
];

// ---------------------------------------------------------------------------
// Fetch ACT fire ban status from NSW RFS feed
// ---------------------------------------------------------------------------

interface ActFireBanStatus {
  status: BanStatus;
  statusText: string;
  ratingToday: string | null;
}

const fetchActFireBan = async (
  fetchImpl: typeof fetch
): Promise<{ ban: ActFireBanStatus; warnings: string[] }> => {
  const warnings: string[] = [];

  try {
    const resp = await fetchImpl(RFS_RATINGS_URL, {
      headers: { "User-Agent": "campfire-allowed-near-me/1.0" },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const text = await resp.text();

    // Parse the JSON-like format from the RFS XML endpoint
    // It returns JSON lines: [{"areaName":"...","areaId":"8","tobanToday":"No",...},...]
    const parsed = JSON.parse(text) as Array<{
      areaId: string;
      areaName: string;
      ratingToday: string;
      tobanToday: string;
    }>;

    const actArea = parsed.find((a) => a.areaId === ACT_AREA_ID);
    if (!actArea) {
      warnings.push(
        "ACT area (areaId=8) not found in NSW RFS fire danger ratings feed."
      );
      return { ban: { status: "UNKNOWN", statusText: "Unknown", ratingToday: null }, warnings };
    }

    const isBanned =
      actArea.tobanToday?.toLowerCase() === "yes" ||
      actArea.ratingToday?.toLowerCase() === "catastrophic";

    const status: BanStatus = isBanned
      ? "BANNED"
      : actArea.tobanToday?.toLowerCase() === "no"
        ? "NOT_BANNED"
        : "UNKNOWN";

    return {
      ban: {
        status,
        statusText: isBanned
          ? "Total Fire Ban declared for ACT"
          : "No Total Fire Ban for ACT",
        ratingToday: actArea.ratingToday ?? null,
      },
      warnings,
    };
  } catch (err) {
    warnings.push(
      `Could not fetch ACT fire ban status from NSW RFS: ${
        err instanceof Error ? err.message : String(err)
      }. Check ${ACT_ESA_SOURCE} for current status.`
    );
    return {
      ban: { status: "UNKNOWN", statusText: "Unknown — check esa.act.gov.au", ratingToday: null },
      warnings,
    };
  }
};

// ---------------------------------------------------------------------------
// Main provider
// ---------------------------------------------------------------------------

export class AustralianCapitalTerritoryStateProvider implements IStateProvider {
  readonly stateCode: AustralianState = "ACT";
  readonly stateName = "Australian Capital Territory";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    const warnings: string[] = [];

    // Fetch ACT fire ban status
    const { ban, warnings: banWarnings } = await fetchActFireBan(this.fetchImpl);
    warnings.push(...banWarnings);

    const points: PersistedForestPoint[] = ACT_CAMPGROUNDS.map((cg) => {
      // For sites that don't normally allow campfires, always BANNED
      const effectiveStatus: BanStatus =
        !cg.campfiresNormally ? "BANNED" : ban.status;
      const effectiveText = !cg.campfiresNormally
        ? "Campfires not permitted at this site"
        : ban.statusText;

      return {
        id: cg.id,
        state: "ACT",
        source: "ACT Parks and Conservation Service",
        areas: [
          {
            areaName: "Australian Capital Territory",
            areaUrl: ACT_ESA_SOURCE,
            banStatus: effectiveStatus,
            banStatusText: effectiveText,
            banScope: "ALL",
          },
        ],
        forestName: cg.name,
        forestUrl: "https://www.tccs.act.gov.au/parks-recreation/camping",
        totalFireBanStatus: effectiveStatus,
        totalFireBanStatusText: effectiveText,
        latitude: cg.latitude,
        longitude: cg.longitude,
        geocodeName: cg.name,
        geocodeDiagnostics: null,
        totalFireBanDiagnostics: {
          reason: `NSW RFS feed (areaId=${ACT_AREA_ID}); toban=${ban.status}; fire danger: ${ban.ratingToday ?? "unknown"}`,
          lookupCode: ban.status !== "UNKNOWN" ? "MATCHED" : "DATA_UNAVAILABLE",
          fireWeatherAreaName: "ACT",
          debug: [],
        },
        facilities: {
          campfireAllowed:
            effectiveStatus === "NOT_BANNED"
              ? true
              : effectiveStatus === "BANNED"
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
