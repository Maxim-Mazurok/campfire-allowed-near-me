/**
 * Pipeline Stage 1a: Scrape Forestry pages (fire ban areas + forest directory).
 *
 * Requires a browser for Cloudflare-protected pages.
 * Saves raw HTML pages to data/pipeline/raw-forestry-pages.json.
 * The separate parse-forestry stage reads this archive and produces
 * data/pipeline/scrape-forestry.json (parsed areas + directory).
 */
import { ForestryScraper } from "../services/forestry-scraper.js";
import { RawPageCache } from "../utils/raw-page-cache.js";
import {
  PIPELINE_PATHS,
  RAW_PAGES_ARCHIVE_VERSION
} from "../../shared/pipeline-types.js";
import { writeRawPagesArchive } from "./pipeline-io.js";
import {
  BROWSER_PROFILE_DIRECTORY,
  createProxyBrowserContextFactory,
  buildProxyUrl,
  runWithProxyRetries,
  SCRAPE_DEBUG_ARTIFACT_DIRECTORY
} from "./pipeline-config.js";

const scrapeForestryWithPort = async (proxyPort: string): Promise<RawPageCache> => {
  const rawPageCache = new RawPageCache({
    filePath: PIPELINE_PATHS.rawForestryPages,
    ttlMs: 0
  });

  const scraper = new ForestryScraper({
    browserContextFactory: createProxyBrowserContextFactory(proxyPort),
    verbose: true,
    rawPageCache,
    rawPageCacheTtlMs: 0,
    proxyUrl: buildProxyUrl(proxyPort),
    browserProfileDirectory: BROWSER_PROFILE_DIRECTORY,
    debugArtifactDirectory: SCRAPE_DEBUG_ARTIFACT_DIRECTORY
  });

  console.log("[scrape-forestry] Scraping fire ban pages and directory (fetching raw HTML)...");
  const result = await scraper.scrapeForestryPages();

  console.log(`[scrape-forestry] Fetched pages for ${result.areas.length} area(s)`);
  const totalForests = result.areas.reduce(
    (count, area) => count + area.forests.length, 0
  );
  console.log(`[scrape-forestry] Found ${totalForests} forest entries across areas`);
  console.log(`[scrape-forestry] Directory: ${result.directory.forests.length} forest(s), ${result.directory.filters.length} filter(s)`);

  if (result.warnings.length) {
    for (const warning of result.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  return rawPageCache;
};

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Scrape Forestry (raw HTML) ===\n");

  const rawPageCache = await runWithProxyRetries(scrapeForestryWithPort);

  const allPages = await rawPageCache.exportAllPages();

  writeRawPagesArchive(PIPELINE_PATHS.rawForestryPages, {
    schemaVersion: RAW_PAGES_ARCHIVE_VERSION,
    pages: allPages
  });

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Scrape-forestry complete (${elapsedSeconds}s)`);
};

main().catch((error) => {
  console.error("Fatal error in scrape-forestry:");
  console.error(error);
  process.exit(1);
});
