import type { Page } from "playwright";
import { isCloudflareChallengeHtml } from "./forestry-parser.js";

/**
 * Poll a Playwright page until its HTML passes a readiness check.
 * Handles Cloudflare challenge detection and optional pattern matching.
 */
export const waitForReadyContent = async (
  page: Page,
  expectedPattern: RegExp | null,
  timeoutMs: number,
  label: string,
  log: (message: string) => void
): Promise<string> => {
  const start = Date.now();
  let pollCount = 0;

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
    await page.waitForTimeout(2000);
  }

  const finalHtml = await page.content();
  log(`[waitForReady] ${label} TIMED OUT ${((Date.now() - start) / 1000).toFixed(1)}s (#${pollCount} CF=${isCloudflareChallengeHtml(finalHtml)} len=${finalHtml.length})`);
  return finalHtml;
};
