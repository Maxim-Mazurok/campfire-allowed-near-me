import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isCloudflareChallengeHtml } from "../apps/api/src/services/forestry-parser.js";

const ARTIFACT_DIRECTORY = process.env.SCRAPE_TEST_ARTIFACT_DIR ?? "scrape-artifacts";

const PROXY_USERNAME = process.env.PROXY_USERNAME ?? "";
const PROXY_PASSWORD = process.env.PROXY_PASSWORD ?? "";
const PROXY_HOST = process.env.PROXY_HOST ?? "au.decodo.com";
const PROXY_PORT = process.env.PROXY_PORT ?? "30000";

const hasProxy = Boolean(PROXY_USERNAME && PROXY_PASSWORD);

const TARGETS = [
  {
    name: "forestry-fire-bans",
    url: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
    expectedPattern: /solid fuel fire ban|forest area/i,
    needsProxy: true,
  },
  {
    name: "forestry-forests-directory",
    url: "https://www.forestrycorporation.com.au/visiting/forests",
    expectedPattern: /facilit|state forests list|showing \d+ results/i,
    needsProxy: true,
  },
  {
    name: "forest-closures",
    url: "https://forestclosure.fcnsw.net",
    expectedPattern: /forest closures|closuredetails/i,
    needsProxy: true,
  },
  {
    name: "rfs-fire-danger-ratings",
    url: "https://www.rfs.nsw.gov.au/_designs/xml/fire-danger-ratings/fire-danger-ratings-v2",
    expectedPattern: /fireWeatherArea|FireDangerMap/i,
    needsProxy: false,
  },
  {
    name: "rfs-fire-danger-geojson",
    url: "https://www.rfs.nsw.gov.au/_designs/geojson/fire-danger-ratings-geojson",
    expectedPattern: /FeatureCollection|features/i,
    needsProxy: false,
  },
];

type MethodName = "direct-fetch" | "proxy-fetch";

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

const logHeaders = (label: string, status: number, url: string, headers: Headers): void => {
  console.log(`    [${label}] HTTP ${status} ${url}`);
  const relevantHeaders = ["content-type", "server", "x-powered-by", "location", "cf-ray"];
  for (const header of relevantHeaders) {
    const value = headers.get(header);
    if (value) {
      console.log(`    [${label}]   ${header}: ${value}`);
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
    logHeaders("direct-fetch", response.status, response.url, response.headers);

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
      // @ts-expect-error -- Node.js 25 supports undici proxy dispatcher via env or agent
      dispatcher: await createProxyDispatcher(proxyUrl),
    });

    clearTimeout(timeoutId);
    const html = await response.text();
    logHeaders("proxy-fetch", response.status, response.url, response.headers);

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

const createProxyDispatcher = async (proxyUrl: string) => {
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxyUrl);
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

  const methodCount = hasProxy ? 2 : 1;
  console.log(`Testing ${TARGETS.length} targets with ${methodCount} method(s)...\n`);

  const results: TargetResult[] = [];

  for (const target of TARGETS) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Target: ${target.name}`);
    console.log(`URL: ${target.url}`);
    console.log("=".repeat(60));

    const methodResults: MethodResult[] = [];

    // Method 1: Direct fetch (no proxy)
    console.log("\n  [1] Direct fetch...");
    const directResult = await testDirectFetch(target);
    methodResults.push(directResult);
    console.log(`    → ${formatStatus(directResult)} (${directResult.contentLength ?? 0} bytes)`);
    logResponseBody(directResult);

    if (directResult.html) {
      writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-direct.html`), directResult.html);
    }

    // Method 2: Proxy fetch (only for targets that need it, and only if proxy is configured)
    if (hasProxy && target.needsProxy) {
      console.log("  [2] Proxy fetch (residential)...");
      const proxyResult = await testProxyFetch(target);
      methodResults.push(proxyResult);
      console.log(`    → ${formatStatus(proxyResult)} (${proxyResult.contentLength ?? 0} bytes)`);
      logResponseBody(proxyResult);

      if (proxyResult.html) {
        writeFileSync(join(ARTIFACT_DIRECTORY, `${target.name}-proxy.html`), proxyResult.html);
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

  if (hasProxy) {
    console.log("| Target | Direct | Proxy |");
    console.log("|---|---|---|");
  } else {
    console.log("| Target | Direct |");
    console.log("|---|---|");
  }

  for (const result of results) {
    const directStatus = formatStatus(result.methods[0]);
    if (hasProxy && result.methods.length > 1) {
      const proxyStatus = formatStatus(result.methods[1]);
      console.log(`| ${result.name} | ${directStatus} | ${proxyStatus} |`);
    } else {
      console.log(`| ${result.name} | ${directStatus} |`);
    }
  }

  // Save results JSON
  const jsonResults = results.map((result) => ({
    ...result,
    methods: result.methods.map(({ html: _html, ...rest }) => rest),
  }));

  writeFileSync(join(ARTIFACT_DIRECTORY, "results.json"), JSON.stringify(jsonResults, null, 2));
  console.log(`\nArtifacts saved to ${ARTIFACT_DIRECTORY}/`);

  // Determine overall outcome
  const forestryTargets = results.filter(
    (result) => TARGETS.find((target) => target.name === result.name)?.needsProxy
  );

  const allProxyTargetsSucceeded = forestryTargets.every((result) =>
    result.methods.some((method) => method.success)
  );

  if (hasProxy) {
    if (allProxyTargetsSucceeded) {
      console.log("\nSUCCESS: All proxy-dependent targets succeeded!");
    } else {
      const failedTargets = forestryTargets
        .filter((result) => !result.methods.some((method) => method.success))
        .map((result) => result.name);
      console.log(`\nWARNING: Some targets still failed with proxy: ${failedTargets.join(", ")}`);
      process.exit(1);
    }
  } else {
    const directFailures = forestryTargets.filter(
      (result) => !result.methods[0].success
    );
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
