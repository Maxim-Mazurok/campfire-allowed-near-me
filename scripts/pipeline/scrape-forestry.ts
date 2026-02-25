/**
 * Pipeline Stage 1a: Scrape Forestry pages (fire ban areas + forest directory).
 *
 * Requires a browser for Cloudflare-protected pages.
 * Produces: data/pipeline/scrape-forestry.json
 */
import { ForestryScraper } from "../../apps/api/src/services/forestry-scraper.js";
import {
  PIPELINE_PATHS,
  SCRAPE_FORESTRY_STAGE,
  SCRAPE_FORESTRY_VERSION,
  createStageOutput,
  type ScrapeForestryData
} from "../../packages/shared/src/pipeline-types.js";
import { writePipelineFile } from "./pipeline-io.js";
import {
  BROWSER_PROFILE_DIRECTORY,
  createProxyBrowserContextFactory,
  buildProxyUrl,
  runWithProxyRetries
} from "./pipeline-config.js";

const scrapeForestryWithPort = async (proxyPort: string): Promise<ScrapeForestryData> => {
  const scraper = new ForestryScraper({
    browserContextFactory: createProxyBrowserContextFactory(proxyPort),
    verbose: true,
    rawPageCacheTtlMs: 0,
    proxyUrl: buildProxyUrl(proxyPort),
    browserProfileDirectory: BROWSER_PROFILE_DIRECTORY
  });

  console.log("[scrape-forestry] Scraping fire ban pages and directory...");
  const result = await scraper.scrapeForestryPages();

  console.log(`[scrape-forestry] Found ${result.areas.length} area(s)`);
  const totalForests = result.areas.reduce(
    (count, area) => count + area.forests.length, 0
  );
  console.log(`[scrape-forestry] Found ${totalForests} forest entries across areas`);
  console.log(`[scrape-forestry] Directory: ${result.directory.forests.length} forest(s), ${result.directory.filters.length} filter(s)`);

  return result;
};

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Scrape Forestry ===\n");

  const data = await runWithProxyRetries(scrapeForestryWithPort);

  const output = createStageOutput(
    SCRAPE_FORESTRY_STAGE,
    SCRAPE_FORESTRY_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.scrapeForestry, output);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Scrape-forestry complete (${elapsedSeconds}s)`);

  if (data.warnings.length) {
    console.log(`  Warnings: ${data.warnings.length}`);
    for (const warning of data.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main().catch((error) => {
  console.error("Fatal error in scrape-forestry:");
  console.error(error);
  process.exit(1);
});
