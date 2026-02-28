/**
 * Pipeline Stage 3: Enrich closure notices with LLM impact analysis.
 *
 * Reads raw closure notices from the scrape-closures stage and runs them
 * through the ClosureImpactEnricher (OpenAI LLM analysis).
 *
 * Requires: data/pipeline/scrape-closures.json
 * Produces: data/pipeline/enriched-closures.json
 */
import { ClosureImpactEnricher } from "../services/closure-impact-enricher.js";
import {
  PIPELINE_PATHS,
  SCRAPE_CLOSURES_STAGE,
  SCRAPE_CLOSURES_VERSION,
  ENRICH_CLOSURES_STAGE,
  ENRICH_CLOSURES_VERSION,
  createStageOutput,
  type ScrapeClosuresData,
  type EnrichClosuresData
} from "../../shared/pipeline-types.js";
import { readPipelineFile, writePipelineFile } from "./pipeline-io.js";
import "dotenv/config";

const main = async () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Enrich Closures (LLM) ===\n");

  console.log("Loading scrape-closures data...");
  const closuresData = readPipelineFile<ScrapeClosuresData>(
    PIPELINE_PATHS.scrapeClosures,
    SCRAPE_CLOSURES_STAGE,
    SCRAPE_CLOSURES_VERSION
  );

  console.log(`[enrich-closures] ${closuresData.closures.length} closure notice(s) to enrich\n`);

  const enricher = new ClosureImpactEnricher({ verbose: true });
  const enrichedResult = await enricher.enrichNotices(closuresData.closures);

  const data: EnrichClosuresData = {
    closures: enrichedResult.notices,
    warnings: [...closuresData.warnings, ...enrichedResult.warnings]
  };

  const output = createStageOutput(
    ENRICH_CLOSURES_STAGE,
    ENRICH_CLOSURES_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.enrichedClosures, output);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Enrich-closures complete (${elapsedSeconds}s)`);
  console.log(`  Enriched notices: ${enrichedResult.notices.length}`);

  if (data.warnings.length) {
    console.log(`  Warnings: ${data.warnings.length}`);
    for (const warning of data.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main().catch((error) => {
  console.error("Fatal error in enrich-closures:");
  console.error(error);
  process.exit(1);
});
