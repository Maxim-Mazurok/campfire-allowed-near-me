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
/**
 * Log all frames on the page for debugging Turnstile iframe discovery.
 */
const logAllFrames = (
  page: Page,
  log: (message: string) => void
): void => {
  const allFrames = page.frames();
  log(`[turnstile] Page has ${allFrames.length} frame(s):`);
  for (const [index, frame] of allFrames.entries()) {
    log(`[turnstile]   frame[${index}]: ${frame.url().slice(0, 120)}`);
  }
};

const attemptTurnstileClick = async (
  page: Page,
  log: (message: string) => void
): Promise<boolean> => {
  try {
    logAllFrames(page, log);

    // Turnstile renders in an iframe from challenges.cloudflare.com
    const turnstileFrame = page.frames().find(
      (frame) => frame.url().includes("challenges.cloudflare.com")
    );

    if (!turnstileFrame) {
      log("[turnstile] No Turnstile iframe found");
      return false;
    }

    log(`[turnstile] Found Turnstile iframe: ${turnstileFrame.url().slice(0, 120)}`);

    // Try the checkbox input first (standard Turnstile managed challenge)
    const checkbox = turnstileFrame.locator("input[type='checkbox']");
    if (await checkbox.count() > 0) {
      log("[turnstile] Found checkbox input, clicking...");
      await checkbox.first().click({ timeout: 5000 });
      log("[turnstile] Clicked checkbox input");
      return true;
    }

    // Turnstile may also use a <label> that wraps/triggers the checkbox
    const label = turnstileFrame.locator("label");
    if (await label.count() > 0) {
      log("[turnstile] Found label element, clicking...");
      await label.first().click({ timeout: 5000 });
      log("[turnstile] Clicked label");
      return true;
    }

    // Fallback: click the iframe body (triggers the Turnstile widget to transition)
    const clickableBody = turnstileFrame.locator("body");
    if (await clickableBody.count() > 0) {
      log("[turnstile] No checkbox/label found, clicking iframe body...");
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
  let lastClickTimestamp = 0;
  // After a successful click, wait at least 60s before re-clicking.
  // Re-clicking too soon can reset the ongoing Cloudflare verification.
  const CLICK_COOLDOWN_MS = 60_000;
  // Initial wait before first click attempt — let the Turnstile iframe render.
  const INITIAL_WAIT_BEFORE_CLICK_MS = 3000;
  // Time to wait after a click for CF verification to complete.
  const POST_CLICK_VERIFICATION_WAIT_MS = 20_000;

  while (Date.now() - start < timeoutMs) {
    pollCount += 1;
    const html = await page.content();
    const isCloudflare = isCloudflareChallengeHtml(html);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // Log every poll for full visibility
    log(`[waitForReady] ${label} #${pollCount} (${elapsed}s) CF=${isCloudflare} len=${html.length}`);

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
    // Respect cooldown to avoid resetting an in-progress verification.
    const timeSinceLastClick = Date.now() - lastClickTimestamp;
    const cooldownExpired = lastClickTimestamp === 0 || timeSinceLastClick >= CLICK_COOLDOWN_MS;

    if (isCloudflare && cooldownExpired) {
      // Give the Turnstile iframe a moment to render before attempting click
      await page.waitForTimeout(INITIAL_WAIT_BEFORE_CLICK_MS);
      await saveTurnstileScreenshot(page, debugArtifactDirectory ?? null, `before-click-${pollCount}`, log);
      const clicked = await attemptTurnstileClick(page, log);
      if (clicked) {
        lastClickTimestamp = Date.now();
        log(`[turnstile] Waiting ${POST_CLICK_VERIFICATION_WAIT_MS / 1000}s for CF verification to complete...`);
        // Wait generously for the verification to resolve after clicking
        await page.waitForTimeout(POST_CLICK_VERIFICATION_WAIT_MS);
        await saveTurnstileScreenshot(page, debugArtifactDirectory ?? null, `after-click-${pollCount}`, log);
        continue;
      }
    } else if (isCloudflare && !cooldownExpired) {
      const remaining = ((CLICK_COOLDOWN_MS - timeSinceLastClick) / 1000).toFixed(0);
      log(`[turnstile] Waiting for cooldown (${remaining}s remaining) — not re-clicking yet`);
    }

    await page.waitForTimeout(2000);
  }

  // Capture a final screenshot at timeout for debugging
  await saveTurnstileScreenshot(page, debugArtifactDirectory ?? null, "timeout-final", log);
  const finalHtml = await page.content();
  log(`[waitForReady] ${label} TIMED OUT ${((Date.now() - start) / 1000).toFixed(1)}s (#${pollCount} CF=${isCloudflareChallengeHtml(finalHtml)} len=${finalHtml.length})`);
  return finalHtml;
};
