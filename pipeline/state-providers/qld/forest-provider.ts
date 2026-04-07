/**
 * Queensland State Provider
 *
 * Assembles PersistedForestPoint[] for Queensland using:
 *
 * 1. **parks.qld.gov.au campgrounds A-Z scraper** (~535 campgrounds)
 *    - Per-campground exact coordinates from geo.position meta tag
 *    - Per-campground campfire status from parks.campfires meta tag
 *    - Per-campground facilities from parks.facilities meta tag
 *    - Covers National Parks (NP), Conservation Parks (CP), State Forests (SF),
 *      Recreation Reserves (RR), and other protected area types
 *
 * 2. **BOM fire danger districts** (national ArcGIS FeatureServer)
 *    - 15 QLD fire weather districts with current fire danger rating
 *    - Used as proxy for QFES total fire ban status (QFES not publicly accessible)
 *    - Extreme/Catastrophic → BANNED; Very High/Severe → UNKNOWN; else → NOT_BANNED
 *
 * Data quality: EXCELLENT for campfire facility info per campground.
 * Data quality: MODERATE for fire ban status (danger rating proxy, not actual TFB).
 *
 * See docs/research/02-queensland.md for full research notes.
 */

import type {
  AustralianState,
  PersistedForestPoint,
} from "../../../shared/contracts.js";
import type { IStateProvider, StateProviderResult } from "../state-provider.js";
import {
  fetchAllQldCampgrounds,
  type QldCampground,
} from "./campgrounds-scraper.js";
import {
  buildQldFireSnapshot,
  QFES_SOURCE,
  type QldFireDangerDistrict,
} from "./fire-ban-provider.js";
import { BomFireDistrictService } from "../bom-fire-districts.js";
import { slugify } from "../../../shared/text-utils.js";

const DATAVIC_SOURCE =
  "Queensland Parks and Wildlife Service — parks.qld.gov.au";

// ---------------------------------------------------------------------------
// Map campground data to PersistedForestPoint
// ---------------------------------------------------------------------------

const buildForestPoint = (
  campground: QldCampground,
  banStatus: QldFireDangerDistrict | undefined
): PersistedForestPoint => {
  const id = `qld-${slugify(campground.parkSlug)}-${slugify(campground.campgroundSlug)}`;

  const fireStatus = banStatus?.banStatus ?? "UNKNOWN";
  const fireStatusText =
    banStatus?.banStatusText ??
    "Fire ban status unknown — check fire.qld.gov.au";

  // Determine campfire allowed:
  // - If campground explicitly says yes/no → use that
  // - If fire ban is active → banned regardless
  // - Otherwise use the explicit campground campfire setting
  let campfireAllowed: boolean | null;
  if (fireStatus === "BANNED") {
    campfireAllowed = false;
  } else if (campground.campfiresPermitted === true) {
    campfireAllowed = fireStatus === "UNKNOWN" ? null : true;
  } else if (campground.campfiresPermitted === false) {
    campfireAllowed = false;
  } else {
    campfireAllowed = null; // not specified
  }

  return {
    id,
    state: "QLD",
    source: DATAVIC_SOURCE,
    areas: [
      {
        areaName: banStatus?.distName ?? "Queensland",
        areaUrl: QFES_SOURCE,
        banStatus: fireStatus,
        banStatusText: fireStatusText,
        banScope: "ALL",
      },
    ],
    forestName: campground.name,
    forestUrl: campground.url,
    totalFireBanStatus: fireStatus,
    totalFireBanStatusText: fireStatusText,
    latitude: campground.latitude,
    longitude: campground.longitude,
    geocodeName: campground.name,
    geocodeDiagnostics: null,
    totalFireBanDiagnostics: {
      reason: banStatus
        ? `BOM fire danger district "${banStatus.distName}" matched via point-in-polygon; ` +
          `fire danger: ${banStatus.fireDanger ?? "unknown"}; ` +
          (banStatus.warning ?? "ban status inferred from fire danger rating")
        : "No BOM district matched",
      lookupCode: banStatus ? "MATCHED" : "NO_AREA_MATCH",
      fireWeatherAreaName: banStatus?.distName ?? null,
      debug: [],
    },
    facilities: {
      campfireAllowed,
      toilets: campground.toilets || null,
      water: campground.water || null,
      tables: campground.tables || null,
      bbqGas: campground.bbqGas || null,
      bbqWood: campground.facilitiesIncludeCampfire || null,
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

export class QueenslandStateProvider implements IStateProvider {
  readonly stateCode: AustralianState = "QLD";
  readonly stateName = "Queensland";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async fetchPoints(): Promise<StateProviderResult> {
    const warnings: string[] = [];

    // 1. Fetch BOM fire districts for QLD
    const bomService = new BomFireDistrictService({ fetchImpl: this.fetchImpl });
    let bomSnapshot: Awaited<ReturnType<BomFireDistrictService["fetchSnapshot"]>> | null = null;
    let qldFireSnapshot: ReturnType<typeof buildQldFireSnapshot> | null = null;
    try {
      bomSnapshot = await bomService.fetchSnapshot();
      warnings.push(...bomSnapshot.warnings);
      qldFireSnapshot = buildQldFireSnapshot(bomSnapshot);
      warnings.push(...qldFireSnapshot.warnings);
    } catch (err) {
      warnings.push(
        `Could not fetch BOM fire districts for QLD: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 2. Fetch all QLD campgrounds from parks.qld.gov.au
    let campgrounds: QldCampground[] = [];
    try {
      const { campgrounds: fetched, warnings: scrapeWarnings } =
        await fetchAllQldCampgrounds(this.fetchImpl, {
          concurrency: 10,
          onProgress: (completed, total) => {
            if (completed % 50 === 0) {
              process.stdout?.write?.(`  QLD: fetched ${completed}/${total} campgrounds\r`);
            }
          },
        });
      campgrounds = fetched;
      warnings.push(...scrapeWarnings);
    } catch (err) {
      warnings.push(
        `Could not fetch QLD campgrounds from parks.qld.gov.au: ${err instanceof Error ? err.message : String(err)}`
      );
      return { points: [], warnings };
    }

    if (!campgrounds.length) {
      warnings.push("No QLD campgrounds retrieved from parks.qld.gov.au.");
      return { points: [], warnings };
    }

    // 3. Build PersistedForestPoint[] for each campground
    const points: PersistedForestPoint[] = campgrounds.map((campground) => {
      return buildForestPoint(campground, undefined);
    });

    // 4. Do proper point-in-polygon BOM district lookup for each campground
    if (bomSnapshot && qldFireSnapshot) {
      for (let i = 0; i < points.length; i++) {
        const campground = campgrounds[i]!;
        if (campground.latitude === null || campground.longitude === null) continue;

        const bomDistrict = bomService.lookupDistrict(
          bomSnapshot,
          campground.latitude,
          campground.longitude,
          "QLD"
        );

        if (bomDistrict) {
          const fireDistrict = qldFireSnapshot.districts.find(
            (d) => d.distName === bomDistrict.distName
          );
          if (fireDistrict) {
            // Rebuild the point with the correct district
            points[i] = buildForestPoint(campground, fireDistrict);
          }
        }
      }
    }

    return { points, warnings };
  }
}
