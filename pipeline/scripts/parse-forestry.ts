/**
 * Pipeline Stage 2a: Parse Forestry pages from raw HTML archive.
 *
 * Reads data/pipeline/raw-forestry-pages.json (raw HTML from scrape stage).
 * Produces data/pipeline/scrape-forestry.json (parsed areas + directory).
 * No HTTP requests — purely offline parsing.
 */
import {
  parseMainFireBanPage,
  parseAreaForestNames,
  isCloudflareChallengeHtml,
  parseForestDirectoryWithFacilities
} from "../services/forestry-parser.js";
import type { ForestDirectorySnapshot } from "../../shared/contracts.js";
import {
  PIPELINE_PATHS,
  SCRAPE_FORESTRY_STAGE,
  SCRAPE_FORESTRY_VERSION,
  createStageOutput,
  type ScrapeForestryData,
  type RawPagesArchive
} from "../../shared/pipeline-types.js";
import { readRawPagesArchive, writePipelineFile } from "./pipeline-io.js";

/** Must match the default entryUrl in ForestryScraper. */
const MAIN_FIRE_BAN_URL = "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";

/** Must match the default forestsDirectoryUrl in ForestryScraper. */
const DIRECTORY_URL = "https://www.forestrycorporation.com.au/visiting/forests";

/** The scraper tries multiple URL variants for the directory. */
const DIRECTORY_URL_VARIANTS = [
  DIRECTORY_URL,
  DIRECTORY_URL.replace("/visiting/", "/visit/"),
  DIRECTORY_URL.replace("/visit/", "/visiting/")
].filter((value, index, list) => list.indexOf(value) === index);

const findPageInArchive = (
  archive: RawPagesArchive,
  urls: string[]
): { html: string; url: string } | null => {
  for (const url of urls) {
    const entry = archive.pages[url];
    if (entry && !isCloudflareChallengeHtml(entry.html)) {
      return { html: entry.html, url: entry.finalUrl };
    }
  }
  return null;
};

const buildEmptyDirectorySnapshot = (warning?: string): ForestDirectorySnapshot => ({
  filters: [],
  forests: [],
  warnings: warning ? [warning] : []
});

const main = () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Parse Forestry (from raw HTML) ===\n");

  const archive = readRawPagesArchive(PIPELINE_PATHS.rawForestryPages);
  const warnings: string[] = [];

  // --- Parse fire ban areas ---
  const mainPage = findPageInArchive(archive, [MAIN_FIRE_BAN_URL]);
  if (!mainPage) {
    const availableUrls = Object.keys(archive.pages).join("\n  ");
    throw new Error(
      `Main fire ban page not found in archive for URL: ${MAIN_FIRE_BAN_URL}\n` +
      `Available URLs:\n  ${availableUrls}`
    );
  }

  const areas = parseMainFireBanPage(mainPage.html, mainPage.url);
  console.log(`[parse-forestry] Parsed ${areas.length} fire ban area(s)`);

  if (!areas.length) {
    throw new Error("No fire ban areas were parsed from the main Forestry page.");
  }

  let missingAreaPageCount = 0;
  const areasWithForests = areas.map((area) => {
    const areaEntry = archive.pages[area.areaUrl];
    if (!areaEntry) {
      missingAreaPageCount += 1;
      return { ...area, forests: [] as string[] };
    }
    const forests = parseAreaForestNames(areaEntry.html);
    return { ...area, forests };
  });

  const totalForests = areasWithForests.reduce(
    (count, area) => count + area.forests.length, 0
  );
  console.log(`[parse-forestry] Found ${totalForests} forest entries across areas`);

  if (missingAreaPageCount > 0) {
    warnings.push(`${missingAreaPageCount} area page(s) were not found in the raw archive.`);
  }

  // --- Parse directory ---
  const directoryPage = findPageInArchive(archive, DIRECTORY_URL_VARIANTS);
  let directory: ForestDirectorySnapshot;

  if (!directoryPage) {
    console.log("[parse-forestry] ⚠ Directory page not found in archive");
    directory = buildEmptyDirectorySnapshot(
      "Could not find Forestry forests facilities page in raw archive; facilities filters are temporarily unavailable."
    );
  } else {
    directory = parseForestDirectoryWithFacilities(directoryPage.html);
    if (!directory.filters.length && !directory.forests.length) {
      directory = buildEmptyDirectorySnapshot(
        "No facilities or forests were parsed from the Forestry forests directory page."
      );
    }
  }

  console.log(`[parse-forestry] Directory: ${directory.forests.length} forest(s), ${directory.filters.length} filter(s)`);
  warnings.push(...directory.warnings);

  // --- Write output ---
  const data: ScrapeForestryData = {
    areas: areasWithForests,
    directory,
    warnings
  };

  const output = createStageOutput(
    SCRAPE_FORESTRY_STAGE,
    SCRAPE_FORESTRY_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.scrapeForestry, output);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Parse-forestry complete (${elapsedSeconds}s)`);

  if (warnings.length) {
    console.log(`  Warnings: ${warnings.length}`);
    for (const warning of warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main();
