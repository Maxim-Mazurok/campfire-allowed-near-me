/**
 * Pipeline Stage 2b: Parse closure notices from raw HTML archive.
 *
 * Reads data/pipeline/raw-closure-pages.json (raw HTML from scrape stage).
 * Produces data/pipeline/scrape-closures.json (parsed closure notices).
 * No HTTP requests — purely offline parsing.
 */
import {
  parseClosureNoticesPage,
  parseClosureNoticeDetailPage,
  classifyClosureNoticeTags,
  isCloudflareChallengeHtml
} from "../services/forestry-parser.js";
import {
  PIPELINE_PATHS,
  SCRAPE_CLOSURES_STAGE,
  SCRAPE_CLOSURES_VERSION,
  createStageOutput,
  type ScrapeClosuresData
} from "../../shared/pipeline-types.js";
import { readRawPagesArchive, writePipelineFile } from "./pipeline-io.js";

/** Must match the default closuresUrl in ForestryScraper. */
const CLOSURES_LIST_URL = "https://forestclosure.fcnsw.net/indexframe";

const main = () => {
  const startTime = Date.now();
  console.log("=== Pipeline: Parse Closures (from raw HTML) ===\n");

  const archive = readRawPagesArchive(PIPELINE_PATHS.rawClosurePages);

  // --- Find closure list page ---
  const listEntry = archive.pages[CLOSURES_LIST_URL];
  if (!listEntry) {
    const availableUrls = Object.keys(archive.pages).join("\n  ");
    throw new Error(
      `Closure list page not found in archive for URL: ${CLOSURES_LIST_URL}\n` +
      `Available URLs:\n  ${availableUrls}`
    );
  }

  const closures = parseClosureNoticesPage(listEntry.html, listEntry.finalUrl);
  console.log(`[parse-closures] Parsed ${closures.length} closure notice(s) from list page`);

  // --- Parse detail pages for listing closures ---
  let detailSuccessCount = 0;
  let detailMissingCount = 0;
  let detailChallengeCount = 0;

  const closuresWithDetails = closures.map((closure) => {
    const detailEntry = archive.pages[closure.detailUrl];

    if (!detailEntry) {
      detailMissingCount += 1;
      return { ...closure, detailText: null };
    }

    if (isCloudflareChallengeHtml(detailEntry.html)) {
      detailChallengeCount += 1;
      return { ...closure, detailText: null };
    }

    const detailText = parseClosureNoticeDetailPage(detailEntry.html);
    const mergedTags = [...new Set([
      ...closure.tags,
      ...classifyClosureNoticeTags(detailText ?? "")
    ])];

    detailSuccessCount += 1;
    return { ...closure, detailText, tags: mergedTags };
  });

  console.log(`[parse-closures] Detail pages: ${detailSuccessCount} parsed, ${detailMissingCount} missing, ${detailChallengeCount} challenge-blocked`);

  // --- Build warnings ---
  const warnings: string[] = [];
  if (detailChallengeCount > 0) {
    warnings.push(`${detailChallengeCount} closure detail page(s) were blocked by anti-bot verification.`);
  }
  if (detailMissingCount > 0) {
    warnings.push(`${detailMissingCount} closure detail page(s) were not found in the raw archive.`);
  }

  const data: ScrapeClosuresData = {
    closures: closuresWithDetails,
    warnings
  };

  const output = createStageOutput(
    SCRAPE_CLOSURES_STAGE,
    SCRAPE_CLOSURES_VERSION,
    data
  );

  writePipelineFile(PIPELINE_PATHS.scrapeClosures, output);

  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✓ Parse-closures complete (${elapsedSeconds}s)`);

  if (warnings.length) {
    console.log(`  Warnings: ${warnings.length}`);
    for (const warning of warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }
};

main();
