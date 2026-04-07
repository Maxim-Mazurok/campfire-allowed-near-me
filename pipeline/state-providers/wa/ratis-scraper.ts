/**
 * WA RATIS Campfire Status Scraper
 *
 * Scrapes the DBCA RATIS system campfire-status page:
 *   https://ratisweb.dpaw.wa.gov.au/campgrounds/public/campfire-status.aspx
 *
 * This page is embedded as an iframe in the main Explore Parks WA campfire
 * conditions page. It uses ASP.NET WebForms with VIEWSTATE-based pagination.
 *
 * Each campground row contains:
 *   - Campground name
 *   - Park name
 *   - Campfire status: "Campfires permitted" | "No campfires" | "Campfire ban" | ...
 *
 * Strategy: GET the first page (20 rows), extract VIEWSTATE, then POST
 * with the "Next page" button to navigate through all pages.
 *
 * In testing (March 2026) there are ~129 campgrounds across 7 pages.
 *
 * See docs/research/04-western-australia.md for full research notes.
 */

import { load } from "cheerio";

const CAMPFIRE_STATUS_URL =
  "https://ratisweb.dpaw.wa.gov.au/campgrounds/public/campfire-status.aspx";

export type WaCampfireStatus =
  | "PERMITTED"
  | "BANNED"
  | "NO_CAMPFIRES"
  | "UNKNOWN";

export interface WaCampground {
  name: string;
  park: string;
  rawStatus: string;
  campfireStatus: WaCampfireStatus;
}

interface ViewStateFields {
  __VIEWSTATE: string;
  __VIEWSTATEGENERATOR: string;
  __EVENTVALIDATION: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Status parsing
// ---------------------------------------------------------------------------

export const parseCampfireStatus = (rawStatus: string): WaCampfireStatus => {
  const s = rawStatus.toLowerCase().trim();
  if (s.includes("permitted")) return "PERMITTED";
  if (s.includes("ban") || s.includes("not permitted")) return "BANNED";
  if (s.includes("no campfire") || s === "no fires") return "NO_CAMPFIRES";
  return "UNKNOWN";
};

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

const parseRows = (html: string): WaCampground[] => {
  const $ = load(html);
  const rows: WaCampground[] = [];

  $("table tr").each((i, row) => {
    const cells = $(row).find("td");
    if (cells.length < 3) return;
    const name = $(cells[0]!).text().trim();
    const park = $(cells[1]!).text().trim();
    const rawStatus = $(cells[2]!).text().trim();
    if (!name || name === "Campground") return;
    rows.push({
      name,
      park,
      rawStatus,
      campfireStatus: parseCampfireStatus(rawStatus),
    });
  });

  return rows;
};

const extractViewState = (html: string): ViewStateFields => {
  const $ = load(html);
  return {
    __VIEWSTATE: $("#__VIEWSTATE").attr("value") ?? "",
    __VIEWSTATEGENERATOR: $("#__VIEWSTATEGENERATOR").attr("value") ?? "",
    __EVENTVALIDATION: $("#__EVENTVALIDATION").attr("value") ?? "",
  };
};

const extractPageCount = (html: string): number => {
  const m = /LabelNumberOfPages[^>]*>\s*of\s*(\d+)/.exec(html);
  return m ? parseInt(m[1]!, 10) : 1;
};

// ---------------------------------------------------------------------------
// Fetch all campgrounds
// ---------------------------------------------------------------------------

const buildNextPageFormData = (
  fields: ViewStateFields,
  currentPage: number
): URLSearchParams => {
  const params = new URLSearchParams();
  params.set("__VIEWSTATE", fields.__VIEWSTATE);
  params.set("__VIEWSTATEGENERATOR", fields.__VIEWSTATEGENERATOR);
  params.set("__EVENTVALIDATION", fields.__EVENTVALIDATION);
  params.set("__EVENTTARGET", "");
  params.set("__EVENTARGUMENT", "");
  params.set("__LASTFOCUS", "");
  params.set("__VIEWSTATEENCRYPTED", "");
  params.set("txtKeyword", "");
  params.set(
    "GridView1$ctl23$GridViewPager1$TextBoxPage",
    String(currentPage)
  );
  params.set(
    "GridView1$ctl23$GridViewPager1$DropDownListPageSize",
    "20"
  );
  params.set(
    "GridView1$ctl23$GridViewPager1$ImageButtonNext.x",
    "1"
  );
  params.set(
    "GridView1$ctl23$GridViewPager1$ImageButtonNext.y",
    "1"
  );
  return params;
};

export const fetchWaCampgrounds = async (
  fetchImpl: typeof fetch
): Promise<{ campgrounds: WaCampground[]; warnings: string[] }> => {
  const warnings: string[] = [];
  const allCampgrounds: WaCampground[] = [];

  const commonHeaders = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: CAMPFIRE_STATUS_URL,
  };

  // GET page 1
  let html: string;
  try {
    const resp = await fetchImpl(CAMPFIRE_STATUS_URL, {
      headers: commonHeaders,
    });
    if (!resp.ok)
      throw new Error(`HTTP ${resp.status} fetching WA campfire status page`);
    html = await resp.text();
  } catch (err) {
    warnings.push(
      `Could not fetch WA campfire status from ${CAMPFIRE_STATUS_URL}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { campgrounds: [], warnings };
  }

  allCampgrounds.push(...parseRows(html));
  const pageCount = extractPageCount(html);

  // POST to navigate pages 2..N
  for (let page = 2; page <= pageCount; page++) {
    const fields = extractViewState(html);
    try {
      const resp = await fetchImpl(CAMPFIRE_STATUS_URL, {
        method: "POST",
        headers: {
          ...commonHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: buildNextPageFormData(fields, page - 1).toString(),
      });
      if (!resp.ok)
        throw new Error(`HTTP ${resp.status} fetching WA campfire status page ${page}`);
      html = await resp.text();
      if (html.includes("System error") || html.includes("error.aspx")) {
        warnings.push(
          `WA campfire status page ${page}/${pageCount} returned an error page — stopping pagination.`
        );
        break;
      }
    } catch (err) {
      warnings.push(
        `Could not fetch WA campfire status page ${page}/${pageCount}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      break;
    }
    allCampgrounds.push(...parseRows(html));
  }

  return { campgrounds: allCampgrounds, warnings };
};
