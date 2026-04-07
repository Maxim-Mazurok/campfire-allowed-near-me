/**
 * Western Australia State Provider
 *
 * Assembles PersistedForestPoint[] for Western Australia using:
 *
 * 1. **RATIS Campfire Status Page** (ratisweb.dpaw.wa.gov.au)
 *    - Scraped via ASP.NET WebForms pagination (7 pages × 20 rows ≈ 129 campgrounds)
 *    - Provides per-campground campfire status:
 *        "Campfires permitted" | "No campfires" | "Campfire ban"
 *    - Source: https://ratisweb.dpaw.wa.gov.au/campgrounds/public/campfire-status.aspx
 *      (embedded iframe at https://exploreparks.dbca.wa.gov.au/current-campfire-conditions)
 *
 * 2. **OSM Overpass API** (coordinates)
 *    - Bounding-box query for tourism=camp_site in WA
 *    - ~780 named campgrounds with exact coordinates
 *    - Fuzzy-matched to RATIS campground names
 *
 * 3. **DBCA Legislated Lands ArcGIS** (coordinate fallback)
 *    - public-services.slip.wa.gov.au SLIP_Public_Services MapServer/15
 *    - Park polygon centroid used when OSM match not found
 *
 * 4. **BOM fire danger districts** (state-wide fire ban proxy)
 *    - 47 WA fire weather districts from national ArcGIS FeatureServer
 *    - DFES total fire ban service requires auth → BOM danger used as proxy
 *    - Always check https://www.dfes.wa.gov.au for authoritative TFB status
 *
 * Data quality: GOOD for campfire status (per-campground from RATIS).
 *               MODERATE for fire ban (BOM danger proxy, not authoritative TFB).
 *
 * See docs/research/04-western-australia.md for full research notes.
 */

import type {
  AustralianState,
  BanStatus,
  PersistedForestPoint,
} from "../../../shared/contracts.js";
import type { IStateProvider, StateProviderResult } from "../state-provider.js";
import { BomFireDistrictService } from "../bom-fire-districts.js";
import { slugify } from "../../../shared/text-utils.js";
import {
  fetchWaCampgrounds,
  type WaCampground,
  type WaCampfireStatus,
} from "./ratis-scraper.js";
import {
  buildOsmIndex,
  fetchDbcaParkCentroid,
  fetchOsmCampgrounds,
  matchCampgroundToOsm,
} from "./osm-geocoder.js";

const DFES_SOURCE = "https://www.dfes.wa.gov.au/hazard-information/bushfire/total-fire-ban";
const RATIS_SOURCE = "ratisweb.dpaw.wa.gov.au";

// ---------------------------------------------------------------------------
// Campfire status → BanStatus mapping
// ---------------------------------------------------------------------------

const campfireStatusToBanStatus = (
  waCampfireStatus: WaCampfireStatus
): { status: BanStatus; text: string } => {
  switch (waCampfireStatus) {
    case "PERMITTED":
      return { status: "NOT_BANNED", text: "Campfires permitted (RATIS status)" };
    case "BANNED":
      return { status: "BANNED", text: "Campfire ban in effect (RATIS status)" };
    case "NO_CAMPFIRES":
      return {
        status: "BANNED",
        text: "No campfires permitted at this site (site rule, not a fire ban)",
      };
    case "UNKNOWN":
    default:
      return { status: "UNKNOWN", text: "Campfire status unknown — check DBCA Explore Parks WA" };
  }
};

// ---------------------------------------------------------------------------
// BOM fire danger → ban proxy (for campgrounds not covered by RATIS)
// ---------------------------------------------------------------------------

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
        text: "Fire danger: Extreme — campfires likely banned; check DFES WA",
      };
    case "severe":
    case "very high":
      return {
        status: "UNKNOWN",
        text: `Fire danger: ${fireDanger} — check DFES WA for total fire ban status`,
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
        text: "Fire ban status unknown — check dfes.wa.gov.au",
      };
  }
};

// ---------------------------------------------------------------------------
// Build a PersistedForestPoint from a resolved campground
// ---------------------------------------------------------------------------

interface ResolvedCampground {
  campground: WaCampground;
  latitude: number;
  longitude: number;
  coordSource: "osm" | "dbca" | "park-centroid";
}

const buildPoint = (
  resolved: ResolvedCampground,
  bomService: BomFireDistrictService,
  bomSnapshot: Awaited<ReturnType<BomFireDistrictService["fetchSnapshot"]>> | null
): PersistedForestPoint => {
  const { campground, latitude, longitude, coordSource } = resolved;

  // Derive fire ban status from RATIS per-campground data
  const { status: banStatus, text: banStatusText } = campfireStatusToBanStatus(
    campground.campfireStatus
  );

  // Also look up BOM district (for fire danger context)
  let districtName: string | null = null;
  let fireDanger: string | null = null;
  if (bomSnapshot) {
    const district = bomService.lookupDistrict(bomSnapshot, latitude, longitude, "WA");
    if (district) {
      districtName = district.distName;
      fireDanger = district.fireDanger;
    }
  }

  // If RATIS says UNKNOWN, fall back to BOM
  const { status: finalBanStatus, text: finalBanStatusText } =
    campground.campfireStatus === "UNKNOWN"
      ? fireDangerToBanStatus(fireDanger)
      : { status: banStatus, text: banStatusText };

  const id = `wa-${slugify(campground.name)}`;

  return {
    id,
    state: "WA",
    source: RATIS_SOURCE,
    areas: [
      {
        areaName: districtName ?? "Western Australia",
        areaUrl: DFES_SOURCE,
        banStatus: finalBanStatus,
        banStatusText: finalBanStatusText,
        banScope: "ALL",
      },
    ],
    forestName: campground.name,
    forestUrl: null,
    totalFireBanStatus: finalBanStatus,
    totalFireBanStatusText: finalBanStatusText,
    latitude,
    longitude,
    geocodeName: campground.name,
    geocodeDiagnostics: null,
    totalFireBanDiagnostics: {
      reason:
        campground.campfireStatus !== "UNKNOWN"
          ? `RATIS per-campground status: "${campground.rawStatus}"`
          : districtName
            ? `BOM WA district "${districtName}" matched; fire danger: ${fireDanger ?? "unknown"}`
            : "No BOM district matched for coordinates",
      lookupCode:
        campground.campfireStatus !== "UNKNOWN"
          ? "MATCHED"
          : districtName
            ? "MATCHED"
            : "NO_AREA_MATCH",
      fireWeatherAreaName: districtName,
      debug: coordSource ? [`coords from ${coordSource}`] : [],
    },
    facilities: {
      campfireAllowed:
        finalBanStatus === "NOT_BANNED"
          ? true
          : finalBanStatus === "BANNED"
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
};

// ---------------------------------------------------------------------------
// Main provider
// ---------------------------------------------------------------------------

export class WesternAustraliaStateProvider implements IStateProvider {
  readonly stateCode: AustralianState = "WA";
  readonly stateName = "Western Australia";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    const warnings: string[] = [
      "Western Australia DFES Total Fire Ban data requires authentication. " +
        "Ban status is sourced from RATIS per-campground status (DBCA); " +
        "always check https://www.dfes.wa.gov.au for current fire ban declarations.",
    ];

    // 1. Fetch BOM fire districts for WA
    const bomService = new BomFireDistrictService({ fetchImpl: this.fetchImpl });
    let bomSnapshot;
    try {
      bomSnapshot = await bomService.fetchSnapshot();
      warnings.push(...bomSnapshot.warnings);
    } catch (err) {
      warnings.push(
        `Could not fetch BOM fire districts for WA: ${err instanceof Error ? err.message : String(err)}`
      );
      bomSnapshot = null;
    }

    // 2. Fetch RATIS campground campfire status
    const { campgrounds, warnings: ratisWarnings } = await fetchWaCampgrounds(
      this.fetchImpl
    );
    warnings.push(...ratisWarnings);

    if (!campgrounds.length) {
      warnings.push("No WA campgrounds retrieved from RATIS.");
      return { points: [], warnings };
    }

    // 3. Fetch OSM campground coordinates
    const { campgrounds: osmCampgrounds, warnings: osmWarnings } =
      await fetchOsmCampgrounds(this.fetchImpl);
    warnings.push(...osmWarnings);
    const osmIndex = buildOsmIndex(osmCampgrounds);

    // 4. Resolve coordinates for each campground
    const resolved: ResolvedCampground[] = [];
    const unmatched: WaCampground[] = [];

    for (const cg of campgrounds) {
      const osmMatch = matchCampgroundToOsm(cg.name, osmIndex);
      if (osmMatch) {
        resolved.push({
          campground: cg,
          latitude: osmMatch.latitude,
          longitude: osmMatch.longitude,
          coordSource: "osm",
        });
      } else {
        unmatched.push(cg);
      }
    }

    // 5. For unmatched campgrounds, try DBCA ArcGIS fallback
    const DBCA_CONCURRENCY = 5;
    for (let i = 0; i < unmatched.length; i += DBCA_CONCURRENCY) {
      const batch = unmatched.slice(i, i + DBCA_CONCURRENCY);
      await Promise.all(
        batch.map(async (cg) => {
          const coords = await fetchDbcaParkCentroid(cg.park, this.fetchImpl);
          if (coords) {
            resolved.push({
              campground: cg,
              latitude: coords.lat,
              longitude: coords.lng,
              coordSource: "dbca",
            });
          } else {
            warnings.push(
              `Could not resolve coordinates for WA campground "${cg.name}" (park: "${cg.park}") — excluded.`
            );
          }
        })
      );
    }

    if (resolved.length < campgrounds.length) {
      const missing = campgrounds.length - resolved.length;
      warnings.push(
        `${missing} WA campground(s) excluded due to missing coordinates.`
      );
    }

    // 6. Build PersistedForestPoint[]
    const points: PersistedForestPoint[] = resolved.map((r) =>
      buildPoint(r, bomService, bomSnapshot)
    );

    return { points, warnings };
  }
}
