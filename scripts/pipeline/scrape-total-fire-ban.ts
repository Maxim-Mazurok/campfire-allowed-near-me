/**
 * Pipeline Stage 1c: Scrape Total Fire Ban data from RFS.
 *
 * Plain fetch — no browser, no proxy needed.
 * Produces: data/pipeline/scrape-total-fire-ban.json
 */
import { TotalFireBanService } from "../../apps/api/src/services/total-fire-ban-service.js";
import {
  PIPELINE_PATHS,
  SCRAPE_TOTAL_FIRE_BAN_STAGE,
  SCRAPE_TOTAL_FIRE_BAN_VERSION,
  createStageOutput,
  type ScrapeTotalFireBanData
} from "../../packages/shared/src/pipeline-types.js";
import { writePipelineFile } from "./pipeline-io.js";
import "dotenv/config";

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Scrape Total Fire Ban ===\n");

  const totalFireBanService = new TotalFireBanService();

  console.log("[scrape-total-fire-ban] Fetching RFS fire danger data...");
  const snapshot = await totalFireBanService.fetchCurrentSnapshot();

  console.log(`[scrape-total-fire-ban] Area statuses: ${snapshot.areaStatuses.length}`);
  console.log(`[scrape-total-fire-ban] Geo areas: ${snapshot.geoAreas.length}`);

  const data: ScrapeTotalFireBanData = { snapshot };

  const output = createStageOutput(
    SCRAPE_TOTAL_FIRE_BAN_STAGE,
    SCRAPE_TOTAL_FIRE_BAN_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.scrapeTotalFireBan, output);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Scrape-total-fire-ban complete (${elapsedSeconds}s)`);

  if (snapshot.warnings.length) {
    console.log(`  Warnings: ${snapshot.warnings.length}`);
    for (const warning of snapshot.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main().catch((error) => {
  console.error("Fatal error in scrape-total-fire-ban:");
  console.error(error);
  process.exit(1);
});
