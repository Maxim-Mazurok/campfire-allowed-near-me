import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { isCloudflareChallengeHtml } from "../apps/api/src/services/forestry-parser.js";

const ARTIFACT_DIRECTORY = process.env.SCRAPE_TEST_ARTIFACT_DIR ?? "scrape-artifacts";

const TARGETS = [
  {
    name: "forestry-fire-bans",
    url: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
    expectedPattern: /solid fuel fire ban|forest area/i,
  },
  {
    name: "forestry-forests-directory",
    url: "https://www.forestrycorporation.com.au/visiting/forests",
    expectedPattern: /facilit|state forests list|showing \d+ results/i,
  },
  {
    name: "forest-closures",
    url: "https://forestclosure.fcnsw.net",
    expectedPattern: /forest closures|closuredetails/i,
  },
  {
    name: "rfs-fire-danger-ratings",
    url: "https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2",
    expectedPattern: /fireWeatherArea|FireDangerMap/i,
  },
  {
    name: "rfs-fire-danger-geojson",
    url: "https://www.rfs.nsw.gov.au/_designs/geojson/fire-danger-ratings-geojson",
    expectedPattern: /FeatureCollection|features/i,
  },
];

interface TestResult {
  name: string;
  url: string;
  plainFetchSuccess: boolean;
  plainFetchStatusCode: number | null;
  plainFetchCloudflareBlocked: boolean;
  plainFetchContentLength: number | null;
  plainFetchMatchesExpected: boolean;
  plainFetchError: string | null;
  playwrightSuccess: boolean;
  playwrightCloudflareBlocked: boolean;
  playwrightContentLength: number | null;
  playwrightMatchesExpected: boolean;
  playwrightError: string | null;
}

const testPlainFetch = async (
  target: (typeof TARGETS)[number]
): Promise<{
  success: boolean;
  statusCode: number | null;
  cloudflareBlocked: boolean;
  contentLength: number | null;
  matchesExpected: boolean;
  error: string | null;
  html: string | null;
}> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(target.url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9",
      },
    });

    clearTimeout(timeoutId);

    const html = await response.text();
    const cloudflareBlocked = isCloudflareChallengeHtml(html);
    const matchesExpected = target.expectedPattern.test(html);

    return {
      success: response.ok,
      statusCode: response.status,
      cloudflareBlocked,
      contentLength: html.length,
      matchesExpected,
      error: response.ok ? null : `HTTP ${response.status}`,
      html,
    };
  } catch (error) {
    return {
      success: false,
      statusCode: null,
      cloudflareBlocked: false,
      contentLength: null,
      matchesExpected: false,
      error: error instanceof Error ? error.message : "Unknown error",
      html: null,
    };
  }
};

const testPlaywrightFetch = async (
  target: (typeof TARGETS)[number]
): Promise<{
  success: boolean;
  cloudflareBlocked: boolean;
  contentLength: number | null;
  matchesExpected: boolean;
  error: string | null;
  html: string | null;
}> => {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-AU",
    });

    const page = await context.newPage();

    try {
      await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      // Wait a bit for any Cloudflare challenge to resolve
      const startTime = Date.now();
      let html = await page.content();

      while (isCloudflareChallengeHtml(html) && Date.now() - startTime < 30_000) {
        await page.waitForTimeout(2_000);
        html = await page.content();
      }

      const cloudflareBlocked = isCloudflareChallengeHtml(html);
      const matchesExpected = target.expectedPattern.test(html);

      return {
        success: !cloudflareBlocked && matchesExpected,
        cloudflareBlocked,
        contentLength: html.length,
        matchesExpected,
        error: null,
        html,
      };
    } finally {
      await page.close();
      await context.close();
    }
  } catch (error) {
    return {
      success: false,
      cloudflareBlocked: false,
      contentLength: null,
      matchesExpected: false,
      error: error instanceof Error ? error.message : "Unknown error",
      html: null,
    };
  } finally {
    await browser.close();
  }
};

const main = async () => {
  mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });

  console.log("=== Scrape Test ===\n");
  console.log(`Testing ${TARGETS.length} targets...\n`);

  const results: TestResult[] = [];

  for (const target of TARGETS) {
    console.log(`--- ${target.name} ---`);
    console.log(`URL: ${target.url}\n`);

    // Test plain fetch
    console.log("  Testing plain fetch...");
    const plainResult = await testPlainFetch(target);
    console.log(`    Status: ${plainResult.statusCode ?? "N/A"}`);
    console.log(`    Success: ${plainResult.success}`);
    console.log(`    Cloudflare blocked: ${plainResult.cloudflareBlocked}`);
    console.log(`    Content length: ${plainResult.contentLength ?? "N/A"}`);
    console.log(`    Matches expected pattern: ${plainResult.matchesExpected}`);
    if (plainResult.error) {
      console.log(`    Error: ${plainResult.error}`);
    }

    if (plainResult.html) {
      writeFileSync(
        join(ARTIFACT_DIRECTORY, `${target.name}-plain-fetch.html`),
        plainResult.html
      );
    }

    // Test Playwright
    console.log("  Testing Playwright...");
    const playwrightResult = await testPlaywrightFetch(target);
    console.log(`    Success: ${playwrightResult.success}`);
    console.log(`    Cloudflare blocked: ${playwrightResult.cloudflareBlocked}`);
    console.log(`    Content length: ${playwrightResult.contentLength ?? "N/A"}`);
    console.log(`    Matches expected pattern: ${playwrightResult.matchesExpected}`);
    if (playwrightResult.error) {
      console.log(`    Error: ${playwrightResult.error}`);
    }

    if (playwrightResult.html) {
      writeFileSync(
        join(ARTIFACT_DIRECTORY, `${target.name}-playwright.html`),
        playwrightResult.html
      );
    }

    console.log("");

    results.push({
      name: target.name,
      url: target.url,
      plainFetchSuccess: plainResult.success,
      plainFetchStatusCode: plainResult.statusCode,
      plainFetchCloudflareBlocked: plainResult.cloudflareBlocked,
      plainFetchContentLength: plainResult.contentLength,
      plainFetchMatchesExpected: plainResult.matchesExpected,
      plainFetchError: plainResult.error,
      playwrightSuccess: playwrightResult.success,
      playwrightCloudflareBlocked: playwrightResult.cloudflareBlocked,
      playwrightContentLength: playwrightResult.contentLength,
      playwrightMatchesExpected: playwrightResult.matchesExpected,
      playwrightError: playwrightResult.error,
    });
  }

  // Summary
  console.log("\n=== Summary ===\n");
  console.log("| Target | Plain Fetch | Playwright | CF Blocked (plain) | CF Blocked (PW) |");
  console.log("|---|---|---|---|---|");

  for (const result of results) {
    const plainStatus = result.plainFetchSuccess ? "OK" : "FAIL";
    const playwrightStatus = result.playwrightSuccess ? "OK" : "FAIL";
    const plainCloudflare = result.plainFetchCloudflareBlocked ? "YES" : "no";
    const playwrightCloudflare = result.playwrightCloudflareBlocked ? "YES" : "no";

    console.log(
      `| ${result.name} | ${plainStatus} | ${playwrightStatus} | ${plainCloudflare} | ${playwrightCloudflare} |`
    );
  }

  // Save results JSON
  writeFileSync(
    join(ARTIFACT_DIRECTORY, "results.json"),
    JSON.stringify(results, null, 2)
  );

  console.log(`\nArtifacts saved to ${ARTIFACT_DIRECTORY}/`);

  // Exit with error if any Forestry targets failed with both methods
  const forestryTargets = results.filter(
    (result) =>
      result.name.startsWith("forestry") || result.name === "forest-closures"
  );

  const allForestryFailed = forestryTargets.every(
    (result) => !result.plainFetchSuccess && !result.playwrightSuccess
  );

  if (allForestryFailed && forestryTargets.length > 0) {
    console.log(
      "\nWARNING: All Forestry targets failed with both methods. Stealth plugin or proxies may be needed."
    );
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
