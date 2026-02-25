/**
 * Pipeline Stage 1b: Scrape closure notices from FCNSW.
 *
 * Does not require a browser — uses plain fetch through proxy.
 * Produces raw closure notices (without LLM enrichment).
 * Produces: data/pipeline/scrape-closures.json
 */
import { ForestryScraper } from "../../apps/api/src/services/forestry-scraper.js";
import {
  PIPELINE_PATHS,
  SCRAPE_CLOSURES_STAGE,
  SCRAPE_CLOSURES_VERSION,
  createStageOutput,
  type ScrapeClosuresData
} from "../../packages/shared/src/pipeline-types.js";
import { writePipelineFile } from "./pipeline-io.js";
import {
  BROWSER_PROFILE_DIRECTORY,
  buildProxyUrl,
  runWithProxyRetries
} from "./pipeline-config.js";

const scrapeClosuresWithPort = async (proxyPort: string): Promise<ScrapeClosuresData> => {
  const scraper = new ForestryScraper({
    verbose: true,
    rawPageCacheTtlMs: 0,
    proxyUrl: buildProxyUrl(proxyPort),
    browserProfileDirectory: BROWSER_PROFILE_DIRECTORY
  });

  console.log("[scrape-closures] Scraping closure notices...");
  const result = await scraper.scrapeClosureNotices();

  console.log(`[scrape-closures] Found ${result.closures.length} closure notice(s)`);

  return result;
};

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Scrape Closures ===\n");

  const data = await runWithProxyRetries(scrapeClosuresWithPort);

  const output = createStageOutput(
    SCRAPE_CLOSURES_STAGE,
    SCRAPE_CLOSURES_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.scrapeClosures, output);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Scrape-closures complete (${elapsedSeconds}s)`);

  if (data.warnings.length) {
    console.log(`  Warnings: ${data.warnings.length}`);
    for (const warning of data.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main().catch((error) => {
  console.error("Fatal error in scrape-closures:");
  console.error(error);
  process.exit(1);
});
