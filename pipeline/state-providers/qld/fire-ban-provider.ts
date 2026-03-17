/**
 * Queensland Fire Ban / Fire Danger Provider
 *
 * Queensland QFES total fire ban data is not publicly accessible via API —
 * the QFES website (fire.qld.gov.au) uses SPA rendering and the rural fire
 * service site (ruralfire.qld.gov.au) is Incapsula-protected.
 *
 * This provider uses the national BOM (Bureau of Meteorology) fire danger
 * ratings from the Esri ArcGIS FeatureServer as a proxy for campfire safety:
 *
 *   FireDanger == "Catastrophic" → BANNED  (total fire bans almost certain)
 *   FireDanger == "Extreme"      → BANNED  (fire bans likely declared)
 *   FireDanger == "Severe"       → UNKNOWN (ban may or may not be declared)
 *   FireDanger == "Very High"    → UNKNOWN (ban unlikely but possible)
 *   FireDanger == "High"         → NOT_BANNED
 *   FireDanger == "Moderate"     → NOT_BANNED
 *   FireDanger == "No Rating"    → NOT_BANNED (outside fire danger period)
 *   null / unknown               → UNKNOWN
 *
 * QLD fire weather districts (BOM AAC codes QLD_FW001–QLD_FW015):
 *   Peninsula, Gulf Country, Northern Goldfields and Upper Flinders,
 *   North Tropical Coast and Tablelands, Herbert and Lower Burdekin,
 *   Central Coast and Whitsundays, Capricornia, Central Highlands and
 *   Coalfields, Central West, North West, Channel Country, Maranoa and
 *   Warrego, Darling Downs and Granite Belt, Wide Bay and Burnett,
 *   Southeast Coast
 */

import type { BanStatus } from "../../../shared/contracts.js";
import type { BomFireDistrictSnapshot } from "../bom-fire-districts.js";
import { BomFireDistrictService } from "../bom-fire-districts.js";

export interface QldFireDangerDistrict {
  distName: string;
  aac: string;
  fireDanger: string | null;
  banStatus: BanStatus;
  banStatusText: string;
  warning: string | null;
}

export interface QldFireDangerSnapshot {
  fetchedAt: string;
  districts: QldFireDangerDistrict[];
  warnings: string[];
  sourceUrl: string;
}

const QFES_SOURCE = "https://www.fire.qld.gov.au/safety-education/using-fire-outdoors/fire-bans-and-restrictions";

const fireDangerToBanStatus = (
  fireDanger: string | null
): { status: BanStatus; text: string; warning: string | null } => {
  if (!fireDanger) {
    return {
      status: "UNKNOWN",
      text: "Fire danger not available",
      warning: null,
    };
  }

  switch (fireDanger.toLowerCase()) {
    case "catastrophic":
      return {
        status: "BANNED",
        text: "Fire danger: Catastrophic — campfires banned (do not start, maintain or light outdoor fires)",
        warning: null,
      };
    case "extreme":
      return {
        status: "BANNED",
        text: "Fire danger: Extreme — campfires likely banned; check QFES before visiting",
        warning: "QLD TFB data unavailable; BANNED status inferred from Extreme fire danger",
      };
    case "severe":
      return {
        status: "UNKNOWN",
        text: "Fire danger: Severe — campfire ban status unknown; check QFES before visiting",
        warning: "QLD TFB data unavailable; check fire.qld.gov.au for current fire bans",
      };
    case "very high":
      return {
        status: "UNKNOWN",
        text: "Fire danger: Very High — campfire ban status unknown; check QFES before visiting",
        warning: "QLD TFB data unavailable; check fire.qld.gov.au for current fire bans",
      };
    case "high":
      return {
        status: "NOT_BANNED",
        text: "Fire danger: High — no fire ban in effect based on current fire danger rating",
        warning: null,
      };
    case "moderate":
      return {
        status: "NOT_BANNED",
        text: "Fire danger: Moderate — no fire ban in effect",
        warning: null,
      };
    case "no rating":
      return {
        status: "NOT_BANNED",
        text: "No fire danger rating — outside fire danger period; campfires generally permitted",
        warning: null,
      };
    default:
      return {
        status: "UNKNOWN",
        text: `Fire danger: ${fireDanger} — campfire status unknown`,
        warning: `QLD TFB data unavailable; check fire.qld.gov.au for current fire bans`,
      };
  }
};

export const buildQldFireSnapshot = (bomSnapshot: BomFireDistrictSnapshot): QldFireDangerSnapshot => {
  const warnings: string[] = [
    "Queensland QFES total fire ban data is not publicly accessible. " +
      "Ban status is inferred from BOM fire danger ratings — for accurate information, " +
      "always check https://www.fire.qld.gov.au/safety-education/using-fire-outdoors/fire-bans-and-restrictions",
  ];

  const qldDistricts = bomSnapshot.districts.filter((d) => d.stateCode === "QLD");

  const districts: QldFireDangerDistrict[] = qldDistricts.map((d) => {
    const { status, text, warning } = fireDangerToBanStatus(d.fireDanger);
    return {
      distName: d.distName,
      aac: d.distName, // BOM district names used as key
      fireDanger: d.fireDanger,
      banStatus: status,
      banStatusText: text,
      warning,
    };
  });

  if (!qldDistricts.length) {
    warnings.push("No QLD fire districts found in BOM snapshot.");
  }

  return {
    fetchedAt: bomSnapshot.fetchedAt,
    districts,
    warnings,
    sourceUrl: QFES_SOURCE,
  };
};

// ---------------------------------------------------------------------------
// Exported lookup helpers
// ---------------------------------------------------------------------------

export { BomFireDistrictService, type BomFireDistrictSnapshot };
export { QFES_SOURCE };
export { fireDangerToBanStatus };
