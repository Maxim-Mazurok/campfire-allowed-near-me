/**
 * Pipeline Stage 1b: Scrape closure notices from FCNSW.
 *
 * Does not require a browser — uses plain fetch through proxy.
 * Saves raw HTML pages to data/pipeline/raw-closure-pages.json.
 * The separate parse-closures stage reads this archive and produces
 * data/pipeline/scrape-closures.json (parsed closure notices).
 */
import { ForestryScraper } from "../services/forestry-scraper.js";
import { RawPageCache } from "../utils/raw-page-cache.js";
import { PIPELINE_PATHS, RAW_PAGES_ARCHIVE_VERSION } from "../../shared/pipeline-types.js";
import { writeRawPagesArchive } from "./pipeline-io.js";
import {
  BROWSER_PROFILE_DIRECTORY,
  buildProxyUrl,
  runWithProxyRetries
} from "./pipeline-config.js";

const scrapeClosuresWithPort = async (proxyPort: string): Promise<RawPageCache> => {
  const rawPageCache = new RawPageCache({
    filePath: PIPELINE_PATHS.rawClosurePages,
    ttlMs: 0
  });

  const scraper = new ForestryScraper({
    verbose: true,
    rawPageCache,
    rawPageCacheTtlMs: 0,
    proxyUrl: buildProxyUrl(proxyPort),
    browserProfileDirectory: BROWSER_PROFILE_DIRECTORY
  });

  console.log("[scrape-closures] Scraping closure notices (fetching raw HTML)...");
  const result = await scraper.scrapeClosureNotices();

  console.log(`[scrape-closures] Fetched pages for ${result.closures.length} closure notice(s)`);

  if (result.warnings.length) {
    for (const warning of result.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  return rawPageCache;
};

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Scrape Closures (raw HTML) ===\n");

  const rawPageCache = await runWithProxyRetries(scrapeClosuresWithPort);

  const allPages = await rawPageCache.exportAllPages();

  writeRawPagesArchive(PIPELINE_PATHS.rawClosurePages, {
    schemaVersion: RAW_PAGES_ARCHIVE_VERSION,
    pages: allPages
  });

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Scrape-closures complete (${elapsedSeconds}s)`);
};

main().catch((error) => {
  console.error("Fatal error in scrape-closures:");
  console.error(error);
  process.exit(1);
});
