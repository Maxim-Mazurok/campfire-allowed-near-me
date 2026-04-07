/**
 * Tasmania Fire Ban Provider
 *
 * Scrapes the Tasmania Fire Service (TFS) Total Fire Ban page for current
 * fire ban status. TFS can declare TFBs for the whole state or specific districts.
 *
 * Source: https://www.fire.tas.gov.au/Show?pageId=colFireBan
 *
 * TAS districts (from TFS):
 *   Northern, North Western, North Eastern, Midlands, Southern, South Eastern,
 *   South Western, Eastern, Western, Far North Western, Central
 * (exact names vary — scraped from the page)
 *
 * Fallback: If scraping fails or there is no TFB declared, status is NOT_BANNED.
 */

import { load } from "cheerio";
import type { BanStatus } from "../../../shared/contracts.js";

const TFS_FIRE_BAN_URL = "https://www.fire.tas.gov.au/Show?pageId=colFireBan";
const TFS_FIRE_BAN_SOURCE_URL = TFS_FIRE_BAN_URL;

export interface TasFireBanStatus {
  fetchedAt: string;
  /**
   * Whether a total fire ban is in effect anywhere in Tasmania today.
   * Individual district status available in `districtBans`.
   */
  anyBanActive: boolean;
  /**
   * Per-district ban status where known.
   * Key: district name (lower-cased for matching), value: ban status.
   */
  districtBans: Record<string, BanStatus>;
  sourceUrl: string;
  warnings: string[];
}

const parseBanStatus = (text: string): BanStatus => {
  const normalised = text.toLowerCase().trim();
  if (normalised.includes("in force") || normalised.includes("declared") || normalised.includes("total fire ban")) {
    return "BANNED";
  }
  if (normalised.includes("not in force") || normalised.includes("no total fire ban") || normalised.includes("no ban")) {
    return "NOT_BANNED";
  }
  return "UNKNOWN";
};

export const fetchTasFireBans = async (fetchImpl = fetch): Promise<TasFireBanStatus> => {
  const warnings: string[] = [];
  const districtBans: Record<string, BanStatus> = {};
  let anyBanActive = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);

    let html = "";
    try {
      const response = await fetchImpl(TFS_FIRE_BAN_URL, {
        headers: {
          "User-Agent":
            "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire-ban-lookup)",
          Accept: "text/html",
        },
        signal: controller.signal,
      });
      html = await response.text();
    } finally {
      clearTimeout(timeoutId);
    }

    const $ = load(html);

    // TFS page renders a table or list with district names and ban status.
    // Structure varies; attempt multiple selectors.

    // Method 1: Look for table rows with district name + status
    $("table tr").each((_, row) => {
      const cells = $(row).find("td");
      if (cells.length >= 2) {
        const district = $(cells[0]!).text().trim().toLowerCase();
        const statusText = $(cells[1]!).text().trim();
        if (district && statusText) {
          const status = parseBanStatus(statusText);
          districtBans[district] = status;
          if (status === "BANNED") anyBanActive = true;
        }
      }
    });

    // Method 2: Look for paragraphs/spans with "Total Fire Ban" mentions
    if (Object.keys(districtBans).length === 0) {
      const bodyText = $("body").text();
      // Check for state-wide ban
      if (/total fire ban is (currently )?in force/i.test(bodyText)) {
        anyBanActive = true;
        districtBans["all"] = "BANNED";
      } else if (/no total fire ban/i.test(bodyText) || /not currently a day of total fire ban/i.test(bodyText)) {
        // No ban active
      } else {
        warnings.push("TFS fire ban page structure not recognised; fire ban status is unknown.");
      }
    }
  } catch (err) {
    warnings.push(
      `Could not fetch TFS fire ban data from ${TFS_FIRE_BAN_URL}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return {
    fetchedAt: new Date().toISOString(),
    anyBanActive,
    districtBans,
    sourceUrl: TFS_FIRE_BAN_SOURCE_URL,
    warnings,
  };
};
