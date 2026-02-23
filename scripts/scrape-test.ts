import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { isCloudflareChallengeHtml } from "../apps/api/src/services/forestry-parser.js";

chromium.use(StealthPlugin());

const ARTIFACT_DIRECTORY = process.env.SCRAPE_TEST_ARTIFACT_DIR ?? "scrape-artifacts";

const PROXY_USERNAME = process.env.PROXY_USERNAME ?? "";
const PROXY_PASSWORD = process.env.PROXY_PASSWORD ?? "";
const PROXY_HOST = process.env.PROXY_HOST ?? "au.decodo.com";
const PROXY_PORT = process.env.PROXY_PORT ?? "30000";

const hasProxy = Boolean(PROXY_USERNAME && PROXY_PASSWORD);

/**
 * needsBrowser: true = Cloudflare JS challenge, requires a browser to solve
 * needsProxy: true = IP-blocked, requires residential proxy to bypass
 */
const TARGETS = [
  {
    name: "forestry-fire-bans",
    url: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
    expectedPattern: /solid fuel fire ban|forest area/i,
    needsProxy: true,
    needsBrowser: true,
  },
  {
    name: "forestry-forests-directory",
    url: "https://www.forestrycorporation.com.au/visiting/forests",
    expectedPattern: /facilit|state forests list|showing \d+ results/i,
    needsProxy: true,
    needsBrowser: true,
  },
  {
    name: "forest-closures",
    url: "https://forestclosure.fcnsw.net",
    expectedPattern: /forest closures|closuredetails/i,
    needsProxy: true,
    needsBrowser: false,
  },
  {
    name: "rfs-fire-danger-ratings",
    url: "https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2",
    expectedPattern: /fireWeatherArea|FireDangerMap/i,
    needsProxy: false,
    needsBrowser: false,
  },
  {
    name: "rfs-fire-danger-geojson",
    url: "https://www.rfs.nsw.gov.au/_designs/geojson/fire-danger-ratings-geojson",
    expectedPattern: /FeatureCollection|features/i,
    needsProxy: false,
    needsBrowser: false,
  },
];

type MethodName = "direct-fetch" | "proxy-fetch" | "proxy-browser";

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

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
};

const logFetchHeaders = (label: string, status: number, url: string, headers: Headers): void => {
  console.log(`    [${label}] HTTP ${status} ${url}`);
  const relevantHeaders = ["content-type", "server", "x-powered-by", "location", "cf-ray"];
  for (const header of relevantHeaders) {
    const value = headers.get(header);
    if (value) {
      console.log(`    [${label}]   ${header}: ${value}`);
    }
  }
};

const logPlaywrightHeaders = (
  label: string,
  response: import("playwright").Response
): void => {
  console.log(`    [${label}] HTTP ${response.status()} ${response.url()}`);
  const responseHeaders = response.headers();
  const relevantHeaders = ["content-type", "server", "x-powered-by", "location", "cf-ray"];
  for (const header of relevantHeaders) {
    if (responseHeaders[header]) {
      console.log(`    [${label}]   ${header}: ${responseHeaders[header]}`);
    }
  }
};

const logResponseBody = (result: MethodResult): void => {
  if (result.success) return;
  if (!result.html) return;

  const MAX_BODY_LOG = 2_000;
  const body =
    result.html.length > MAX_BODY_LOG
      ? `${result.html.slice(0, MAX_BODY_LOG)}\n... (truncated, ${result.html.length} bytes total)`
      : result.html;

  console.log("    ── Response body ──");
  for (const line of body.split("\n")) {
    console.log(`    │ ${line}`);
  }
  console.log("    ──────────────────");
};

const waitForCloudflareResolution = async (
  page: { content: () => Promise<string>; waitForTimeout: (timeout: number) => Promise<void> },
  maxWaitMilliseconds: number
): Promise<string> => {
  const startTime = Date.now();
  let html = await page.content();

  while (isCloudflareChallengeHtml(html) && Date.now() - startTime < maxWaitMilliseconds) {
    await page.waitForTimeout(2_000);
    html = await page.content();
  }

  return html;
};

const testDirectFetch = async (
  target: (typeof TARGETS)[number]
): Promise<MethodResult> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(target.url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
    });

    clearTimeout(timeoutId);
    const html = await response.text();
    logFetchHeaders("direct-fetch", response.status, response.url, response.headers);

    const cloudflareBlocked = isCloudflareChallengeHtml(html);
    const matchesExpected = target.expectedPattern.test(html);

    return {
      method: "direct-fetch",
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
      method: "direct-fetch",
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

const createProxyDispatcher = async (proxyUrl: string) => {
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxyUrl);
};

const testProxyFetch = async (
  target: (typeof TARGETS)[number]
): Promise<MethodResult> => {
  try {
    const proxyUrl = `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${PROXY_PORT}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    const response = await fetch(target.url, {
      signal: controller.signal,
      headers: BROWSER_HEADERS,
      // @ts-expect-error -- Node.js undici supports proxy dispatcher
      dispatcher: await createProxyDispatcher(proxyUrl),
    });

    clearTimeout(timeoutId);
    const html = await response.text();
    logFetchHeaders("proxy-fetch", response.status, response.url, response.headers);

    const cloudflareBlocked = isCloudflareChallengeHtml(html);
    const matchesExpected = target.expectedPattern.test(html);

    return {
      method: "proxy-fetch",
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
      method: "proxy-fetch",
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

const testProxyBrowser = async (
  target: (typeof TARGETS)[number]
): Promise<MethodResult> => {
  let browser: import("playwright").Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: false, // headed mode helps bypass Cloudflare
      args: ["--no-sandbox"],
    });

    const context = await browser.newContext({
      proxy: {
        server: `http://${PROXY_HOST}:${PROXY_PORT}`,
        username: PROXY_USERNAME,
        password: PROXY_PASSWORD,
      },
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
        logPlaywrightHeaders("proxy-browser", response);
      }

      // Wait for network to settle (SPA/JS-rendered content)
      try {
        await page.waitForLoadState("networkidle", { timeout: 15_000 });
      } catch {
        // networkidle timeout is not fatal
      }

      const html = await waitForCloudflareResolution(page, 30_000);
      const cloudflareBlocked = isCloudflareChallengeHtml(html);
      const matchesExpected = target.expectedPattern.test(html);

      return {
        method: "proxy-browser",
        success: !cloudflareBlocked && matchesExpected,
        statusCode: response?.status() ?? null,
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
      method: "proxy-browser",
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

const main = async () => {
  mkdirSync(ARTIFACT_DIRECTORY, { recursive: true });

  console.log("=== Scrape Test ===\n");
  console.log(`Proxy configured: ${hasProxy ? "YES" : "NO"}`);
  if (hasProxy) {
    console.log(`Proxy endpoint: ${PROXY_HOST}:${PROXY_PORT}`);
  }
  console.log();

  const results: TargetResult[] = [];

  for (const target of TARGETS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Target: ${target.name}`);
    console.log(`URL: ${target.url}`);
    console.log(`Needs: ${[target.needsProxy && "proxy", target.needsBrowser && "browser"].filter(Boolean).join(" + ") || "nothing special"}`);
    console.log("=".repeat(60));

    const methodResults: MethodResult[] = [];

    // Method 1: Direct fetch (always run as baseline)
    console.log("\n  [1] Direct fetch...");
    const directResult = await testDirectFetch(target);
    methodResults.push(directResult);
    console.log(`    → ${formatStatus(directResult)} (${directResult.contentLength ?? 0} bytes)`);
    logResponseBody(directResult);

    if (directResult.html) {
      writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-direct.html`), directResult.html);
    }

    // Method 2: Proxy fetch (for IP-blocked, non-browser targets)
    if (hasProxy && target.needsProxy && !target.needsBrowser) {
      console.log("  [2] Proxy fetch (residential)...");
      const proxyResult = await testProxyFetch(target);
      methodResults.push(proxyResult);
      console.log(`    → ${formatStatus(proxyResult)} (${proxyResult.contentLength ?? 0} bytes)`);
      logResponseBody(proxyResult);

      if (proxyResult.html) {
        writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-proxy.html`), proxyResult.html);
      }
    }

    // Method 3: Proxy + browser (for Cloudflare JS challenge targets)
    if (hasProxy && target.needsProxy && target.needsBrowser) {
      console.log("  [2] Proxy + browser (stealth, headed)...");
      const proxyBrowserResult = await testProxyBrowser(target);
      methodResults.push(proxyBrowserResult);
      console.log(`    → ${formatStatus(proxyBrowserResult)} (${proxyBrowserResult.contentLength ?? 0} bytes)`);
      logResponseBody(proxyBrowserResult);

      if (proxyBrowserResult.html) {
        writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-proxy-browser.html`), proxyBrowserResult.html);
      }
    }

    results.push({
      name: target.name,
      url: target.url,
      methods: methodResults,
    });
  }

  // Summary table
  console.log("\n\n=== Summary ===\n");
  console.log("| Target | Direct | Best Method |");
  console.log("|---|---|---|");

  for (const result of results) {
    const directStatus = formatStatus(result.methods[0]);
    const bestMethod = result.methods.find((method) => method.success);
    const bestStatus = bestMethod
      ? `OK (${bestMethod.method})`
      : result.methods.length > 1
        ? formatStatus(result.methods[result.methods.length - 1])
        : "—";
    console.log(`| ${result.name} | ${directStatus} | ${bestStatus} |`);
  }

  // Save results JSON
  const jsonResults = results.map((result) => ({
    ...result,
    methods: result.methods.map(({ html: _html, ...rest }) => rest),
  }));

  writeFileSync(join(ARTIFACT_DIRECTORY, "results.json"), JSON.stringify(jsonResults, null, 2));
  console.log(`\nArtifacts saved to ${ARTIFACT_DIRECTORY}/`);

  // Determine overall outcome
  const proxyTargets = results.filter(
    (result) => TARGETS.find((target) => target.name === result.name)?.needsProxy
  );

  const allProxyTargetsSucceeded = proxyTargets.every((result) =>
    result.methods.some((method) => method.success)
  );

  if (hasProxy) {
    if (allProxyTargetsSucceeded) {
      console.log("\nSUCCESS: All targets succeeded!");
    } else {
      const failedTargets = proxyTargets
        .filter((result) => !result.methods.some((method) => method.success))
        .map((result) => result.name);
      console.log(`\nFAILURE: These targets still failed: ${failedTargets.join(", ")}`);
      process.exit(1);
    }
  } else {
    const directFailures = proxyTargets.filter((result) => !result.methods[0].success);
    if (directFailures.length > 0) {
      console.log("\nINFO: Some targets blocked without proxy (expected from datacenter IPs):");
      for (const failure of directFailures) {
        console.log(`  - ${failure.name}`);
      }
      console.log("Set PROXY_USERNAME and PROXY_PASSWORD to test with residential proxy.");
    }
  }
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
