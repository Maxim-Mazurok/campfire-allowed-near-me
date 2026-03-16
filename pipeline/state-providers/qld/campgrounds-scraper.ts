/**
 * Queensland Campgrounds A-Z Scraper
 *
 * Scrapes the parks.qld.gov.au campgrounds A-Z listing to collect all
 * campground URLs (one per letter page), then fetches each campground page
 * to extract:
 *   - geo.position meta tag → exact lat/lng for the campground
 *   - parks.campfires meta tag → "yes" if campfires permitted
 *   - parks.facilities meta tag → semicolon-separated facility list
 *
 * The result is used by the QLD forest provider to build PersistedForestPoint[]
 * entries with per-campground campfire status and facility data.
 *
 * Note: The parks.qld.gov.au domain uses Cloudflare but allows regular User-Agent
 * access without bot protection in the current configuration (tested March 2026).
 */

import { load } from "cheerio";

const PARKS_BASE_URL = "https://parks.qld.gov.au";
const CAMPGROUNDS_AZ_URL = `${PARKS_BASE_URL}/parks/campgrounds-a-z`;
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export interface QldCampground {
  /** Canonical URL of the campground page */
  url: string;
  /** Campground name from the page title */
  name: string;
  /** Park name (derived from URL slug) */
  parkSlug: string;
  /** Campground slug within the park */
  campgroundSlug: string;
  /** Latitude from meta geo.position */
  latitude: number | null;
  /** Longitude from meta geo.position */
  longitude: number | null;
  /** Whether campfires are permitted (null = not specified) */
  campfiresPermitted: boolean | null;
  /** Semicolon-separated raw facilities string */
  facilitiesRaw: string;
  /** True when facilities list includes "campfires-permitted" */
  facilitiesIncludeCampfire: boolean;
  /** True when facilities list includes "barbecue-fuel-free" (no wood fire) */
  facilitiesIncludeFuelFreeBbq: boolean;
  /** True when facilities list includes "toilets-flush" */
  toilets: boolean;
  /** True when facilities list includes "tap-water" */
  water: boolean;
  /** True when facilities list includes "picnic-tables" or "picnic-tables-sheltered" */
  tables: boolean;
  /** True when facilities list includes "barbecue-gas" */
  bbqGas: boolean;
}

// ---------------------------------------------------------------------------
// Step 1: Collect all campground URLs from A-Z listing
// ---------------------------------------------------------------------------

const parseCampgroundLinksFromPage = (html: string): string[] => {
  const $ = load(html);
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    // Match: https://parks.qld.gov.au/parks/{park-slug}/camping/{campground-slug}
    if (/^https:\/\/parks\.qld\.gov\.au\/parks\/[^/]+\/camping\/[^/]+$/.test(href)) {
      links.add(href);
    }
  });

  return Array.from(links);
};

export const fetchQldCampgroundUrls = async (
  fetchImpl: typeof fetch
): Promise<{ urls: string[]; warnings: string[] }> => {
  const allUrls = new Set<string>();
  const warnings: string[] = [];

  const fetchLetter = async (letter: string): Promise<void> => {
    const url =
      letter === "a"
        ? CAMPGROUNDS_AZ_URL
        : `${CAMPGROUNDS_AZ_URL}?letter=${letter}`;
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
      });
      if (!response.ok) {
        warnings.push(`Letter page "${letter}" returned HTTP ${response.status}`);
        return;
      }
      const html = await response.text();
      const links = parseCampgroundLinksFromPage(html);
      for (const link of links) allUrls.add(link);
    } catch (err) {
      warnings.push(
        `Failed to fetch letter page "${letter}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  // Fetch all letter pages with limited concurrency
  const CONCURRENCY = 5;
  for (let i = 0; i < LETTERS.length; i += CONCURRENCY) {
    await Promise.all(LETTERS.slice(i, i + CONCURRENCY).map(fetchLetter));
  }

  return { urls: Array.from(allUrls), warnings };
};

// ---------------------------------------------------------------------------
// Step 2: Fetch individual campground pages
// ---------------------------------------------------------------------------

const parseGeoPosition = (content: string): [number | null, number | null] => {
  // Format: "-26.358; 152.556668" or "-26.358, 152.556668"
  const parts = content.split(/[;,]/).map((s) => parseFloat(s.trim()));
  if (parts.length >= 2 && !isNaN(parts[0]!) && !isNaN(parts[1]!)) {
    return [parts[0]!, parts[1]!];
  }
  return [null, null];
};

export const fetchQldCampground = async (
  url: string,
  fetchImpl: typeof fetch
): Promise<QldCampground | null> => {
  try {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
      },
    });
    if (!response.ok) return null;
    const html = await response.text();
    const $ = load(html);

    // Extract metadata
    const geoPosition = $("meta[name='geo.position']").attr("content") ?? "";
    const campfiresRaw = $("meta[name='parks.campfires']").attr("content") ?? "";
    const facilitiesRaw = $("meta[name='parks.facilities']").attr("content") ?? "";

    const [lat, lng] = parseGeoPosition(geoPosition);
    const facilities = facilitiesRaw
      .split(";")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // Determine campfire status from meta tag or facilities
    let campfiresPermitted: boolean | null = null;
    if (campfiresRaw.toLowerCase() === "yes") {
      campfiresPermitted = true;
    } else if (campfiresRaw.toLowerCase() === "no") {
      campfiresPermitted = false;
    } else if (facilities.includes("campfires-permitted")) {
      campfiresPermitted = true;
    }

    // Extract page title as campground name
    const titleRaw = $("title").text().trim();
    // Title format: "{Campground Name} | Parks and forests | Queensland"
    const name =
      titleRaw.split("|")[0]?.trim() ||
      url.split("/camping/")[1]?.replace(/-/g, " ") ||
      "Unknown";

    // Extract park slug from URL
    const urlMatch = /\/parks\/([^/]+)\/camping\/([^/]+)/.exec(url);
    const parkSlug = urlMatch?.[1] ?? "";
    const campgroundSlug = urlMatch?.[2] ?? "";

    return {
      url,
      name,
      parkSlug,
      campgroundSlug,
      latitude: lat,
      longitude: lng,
      campfiresPermitted,
      facilitiesRaw,
      facilitiesIncludeCampfire: facilities.includes("campfires-permitted"),
      facilitiesIncludeFuelFreeBbq: facilities.includes("barbecue-fuel-free"),
      toilets:
        facilities.includes("toilets-flush") ||
        facilities.includes("toilets-non-flush"),
      water: facilities.includes("tap-water"),
      tables:
        facilities.includes("picnic-tables") ||
        facilities.includes("picnic-tables-sheltered"),
      bbqGas: facilities.includes("barbecue-gas"),
    };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Step 3: Bulk fetch all campgrounds with concurrency control
// ---------------------------------------------------------------------------

export const fetchAllQldCampgrounds = async (
  fetchImpl: typeof fetch,
  options?: {
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<{ campgrounds: QldCampground[]; warnings: string[] }> => {
  const { concurrency = 10, onProgress } = options ?? {};
  const warnings: string[] = [];

  // Get all URLs
  const { urls, warnings: urlWarnings } = await fetchQldCampgroundUrls(fetchImpl);
  warnings.push(...urlWarnings);

  if (!urls.length) {
    warnings.push("No QLD campground URLs found from A-Z listing.");
    return { campgrounds: [], warnings };
  }

  // Fetch all campground pages with concurrency limit
  const campgrounds: QldCampground[] = [];
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((url) => fetchQldCampground(url, fetchImpl))
    );
    for (const result of results) {
      if (result) {
        campgrounds.push(result);
      } else {
        failed++;
      }
    }
    completed += batch.length;
    onProgress?.(completed, urls.length);
  }

  if (failed > 0) {
    warnings.push(
      `${failed} of ${urls.length} QLD campground pages failed to fetch or parse.`
    );
  }

  // Filter to campgrounds with valid coordinates only
  const withCoords = campgrounds.filter(
    (c) => c.latitude !== null && c.longitude !== null
  );
  const missingCoords = campgrounds.length - withCoords.length;
  if (missingCoords > 0) {
    warnings.push(
      `${missingCoords} QLD campgrounds skipped (no geo.position coordinates in page).`
    );
  }

  return { campgrounds: withCoords, warnings };
};
