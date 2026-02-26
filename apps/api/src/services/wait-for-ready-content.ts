import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { isCloudflareChallengeHtml } from "./forestry-parser.js";

/**
 * Save a timestamped screenshot for Turnstile debugging.
 * Silently swallows errors so it never breaks the scrape flow.
 */
const saveTurnstileScreenshot = async (
  page: Page,
  debugArtifactDirectory: string | null,
  suffix: string,
  log: (message: string) => void
): Promise<void> => {
  if (!debugArtifactDirectory) return;
  try {
    if (!existsSync(debugArtifactDirectory)) {
      mkdirSync(debugArtifactDirectory, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = join(debugArtifactDirectory, `${timestamp}_turnstile-${suffix}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    log(`[turnstile] Screenshot saved: ${screenshotPath}`);
  } catch {
    // Non-critical — don't let screenshot failure break the scrape
  }
};

/**
 * Attempt to click the Cloudflare Turnstile checkbox inside its iframe.
 * The Turnstile widget renders in an iframe whose src contains
 * "challenges.cloudflare.com". Inside it there is a checkbox input
 * or a clickable element that triggers the challenge flow.
 *
 * Returns true if a click was performed, false otherwise.
 */
const attemptTurnstileClick = async (
  page: Page,
  log: (message: string) => void
): Promise<boolean> => {
  try {
    // Turnstile renders in an iframe from challenges.cloudflare.com
    const turnstileFrame = page.frames().find(
      (frame) => frame.url().includes("challenges.cloudflare.com/cdn-cgi/challenge-platform")
        || frame.url().includes("challenges.cloudflare.com/turnstile")
    );

    if (!turnstileFrame) {
      log("[turnstile] No Turnstile iframe found");
      return false;
    }

    log(`[turnstile] Found Turnstile iframe: ${turnstileFrame.url().slice(0, 100)}`);

    // Try the checkbox input first (standard Turnstile managed challenge)
    const checkbox = turnstileFrame.locator("input[type='checkbox']");
    if (await checkbox.count() > 0) {
      log("[turnstile] Found checkbox, clicking...");
      await checkbox.first().click({ timeout: 5000 });
      log("[turnstile] Clicked checkbox");
      return true;
    }

    // Some Turnstile variants use a clickable body/div instead
    const clickableBody = turnstileFrame.locator("body");
    if (await clickableBody.count() > 0) {
      log("[turnstile] No checkbox found, clicking iframe body...");
      await clickableBody.first().click({ timeout: 5000 });
      log("[turnstile] Clicked iframe body");
      return true;
    }

    log("[turnstile] No clickable elements found in Turnstile iframe");
    return false;
  } catch (clickError) {
    const message = clickError instanceof Error ? clickError.message : String(clickError);
    log(`[turnstile] Click attempt failed: ${message}`);
    return false;
  }
};

/**
 * Poll a Playwright page until its HTML passes a readiness check.
 * Handles Cloudflare challenge detection and optional pattern matching.
 * When a Cloudflare Turnstile challenge is detected, attempts to click
 * its checkbox to resolve the challenge automatically.
 */
export const waitForReadyContent = async (
  page: Page,
  expectedPattern: RegExp | null,
  timeoutMs: number,
  label: string,
  log: (message: string) => void,
  debugArtifactDirectory?: string | null
): Promise<string> => {
  const start = Date.now();
  let pollCount = 0;
  let turnstileClickAttempted = false;

  while (Date.now() - start < timeoutMs) {
    pollCount += 1;
    const html = await page.content();
    const isCloudflare = isCloudflareChallengeHtml(html);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (pollCount === 1 || pollCount % 5 === 0) {
      log(`[waitForReady] ${label} #${pollCount} (${elapsed}s) CF=${isCloudflare} len=${html.length}`);
    }
    if (!isCloudflare) {
      if (!expectedPattern || expectedPattern.test(html)) {
        log(`[waitForReady] ${label} matched ${elapsed}s (#${pollCount})`);
        return html;
      }
      // Body fallback only when no specific pattern required
      if (!expectedPattern && /<body/i.test(html) && html.length > 5000) {
        log(`[waitForReady] ${label} body fallback ${elapsed}s (${html.length}B)`);
        return html;
      }
    }

    // When stuck on a Cloudflare challenge, try clicking the Turnstile checkbox.
    // Retry periodically (every 10 polls) in case the iframe loads late.
    if (isCloudflare && (!turnstileClickAttempted || pollCount % 10 === 0)) {
      // Give the Turnstile iframe a moment to render before attempting click
      await page.waitForTimeout(2000);
      await saveTurnstileScreenshot(page, debugArtifactDirectory ?? null, "before-click", log);
      const clicked = await attemptTurnstileClick(page, log);
      if (clicked) {
        turnstileClickAttempted = true;
        // Wait for the challenge to resolve after clicking
        await page.waitForTimeout(5000);
        await saveTurnstileScreenshot(page, debugArtifactDirectory ?? null, "after-click", log);
        continue;
      }
    }

    await page.waitForTimeout(2000);
  }

  const finalHtml = await page.content();
  log(`[waitForReady] ${label} TIMED OUT ${((Date.now() - start) / 1000).toFixed(1)}s (#${pollCount} CF=${isCloudflareChallengeHtml(finalHtml)} len=${finalHtml.length})`);
  return finalHtml;
};
