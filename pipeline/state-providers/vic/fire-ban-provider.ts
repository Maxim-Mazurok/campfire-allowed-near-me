/**
 * Victoria CFA Fire Ban Provider
 *
 * Parses the CFA (Country Fire Authority) RSS feed for Victoria's
 * Total Fire Ban status per fire district.
 *
 * Feed URL: https://www.cfa.vic.gov.au/cfa/rssfeed/tfbfdrforecast_rss.xml
 * Updated: every ~minute during fire danger period.
 *
 * CFA fire districts in Victoria:
 *   Central, East Gippsland, Mallee, North Central, North East,
 *   Northern Country, South West, West and South Gippsland, Wimmera
 *
 * The RSS <description> for today's forecast contains lines like:
 *   "Central: NO - RESTRICTIONS MAY APPLY"
 *   "Mallee: YES"
 *
 * FFMV (Forest Fire Management Victoria) areas follow the same districts.
 */

import { load } from "cheerio";
import type { BanStatus } from "../../../shared/contracts.js";

const CFA_RSS_URL =
  "https://www.cfa.vic.gov.au/cfa/rssfeed/tfbfdrforecast_rss.xml";

export interface CfaFireBanDistrict {
  name: string;
  banStatus: BanStatus;
  banStatusText: string;
  fireDangerRating: string | null;
}

export interface CfaFireBanSnapshot {
  fetchedAt: string;
  dateLabel: string | null;
  districts: CfaFireBanDistrict[];
  sourceUrl: string;
  warnings: string[];
}

const DISTRICT_NAMES = [
  "Central",
  "East Gippsland",
  "Mallee",
  "North Central",
  "North East",
  "Northern Country",
  "South West",
  "West and South Gippsland",
  "Wimmera",
];

const parseBanLine = (line: string): { district: string; status: BanStatus; rawText: string } | null => {
  // Format: "DistrictName: YES" or "DistrictName: NO - RESTRICTIONS MAY APPLY"
  const match = /^([^:]+):\s*(.+)$/.exec(line.trim());
  if (!match) return null;

  const district = match[1]!.trim();
  const rawText = match[2]!.trim().toUpperCase();

  // Check if this is a recognised district
  const known = DISTRICT_NAMES.find(
    (d) => d.toLowerCase() === district.toLowerCase()
  );
  if (!known) return null;

  let status: BanStatus = "UNKNOWN";
  if (rawText === "YES" || rawText.startsWith("YES ")) {
    status = "BANNED";
  } else if (rawText === "NO" || rawText.startsWith("NO ") || rawText.startsWith("NO -")) {
    status = "NOT_BANNED";
  }

  return { district: known, status, rawText: match[2]!.trim() };
};

const parseFdrLine = (line: string): { district: string; fdr: string } | null => {
  const match = /^([^:]+):\s*(.+)$/.exec(line.trim());
  if (!match) return null;
  const district = DISTRICT_NAMES.find(
    (d) => d.toLowerCase() === match[1]!.trim().toLowerCase()
  );
  if (!district) return null;
  return { district, fdr: match[2]!.trim() };
};

export const fetchCfaFireBans = async (fetchImpl = fetch): Promise<CfaFireBanSnapshot> => {
  const warnings: string[] = [];
  const districts: CfaFireBanDistrict[] = [];
  let dateLabel: string | null = null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);

    let xml = "";
    try {
      const response = await fetchImpl(CFA_RSS_URL, {
        headers: {
          "User-Agent": "campfire-allowed-near-me/1.0 (purpose: fire-ban-lookup)",
          Accept: "application/rss+xml, text/xml",
        },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      xml = await response.text();
    } finally {
      clearTimeout(timeoutId);
    }

    const $ = load(xml, { xmlMode: true });

    // Get the first item (today's forecast)
    const firstItem = $("item").first();
    dateLabel = firstItem.find("title").text().trim() || null;
    const descriptionRaw = firstItem.find("description").text().trim();

    // The description is HTML inside CDATA; parse it
    const $desc = load(descriptionRaw);
    const allText = $desc("body").text() || descriptionRaw;

    // Split by line breaks and <br> tags
    const lines = allText
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean);

    // Find section delimiters
    let inBanSection = false;
    let inFdrSection = false;
    const banMap = new Map<string, BanStatus>();
    const fdrMap = new Map<string, string>();

    for (const line of lines) {
      if (/Total Fire Ban/i.test(line) && !inBanSection && !inFdrSection) {
        inBanSection = true;
        inFdrSection = false;
        continue;
      }
      if (/Fire Danger Rating/i.test(line)) {
        inBanSection = false;
        inFdrSection = true;
        continue;
      }
      if (inBanSection) {
        const parsed = parseBanLine(line);
        if (parsed) {
          banMap.set(parsed.district, parsed.status);
        }
      }
      if (inFdrSection) {
        const parsed = parseFdrLine(line);
        if (parsed) {
          fdrMap.set(parsed.district, parsed.fdr);
        }
      }
    }

    // Build district list
    for (const district of DISTRICT_NAMES) {
      districts.push({
        name: district,
        banStatus: banMap.get(district) ?? "UNKNOWN",
        banStatusText: banMap.get(district) === "BANNED"
          ? "Total Fire Ban declared"
          : banMap.get(district) === "NOT_BANNED"
            ? "No Total Fire Ban"
            : "Unknown",
        fireDangerRating: fdrMap.get(district) ?? null,
      });
    }

    if (districts.every((d) => d.banStatus === "UNKNOWN")) {
      warnings.push(
        "CFA RSS feed parsed but all district statuses are UNKNOWN — feed structure may have changed."
      );
    }
  } catch (err) {
    warnings.push(
      `Could not fetch CFA fire ban RSS from ${CFA_RSS_URL}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  return {
    fetchedAt: new Date().toISOString(),
    dateLabel,
    districts,
    sourceUrl: CFA_RSS_URL,
    warnings,
  };
};
