/**
 * Minimal smoke test: opens a single Cloudflare-protected page via proxy
 * to verify the stealth browser + proxy pipeline works in CI.
 *
 * Usage: PROXY_USERNAME=... PROXY_PASSWORD=... npx -y tsx scripts/scrape-smoke.ts
 */
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { isCloudflareChallengeHtml } from "../apps/api/src/services/forestry-parser.js";
import { installResourceBlockingRoutes } from "../apps/api/src/utils/resource-blocking.js";

// Suppress playwright-extra CDP session race (page closed before CDP resolves)
process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes("Target page, context or browser has been closed")) {
    console.warn("[playwright-extra] Suppressed CDP session race.");
    return;
  }
  throw reason;
});

chromium.use(StealthPlugin());

const PROXY_USERNAME = process.env.PROXY_USERNAME ?? "";
const PROXY_PASSWORD = process.env.PROXY_PASSWORD ?? "";
const PROXY_HOST = process.env.PROXY_HOST ?? "au.decodo.com";
const PROXY_PORT = process.env.PROXY_PORT ?? "30001";

const TARGET_URL =
  "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const EXPECTED_PATTERN = /solid fuel fire ban|forest area/i;

const isRunningInCI = Boolean(process.env.CI);
const hasProxy = isRunningInCI && Boolean(PROXY_USERNAME && PROXY_PASSWORD);
if (!isRunningInCI && PROXY_USERNAME) {
  console.log("⚠ Proxy credentials found but CI env not detected — skipping proxy (local run).");
}

const main = async () => {
  console.log("=== Scrape Smoke Test ===");
  console.log(`Proxy: ${hasProxy ? `${PROXY_HOST}:${PROXY_PORT}` : "none"}`);
  console.log(`Target: ${TARGET_URL}`);
  console.log("");

  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: false,
    args: ["--no-sandbox"]
  };

  console.log("[1] Launching browser...");
  const browser = await chromium.launch(launchOptions);

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-AU",
    viewport: { width: 1920, height: 1080 },
    timezoneId: "Australia/Sydney",
    ...(hasProxy
      ? {
          proxy: {
            server: `http://${PROXY_HOST}:${PROXY_PORT}`,
            username: PROXY_USERNAME,
            password: PROXY_PASSWORD
          }
        }
      : {})
  };

  const context = await browser.newContext(contextOptions);
  await installResourceBlockingRoutes(context, (message) => console.log(`  ${message}`));
  const page = await context.newPage();

  try {
    // Capture HTTP responses before navigation errors hide them
    page.on("response", (interceptedResponse) => {
      console.log(`  [response] ${interceptedResponse.status()} ${interceptedResponse.url().slice(0, 100)}`);
    });

    // Try a simple page first to test proxy connectivity
    console.log("[2] Testing proxy connectivity with httpbin...");
    try {
      const probeResponse = await page.goto("https://httpbin.org/ip", {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      });
      const probeContent = await page.content();
      console.log(`[2] Proxy probe: HTTP ${probeResponse?.status() ?? "?"} (${probeContent.length} bytes)`);
      const ipMatch = probeContent.match(/"origin":\s*"([^"]+)"/);
      if (ipMatch) console.log(`[2] Proxy IP: ${ipMatch[1]}`);
    } catch (probeError) {
      console.log(`[2] Proxy probe failed: ${probeError instanceof Error ? probeError.message : probeError}`);
      console.log("[2] Proxy may be down or credentials may be wrong.");
    }

    console.log("[3] Navigating to target...");
    const startTime = Date.now();

    let response: Awaited<ReturnType<typeof page.goto>> = null;
    const maxNavigationRetries = 3;
    for (let navigationAttempt = 0; navigationAttempt < maxNavigationRetries; navigationAttempt++) {
      try {
        response = await page.goto(TARGET_URL, {
          waitUntil: "domcontentloaded",
          timeout: 90_000
        });
        break; // success
      } catch (navigationError) {
        const message = navigationError instanceof Error ? navigationError.message : String(navigationError);
        if (message.includes("ERR_HTTP_RESPONSE_CODE_FAILURE")) {
          console.log(`[3] Attempt ${navigationAttempt + 1}: ERR_HTTP_RESPONSE_CODE_FAILURE`);
          if (navigationAttempt < maxNavigationRetries - 1) {
            console.log(`[3] Waiting 10s before retrying...`);
            await page.waitForTimeout(10_000);
            continue;
          }
          console.log("✗ FAILED — all navigation attempts got ERR_HTTP_RESPONSE_CODE_FAILURE");
          process.exitCode = 1;
          return;
        }
        throw navigationError;
      }
    }

    const navigationTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[3] Navigation done in ${navigationTime}s`);

    if (response) {
      console.log(`[3] HTTP ${response.status()} ${response.url()}`);
      const responseHeaders = response.headers();
      for (const headerName of ["content-type", "server", "cf-ray", "cf-cache-status"]) {
        if (responseHeaders[headerName]) {
          console.log(`[3]   ${headerName}: ${responseHeaders[headerName]}`);
        }
      }
    }

    // Wait for networkidle
    console.log("[4] Waiting for networkidle...");
    try {
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      console.log("[4] networkidle reached");
    } catch {
      console.log("[4] networkidle timeout (non-fatal)");
    }

    // Poll for Cloudflare resolution
    console.log("[5] Polling for content readiness...");
    const pollStart = Date.now();
    let html = await page.content();
    let pollCount = 0;
    const maxPollTimeMs = 90_000;

    while (Date.now() - pollStart < maxPollTimeMs) {
      pollCount += 1;
      html = await page.content();
      const isCloudflare = isCloudflareChallengeHtml(html);
      const bodyMatch = EXPECTED_PATTERN.test(html);
      const elapsedSeconds = ((Date.now() - pollStart) / 1000).toFixed(1);

      console.log(
        `[5] Poll #${pollCount} (${elapsedSeconds}s): ` +
          `CF=${isCloudflare}, bodyLen=${html.length}, patternMatch=${bodyMatch}`
      );

      if (!isCloudflare && bodyMatch) {
        console.log(`\n✓ SUCCESS — page loaded in ${elapsedSeconds}s`);
        console.log(`  Body length: ${html.length}`);
        console.log(`  Pattern matched: ${EXPECTED_PATTERN}`);
        // Print first 500 chars of visible text
        const textSnippet = html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500);
        console.log(`  Text snippet: ${textSnippet.slice(0, 200)}...`);
        return;
      }

      if (!isCloudflare && /<body/i.test(html) && html.length > 5000) {
        console.log(
          `\n⚠ Page loaded but pattern not matched (${html.length} bytes)`
        );
        const textSnippet = html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500);
        console.log(`  Text snippet: ${textSnippet.slice(0, 300)}...`);
        return;
      }

      await page.waitForTimeout(2000);
    }

    // Timed out
    const isCloudflare = isCloudflareChallengeHtml(html);
    const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✗ FAILED after ${totalSeconds}s`);
    console.log(`  Cloudflare blocked: ${isCloudflare}`);
    console.log(`  Body length: ${html.length}`);

    if (html.length < 3000) {
      console.log("  Full HTML:");
      console.log(html);
    } else {
      console.log(`  First 1000 chars:`);
      console.log(html.slice(0, 1000));
    }

    process.exitCode = 1;
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    console.log("\n[cleanup] Browser closed.");
  }
};

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
