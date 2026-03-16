/**
 * Multi-State Snapshot Assembler
 *
 * Runs all registered state providers and merges their PersistedForestPoint[]
 * results with the existing NSW snapshot (assembled by the main pipeline).
 *
 * Usage:
 *   tsx pipeline/state-providers/assemble-multi-state.ts
 *
 * Reads:   web/public/forests-snapshot.json  (NSW baseline)
 * Writes:  web/public/forests-snapshot.json  (merged, all states)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import "dotenv/config";
import type { PersistedSnapshot, PersistedForestPoint } from "../../shared/contracts.js";
import type { IStateProvider } from "./state-provider.js";
import { TasmaniaStateProvider } from "./tas/index.js";
import { VictoriaStateProvider } from "./vic/index.js";
import { QueenslandStateProvider } from "./qld/index.js";
import { SouthAustraliaStateProvider } from "./sa/index.js";
import { WesternAustraliaStateProvider } from "./wa/index.js";
import { NorthernTerritoryStateProvider } from "./nt/index.js";
import { AustralianCapitalTerritoryStateProvider } from "./act/index.js";
import { SNAPSHOT_OUTPUT_PATH } from "../scripts/pipeline-config.js";

// ---------------------------------------------------------------------------
// State provider registry
// Swap StubStateProvider for a real provider as each state is implemented.
// ---------------------------------------------------------------------------

const buildProviders = (): IStateProvider[] => [
  new VictoriaStateProvider(),
  new QueenslandStateProvider(),
  new SouthAustraliaStateProvider(),
  new WesternAustraliaStateProvider(),
  new TasmaniaStateProvider(),
  new NorthernTerritoryStateProvider(),
  new AustralianCapitalTerritoryStateProvider(),
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  console.log("\n=== Multi-State Snapshot Assembly ===\n");

  const snapshotPath = SNAPSHOT_OUTPUT_PATH;

  if (!existsSync(snapshotPath)) {
    console.error(`NSW baseline snapshot not found at ${snapshotPath}`);
    console.error("Run the main pipeline first: npm run generate:snapshot");
    process.exit(1);
  }

  // Read NSW baseline snapshot
  const baseline: PersistedSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
  console.log(`NSW baseline: ${baseline.forests.length} forests`);

  // Tag NSW entries with state field (backward compat — some may not have it)
  const nswPoints = baseline.forests.map((f) => ({
    ...f,
    state: f.state ?? ("NSW" as const),
  }));

  const allPoints: PersistedForestPoint[] = [...nswPoints];
  const allWarnings = [...baseline.warnings];

  // Run all state providers
  const providers = buildProviders();
  for (const provider of providers) {
    console.log(`\nRunning ${provider.stateName} (${provider.stateCode}) provider...`);
    try {
      const result = await provider.fetchPoints();
      console.log(`  → ${result.points.length} points, ${result.warnings.length} warnings`);
      allPoints.push(...result.points);
      allWarnings.push(...result.warnings);
    } catch (err) {
      const msg = `${provider.stateName} provider failed: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`  ERROR: ${msg}`);
      allWarnings.push(msg);
    }
  }

  // Write merged snapshot
  const merged: PersistedSnapshot = {
    ...baseline,
    forests: allPoints,
    warnings: allWarnings,
  };

  writeFileSync(snapshotPath, JSON.stringify(merged, null, 2), "utf8");
  console.log(`\n✓ Merged snapshot written: ${allPoints.length} total points across all states`);

  const byState: Record<string, number> = {};
  for (const p of allPoints) {
    const s = p.state ?? "NSW";
    byState[s] = (byState[s] ?? 0) + 1;
  }
  console.log("\nBreakdown by state:");
  for (const [state, count] of Object.entries(byState).sort()) {
    console.log(`  ${state}: ${count}`);
  }
};

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
