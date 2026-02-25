/**
 * Forest Snapshot Generator — pipeline orchestrator.
 *
 * Runs all pipeline stages in sequence:
 *   1a. scrape-forestry    — fire ban pages + directory (browser + proxy)
 *   1b. scrape-closures    — FCNSW closure notices (fetch + proxy)
 *   1c. scrape-total-fire-ban — RFS TFB data (plain fetch)
 *   2.  geocode-forests    — resolve coordinates (Nominatim + Google)
 *   3.  enrich-closures    — LLM impact analysis (OpenAI)
 *   4.  assemble-snapshot  — combine everything into forests-snapshot.json
 *
 * Each stage produces a JSON checkpoint in data/pipeline/, so individual
 * stages can be re-run independently via:
 *   npx -y tsx scripts/pipeline/<stage-name>.ts
 *
 * This orchestrator simply imports and calls each stage's main() in order.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import "dotenv/config";

// ---------------------------------------------------------------------------
// Stage scripts (in execution order)
// ---------------------------------------------------------------------------

const STAGE_SCRIPTS = [
  { label: "1a. Scrape Forestry", script: "scripts/pipeline/scrape-forestry.ts" },
  { label: "1b. Scrape Closures", script: "scripts/pipeline/scrape-closures.ts" },
  { label: "1c. Scrape Total Fire Ban", script: "scripts/pipeline/scrape-total-fire-ban.ts" },
  { label: "2.  Geocode Forests", script: "scripts/pipeline/geocode-forests.ts" },
  { label: "3.  Enrich Closures", script: "scripts/pipeline/enrich-closures.ts" },
  { label: "4.  Assemble Snapshot", script: "scripts/pipeline/assemble-snapshot.ts" }
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = () => {
  const startTime = Date.now();
  console.log("=== Forest Snapshot Generator (pipeline orchestrator) ===\n");

  for (const stage of STAGE_SCRIPTS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Stage: ${stage.label}`);
    console.log(`${"=".repeat(60)}\n`);

    const scriptPath = resolve(stage.script);

    try {
      execFileSync("npx", ["-y", "tsx", scriptPath], {
        stdio: "inherit",
        env: process.env
      });
    } catch (error) {
      console.error(`\n✗ Stage "${stage.label}" failed.`);
      if (error instanceof Error && "status" in error) {
        process.exit((error as NodeJS.ErrnoException & { status: number }).status ?? 1);
      }
      process.exit(1);
    }
  }

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  All stages completed in ${elapsedSeconds}s`);
  console.log(`${"=".repeat(60)}\n`);
};

main();
