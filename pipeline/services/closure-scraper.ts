import pLimit from "p-limit";
import { ProxyAgent } from "undici";
import {
  classifyClosureNoticeTags,
  isCloudflareChallengeHtml,
  parseClosureNoticeDetailPage,
  parseClosureNoticesPage
} from "./forestry-parser.js";
import type { RawPageCache } from "../utils/raw-page-cache.js";
import type { ForestClosureNotice } from "../../shared/contracts.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ClosureScraperOptions {
  closuresUrl: string;
  timeoutMs: number;
  maxClosureConcurrency: number;
  proxyUrl: string | null;
  rawPageCache: RawPageCache;
  log: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Plain HTML fetcher (non-Cloudflare)
// ---------------------------------------------------------------------------

const DETAIL_PAGE_PATTERN = /more information|go to forest closures list|closures and notices/i;

async function fetchHtmlPlain(
  url: string,
  expectedPattern: RegExp | null,
  options: Pick<ClosureScraperOptions, "timeoutMs" | "proxyUrl" | "rawPageCache" | "log">
): Promise<{ html: string; url: string }> {
  const { timeoutMs, proxyUrl, rawPageCache, log } = options;

  let cached: Awaited<ReturnType<RawPageCache["get"]>> = null;
  try { cached = await rawPageCache.get(url); } catch { cached = null; }
  if (cached) return { html: cached.html, url: cached.finalUrl };

  log(`[fetchHtmlPlain] → ${url}`);
  const fetchOptions: RequestInit = {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-AU,en;q=0.9"
    },
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (proxyUrl) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node undici dispatcher
    (fetchOptions as any).dispatcher = new ProxyAgent(proxyUrl);
  }

  const response = await fetch(url, fetchOptions);
  log(`[fetchHtmlPlain] HTTP ${response.status} (${response.headers.get("content-length") ?? "?"} bytes)`);
  if (!response.ok) throw new Error(`fetchHtmlPlain: HTTP ${response.status} for ${url}`);

  const html = await response.text();
  const finalUrl = response.url || url;
  if (expectedPattern && !expectedPattern.test(html)) {
    log(`[fetchHtmlPlain] WARNING: expected pattern not matched in ${url} (${html.length} bytes)`);
  }
  try { await rawPageCache.set(url, { finalUrl, html }); } catch { /* non-fatal */ }

  return { html, url: finalUrl };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scrape FCNSW closure notices using plain fetch (no browser needed).
 *
 * 1. Fetch the listing page from `closuresUrl`.
 * 2. Parse listed closures; fetch each detail page for extra text + tags.
 * 3. Return the closure list and warnings.
 */
export async function scrapeClosures(
  options: ClosureScraperOptions
): Promise<{ closures: ForestClosureNotice[]; warnings: string[] }> {
  const { closuresUrl, maxClosureConcurrency, log } = options;
  const fetchOptions: Pick<ClosureScraperOptions, "timeoutMs" | "proxyUrl" | "rawPageCache" | "log"> = options;

  // --- Fetch listing page ---
  let response: { html: string; url: string };
  try {
    response = await fetchHtmlPlain(closuresUrl, /forest closures|closuredetailsframe/i, fetchOptions);
  } catch (closuresFetchError) {
    const message = closuresFetchError instanceof Error ? closuresFetchError.message : String(closuresFetchError);
    console.error(`  [scrapeClosures] ${message}`);
    return { closures: [], warnings: [`Could not load Forestry closures/notices page: ${message}`] };
  }

  if (isCloudflareChallengeHtml(response.html)) {
    return { closures: [], warnings: ["Could not load Forestry closures/notices page due to anti-bot verification."] };
  }

  // --- Parse listing ---
  const closures = parseClosureNoticesPage(response.html, response.url);
  log(`[scrapeClosures] Parsed ${closures.length} closure notice(s). Fetching detail pages...`);
  if (!closures.length) {
    return { closures: [], warnings: ["No closure notices were parsed from Forestry closures/notices page."] };
  }

  // --- Fetch detail pages for listed closures ---
  const detailLimit = pLimit(maxClosureConcurrency);
  let detailFailureCount = 0;
  let detailChallengeCount = 0;

  const closuresWithDetails = await Promise.all(
    closures.map((closure) =>
      detailLimit(async (): Promise<ForestClosureNotice> => {
        try {
          const detailResponse = await fetchHtmlPlain(closure.detailUrl, DETAIL_PAGE_PATTERN, fetchOptions);
          if (isCloudflareChallengeHtml(detailResponse.html)) {
            detailChallengeCount += 1;
            return { ...closure, detailText: null };
          }
          const detailText = parseClosureNoticeDetailPage(detailResponse.html);
          const mergedTags = [...new Set([
            ...closure.tags, ...classifyClosureNoticeTags(detailText ?? "")
          ])];
          return { ...closure, detailText, tags: mergedTags };
        } catch {
          detailFailureCount += 1;
          return { ...closure, detailText: null };
        }
      })
    )
  );

  log("[scrapeClosures] Closure scraping complete.");
  const closureWarnings = new Set<string>();
  if (detailChallengeCount > 0) {
    closureWarnings.add(`Could not load ${detailChallengeCount} closure detail page(s) due to anti-bot verification.`);
  }
  if (detailFailureCount > 0) {
    closureWarnings.add(`Could not load ${detailFailureCount} closure detail page(s); list titles were used instead.`);
  }

  return {
    closures: closuresWithDetails,
    warnings: [...closureWarnings]
  };
}
