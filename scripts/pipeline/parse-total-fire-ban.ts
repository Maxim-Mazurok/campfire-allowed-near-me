/**
 * Pipeline Stage 2c: Parse Total Fire Ban data from raw JSON archive.
 *
 * Reads data/pipeline/raw-total-fire-ban.json (raw JSON from scrape stage).
 * Produces data/pipeline/scrape-total-fire-ban.json (parsed TFB snapshot).
 * No HTTP requests — feeds saved responses through TotalFireBanService via
 * a mock fetch implementation.
 */
import { TotalFireBanService } from "../../apps/api/src/services/total-fire-ban-service.js";
import {
  PIPELINE_PATHS,
  SCRAPE_TOTAL_FIRE_BAN_STAGE,
  SCRAPE_TOTAL_FIRE_BAN_VERSION,
  createStageOutput,
  type ScrapeTotalFireBanData,
  type RawPagesArchive
} from "../../packages/shared/src/pipeline-types.js";
import { readRawPagesArchive, writePipelineFile } from "./pipeline-io.js";

/**
 * Creates a fetch implementation that returns responses from the raw archive
 * instead of making HTTP requests.
 */
const createArchiveFetch = (archive: RawPagesArchive): typeof fetch => {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const entry = archive.pages[url];
    if (!entry) {
      throw new Error(`URL not found in raw archive: ${url}`);
    }

    return new Response(entry.html, {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
};

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Parse Total Fire Ban (from raw JSON) ===\n");

  const archive = readRawPagesArchive(PIPELINE_PATHS.rawTotalFireBan);

  const archiveFetch = createArchiveFetch(archive);
  const totalFireBanService = new TotalFireBanService({ fetchImpl: archiveFetch });

  console.log("[parse-total-fire-ban] Parsing RFS fire danger data from archive...");
  const snapshot = await totalFireBanService.fetchCurrentSnapshot();

  console.log(`[parse-total-fire-ban] Area statuses: ${snapshot.areaStatuses.length}`);
  console.log(`[parse-total-fire-ban] Geo areas: ${snapshot.geoAreas.length}`);

  const data: ScrapeTotalFireBanData = { snapshot };

  const output = createStageOutput(
    SCRAPE_TOTAL_FIRE_BAN_STAGE,
    SCRAPE_TOTAL_FIRE_BAN_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.scrapeTotalFireBan, output);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Parse-total-fire-ban complete (${elapsedSeconds}s)`);

  if (snapshot.warnings.length) {
    console.log(`  Warnings: ${snapshot.warnings.length}`);
    for (const warning of snapshot.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main().catch((error) => {
  console.error("Fatal error in parse-total-fire-ban:");
  console.error(error);
  process.exit(1);
});
