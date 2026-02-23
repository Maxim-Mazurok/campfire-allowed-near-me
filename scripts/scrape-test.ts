import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { chromium as stealthChromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { isCloudflareChallengeHtml } from "../apps/api/src/services/forestry-parser.js";

stealthChromium.use(StealthPlugin());

const ARTIFACT_DIRECTORY = process.env.SCRAPE_TEST_ARTIFACT_DIR ?? "scrape-artifacts";

const FORESTRY_TARGETS = [
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
];

const RFS_TARGETS = [
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

const ALL_TARGETS = [...FORESTRY_TARGETS, ...RFS_TARGETS];

type MethodName = "plain-fetch" | "playwright" | "playwright-stealth" | "playwright-stealth-headed";

interface MethodResult {
  method: MethodName;
  success: boolean;
  statusCode: number | null;
  cloudflareBlocked: boolean;
  contentLength: number | null;
  matchesExpected: boolean;
  error: string | null;
  html: string | null;
}

interface TargetResult {
  name: string;
  url: string;
  methods: MethodResult[];
}

const waitForCloudflareResolution = async (
  page: { content: () => Promise<string>; waitForTimeout: (timeout: number) => Promise<void> },
  maxWaitMs: number
): Promise<string> => {
  const startTime = Date.now();
  let html = await page.content();

  while (isCloudflareChallengeHtml(html) && Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(2_000);
    html = await page.content();
  }

  return html;
};

const testPlainFetch = async (
  target: (typeof ALL_TARGETS)[number]
): Promise<MethodResult> => {
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

    // Log response details for debugging
    console.log(`    [plain-fetch] HTTP ${response.status} ${response.url}`);
    const relevantHeaders = ["content-type", "server", "x-powered-by", "location", "cf-ray"];
    for (const header of relevantHeaders) {
      const value = response.headers.get(header);
      if (value) {
        console.log(`    [plain-fetch]   ${header}: ${value}`);
      }
    }

    const cloudflareBlocked = isCloudflareChallengeHtml(html);
    const matchesExpected = target.expectedPattern.test(html);

    return {
      method: "plain-fetch",
      success: response.ok && matchesExpected,
      statusCode: response.status,
      cloudflareBlocked,
      contentLength: html.length,
      matchesExpected,
      error: response.ok ? null : `HTTP ${response.status}`,
      html,
    };
  } catch (error) {
    return {
      method: "plain-fetch",
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

const testPlaywrightVariant = async (
  target: (typeof ALL_TARGETS)[number],
  method: MethodName,
  launchBrowser: () => Promise<import("playwright").Browser>
): Promise<MethodResult> => {
  let browser: import("playwright").Browser | null = null;

  try {
    browser = await launchBrowser();

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-AU",
      viewport: { width: 1920, height: 1080 },
      timezoneId: "Australia/Sydney",
    });

    const page = await context.newPage();

    try {
      const response = await page.goto(target.url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      if (response) {
        console.log(`    [${method}] HTTP ${response.status()} ${response.url()}`);
        const responseHeaders = response.headers();
        const relevantHeaders = ["content-type", "server", "x-powered-by", "location", "cf-ray"];
        for (const header of relevantHeaders) {
          if (responseHeaders[header]) {
            console.log(`    [${method}]   ${header}: ${responseHeaders[header]}`);
          }
        }
      }

      // For SPA-like sites, also wait for network to settle
      try {
        await page.waitForLoadState("networkidle", { timeout: 15_000 });
      } catch {
        // networkidle timeout is not fatal
      }

      const html = await waitForCloudflareResolution(page, 30_000);
      const cloudflareBlocked = isCloudflareChallengeHtml(html);
      const matchesExpected = target.expectedPattern.test(html);

      return {
        method,
        success: !cloudflareBlocked && matchesExpected,
        statusCode: null,
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
      method,
      success: false,
      statusCode: null,
      cloudflareBlocked: false,
      contentLength: null,
      matchesExpected: false,
      error: error instanceof Error ? error.message : "Unknown error",
      html: null,
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

const formatStatus = (result: MethodResult): string => {
  if (result.success) return "OK";
  if (result.cloudflareBlocked) return "CF-BLOCKED";
  if (result.error) return `FAIL(${result.error.slice(0, 30)})`;
  return "FAIL";
};

const logResponseBody = (result: MethodResult): void => {
  if (result.success) return;
  if (!result.html) return;

  const MAX_BODY_LOG = 2_000;
  const body = result.html.length > MAX_BODY_LOG
    ? `${result.html.slice(0, MAX_BODY_LOG)}\n... (truncated, ${result.html.length} bytes total)`
    : result.html;

  console.log(`    ── Response body ──`);
  for (const line of body.split("\n")) {
    console.log(`    │ ${line}`);
  }
  console.log(`    ──────────────────`);
};

const main = async () => {
  mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });

  console.log("=== Scrape Test (with stealth) ===\n");
  console.log(`Testing ${ALL_TARGETS.length} targets with 4 methods...\n`);

  const results: TargetResult[] = [];

  for (const target of ALL_TARGETS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Target: ${target.name}`);
    console.log(`URL: ${target.url}`);
    console.log("=".repeat(60));

    const methodResults: MethodResult[] = [];

    // Method 1: Plain fetch
    console.log("\n  [1/4] Plain fetch...");
    const plainResult = await testPlainFetch(target);
    methodResults.push(plainResult);
    console.log(`    → ${formatStatus(plainResult)} (${plainResult.contentLength ?? 0} bytes)`);
    logResponseBody(plainResult);

    if (plainResult.html) {
      writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-plain-fetch.html`), plainResult.html);
    }

    // Method 2: Standard Playwright (headless)
    console.log("  [2/4] Playwright (headless)...");
    const playwrightResult = await testPlaywrightVariant(
      target,
      "playwright",
      () => chromium.launch({ headless: true })
    );
    methodResults.push(playwrightResult);
    console.log(`    → ${formatStatus(playwrightResult)} (${playwrightResult.contentLength ?? 0} bytes)`);
    logResponseBody(playwrightResult);

    if (playwrightResult.html) {
      writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-playwright.html`), playwrightResult.html);
    }

    // Method 3: Playwright-extra with stealth (headless)
    console.log("  [3/4] Playwright + stealth (headless)...");
    const stealthResult = await testPlaywrightVariant(
      target,
      "playwright-stealth",
      () => stealthChromium.launch({ headless: true })
    );
    methodResults.push(stealthResult);
    console.log(`    → ${formatStatus(stealthResult)} (${stealthResult.contentLength ?? 0} bytes)`);
    logResponseBody(stealthResult);

    if (stealthResult.html) {
      writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-stealth.html`), stealthResult.html);
    }

    // Method 4: Playwright-extra with stealth (headed via xvfb)
    console.log("  [4/4] Playwright + stealth (headed/xvfb)...");
    const headedStealthResult = await testPlaywrightVariant(
      target,
      "playwright-stealth-headed",
      () => stealthChromium.launch({ headless: false })
    );
    methodResults.push(headedStealthResult);
    console.log(`    → ${formatStatus(headedStealthResult)} (${headedStealthResult.contentLength ?? 0} bytes)`);
    logResponseBody(headedStealthResult);

    if (headedStealthResult.html) {
      writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-stealth-headed.html`), headedStealthResult.html);
    }

    results.push({
      name: target.name,
      url: target.url,
      methods: methodResults,
    });
  }

  // Summary table
  console.log("\n\n=== Summary ===\n");
  console.log("| Target | Plain Fetch | Playwright | Stealth | Stealth+Headed |");
  console.log("|---|---|---|---|---|");

  for (const result of results) {
    const statuses = result.methods.map(formatStatus);
    console.log(`| ${result.name} | ${statuses.join(" | ")} |`);
  }

  // Save results JSON (without html content for smaller file)
  const jsonResults = results.map((result) => ({
    ...result,
    methods: result.methods.map(({ html: _html, ...rest }) => rest),
  }));

  writeFileSync(
    join(ARTIFACT_DIRECTORY, "results.json"),
    JSON.stringify(jsonResults, null, 2)
  );

  console.log(`\nArtifacts saved to ${ARTIFACT_DIRECTORY}/`);

  // Determine overall outcome
  const forestryResults = results.filter(
    (result) => result.name.startsWith("forestry") || result.name === "forest-closures"
  );

  const anyForestryMethodWorked = forestryResults.some((result) =>
    result.methods.some((method) => method.success)
  );

  if (!anyForestryMethodWorked && forestryResults.length > 0) {
    console.log(
      "\nWARNING: No method succeeded for any Forestry target. Residential proxies may be needed."
    );
    console.log("Consider:");
    console.log("  1. Using a residential proxy service (Bright Data, IPRoyal, etc.)");
    console.log("  2. Running the scraper on a self-hosted runner with a residential IP");
    console.log("  3. Switching to a manual/local scrape + commit workflow");
    process.exit(1);
  }

  if (anyForestryMethodWorked) {
    const workingMethods = forestryResults
      .flatMap((result) => result.methods.filter((method) => method.success))
      .map((method) => method.method);
    const uniqueMethods = [...new Set(workingMethods)];
    console.log(`\nSUCCESS: Working methods for Forestry targets: ${uniqueMethods.join(", ")}`);
  }
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
