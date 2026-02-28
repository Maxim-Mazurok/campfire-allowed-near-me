/**
 * Pipeline Stage 1c: Scrape Total Fire Ban data from RFS.
 *
 * Plain fetch — no browser, no proxy needed.
 * Saves raw JSON responses to data/pipeline/raw-total-fire-ban.json.
 * The separate parse-total-fire-ban stage reads this archive and produces
 * data/pipeline/scrape-total-fire-ban.json (parsed TFB snapshot).
 */
import {
  PIPELINE_PATHS,
  RAW_PAGES_ARCHIVE_VERSION,
  type RawPagesArchiveEntry
} from "../../shared/pipeline-types.js";
import { writeRawPagesArchive } from "./pipeline-io.js";
import "dotenv/config";

/** Well-known RFS API URLs (same as TotalFireBanService defaults). */
const RATINGS_URL =
  "https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2";
const GEO_JSON_URL =
  "https://www.rfs.nsw.gov.au/_designs/geojson/fire-danger-ratings-geojson";

const TIMEOUT_MS = 20_000;

const fetchAndCapture = async (
  url: string,
  pages: Record<string, RawPagesArchiveEntry>
): Promise<void> => {
  console.log(`[scrape-total-fire-ban] Fetching ${url} ...`);
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: total fire ban lookup)",
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const body = await response.text();
  console.log(`[scrape-total-fire-ban] HTTP ${response.status} (${body.length} bytes)`);

  pages[url] = {
    fetchedAt: new Date().toISOString(),
    finalUrl: response.url || url,
    html: body
  };
};

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Scrape Total Fire Ban (raw JSON) ===\n");

  const pages: Record<string, RawPagesArchiveEntry> = {};

  await fetchAndCapture(RATINGS_URL, pages);
  await fetchAndCapture(GEO_JSON_URL, pages);

  writeRawPagesArchive(PIPELINE_PATHS.rawTotalFireBan, {
    schemaVersion: RAW_PAGES_ARCHIVE_VERSION,
    pages
  });

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Scrape-total-fire-ban complete (${elapsedSeconds}s)`);
};

main().catch((error) => {
  console.error("Fatal error in scrape-total-fire-ban:");
  console.error(error);
  process.exit(1);
});
