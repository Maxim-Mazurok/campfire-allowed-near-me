/**
 * Pipeline Stage 1c: Scrape Total Fire Ban data from RFS.
 *
 * Plain fetch locally; residential proxy retries in CI when configured.
 * Saves raw JSON responses to data/pipeline/raw-total-fire-ban.json.
 * The separate parse-total-fire-ban stage reads this archive and produces
 * data/pipeline/scrape-total-fire-ban.json (parsed TFB snapshot).
 */
import { PIPELINE_PATHS, RAW_PAGES_ARCHIVE_VERSION } from "../../shared/pipeline-types.js";
import { scrapeTotalFireBanPages } from "../services/total-fire-ban-scraper.js";
import { buildProxyUrl, HAS_PROXY, runWithProxyRetries } from "./pipeline-config.js";
import { writeRawPagesArchive } from "./pipeline-io.js";
import "dotenv/config";

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Scrape Total Fire Ban (raw JSON) ===\n");

  const log = (message: string) => {
    console.log(`[scrape-total-fire-ban] ${message}`);
  };
  const pages = HAS_PROXY
    ? await runWithProxyRetries((proxyPort) =>
      scrapeTotalFireBanPages({
        proxyUrl: buildProxyUrl(proxyPort),
        log
      })
    )
    : await scrapeTotalFireBanPages({ log });

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
