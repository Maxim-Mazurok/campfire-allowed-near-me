import pLimit from "p-limit";
import { existsSync, mkdirSync } from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { ProxyAgent } from "undici";
import {
  classifyClosureNoticeTags,
  isCloudflareChallengeHtml,
  parseAreaForestNames,
  parseClosureNoticeDetailPage,
  parseClosureNoticesPage,
  parseForestDirectoryWithFacilities,
  parseMainFireBanPage
} from "./forestry-parser.js";
import { ClosureImpactEnricher } from "./closure-impact-enricher.js";
import { RawPageCache } from "../utils/raw-page-cache.js";
import { DEFAULT_FORESTRY_RAW_CACHE_PATH, DEFAULT_BROWSER_PROFILE_PATH } from "../utils/default-cache-paths.js";
import { installResourceBlockingRoutes } from "../utils/resource-blocking.js";
import { waitForReadyContent } from "./wait-for-ready-content.js";
import type {
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDirectorySnapshot,
  ForestryScrapeResult
} from "../types/domain.js";

interface ForestryScraperOptions {
  entryUrl: string;
  forestsDirectoryUrl: string;
  closuresUrl: string;
  timeoutMs: number;
  maxAreaConcurrency: number;
  maxClosureConcurrency: number;
  rawPageCachePath: string;
  rawPageCacheTtlMs: number;
  proxyUrl: string | null;
  browserProfileDirectory: string;
}

interface BrowserContextFactoryResult {
  context: BrowserContext;
  cleanup: () => Promise<void>;
}

export type BrowserContextFactory = () => Promise<BrowserContextFactoryResult>;

interface ForestryScraperConstructorOptions extends Partial<ForestryScraperOptions> {
  rawPageCache?: RawPageCache;
  closureImpactEnricher?: ClosureImpactEnricher;
  browserContextFactory?: BrowserContextFactory;
  verbose?: boolean;
  proxyUrl?: string | null;
}

const DEFAULT_OPTIONS: ForestryScraperOptions = {
  entryUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
  forestsDirectoryUrl: "https://www.forestrycorporation.com.au/visiting/forests",
  closuresUrl: "https://forestclosure.fcnsw.net/indexframe",
  timeoutMs: 90_000,
  maxAreaConcurrency: 1,
  maxClosureConcurrency: 1,
  rawPageCachePath: DEFAULT_FORESTRY_RAW_CACHE_PATH,
  rawPageCacheTtlMs: 60 * 60 * 1000,
  proxyUrl: null,
  browserProfileDirectory: DEFAULT_BROWSER_PROFILE_PATH
};
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class ForestryScraper {
  private readonly options: ForestryScraperOptions;
  private readonly rawPageCache: RawPageCache;
  private readonly closureImpactEnricher: ClosureImpactEnricher;
  private readonly browserContextFactory: BrowserContextFactory | null;
  private readonly log: (message: string) => void;

  constructor(options?: ForestryScraperConstructorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rawPageCache = options?.rawPageCache ??
      new RawPageCache({
        filePath: this.options.rawPageCachePath,
        ttlMs: this.options.rawPageCacheTtlMs
      });
    this.closureImpactEnricher = options?.closureImpactEnricher ?? new ClosureImpactEnricher();
    this.browserContextFactory = options?.browserContextFactory ?? null;
    this.log = options?.verbose ? (message) => console.log(`  ${message}`) : () => {};
  }

  private async fetchHtml(
    getContext: () => Promise<BrowserContext>,
    url: string,
    expectedPattern: RegExp | null
  ): Promise<{ html: string; url: string }> {
    let cached: Awaited<ReturnType<RawPageCache["get"]>> = null;
    try {
      cached = await this.rawPageCache.get(url);
    } catch {
      cached = null;
    }

    if (cached && !isCloudflareChallengeHtml(cached.html)) {
      return { html: cached.html, url: cached.finalUrl };
    }

    const context = await getContext();
    const page = await context.newPage();
    try {
      this.log(`[fetchHtml] → ${url}`);
      const navigationResponse = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeoutMs
      });
      if (navigationResponse) {
        const headers = navigationResponse.headers();
        this.log(
          `[fetchHtml] HTTP ${navigationResponse.status()} ` +
          `server=${headers["server"] ?? "?"} cf-ray=${headers["cf-ray"] ?? "?"}`
        );
      }

      // Wait for network to settle — helps Cloudflare challenge JS to resolve
      try {
        await page.waitForLoadState("networkidle", { timeout: 15_000 });
        this.log(`[fetchHtml] networkidle reached`);
      } catch {
        this.log(`[fetchHtml] networkidle timeout (non-fatal)`);
      }

      const html = await waitForReadyContent(
        page,
        expectedPattern,
        this.options.timeoutMs,
        url,
        this.log
      );
      const finalUrl = page.url();

      if (!isCloudflareChallengeHtml(html)) {
        try {
          await this.rawPageCache.set(url, { finalUrl, html });
        } catch {
          // Keep scrape success even if cache write fails.
        }
      }

      return { html, url: finalUrl };
    } finally {
      await page.close();
    }
  }

  /**
   * Plain fetch() for non-Cloudflare URLs (e.g. forestclosure.fcnsw.net).
   * Only needs a residential IP, not a real browser — saves proxy bandwidth.
   */
  private async fetchHtmlPlain(
    url: string,
    expectedPattern: RegExp | null
  ): Promise<{ html: string; url: string }> {
    let cached: Awaited<ReturnType<RawPageCache["get"]>> = null;
    try { cached = await this.rawPageCache.get(url); } catch { cached = null; }
    if (cached) return { html: cached.html, url: cached.finalUrl };

    this.log(`[fetchHtmlPlain] → ${url}`);
    const fetchOptions: RequestInit = {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-AU,en;q=0.9"
      },
      signal: AbortSignal.timeout(this.options.timeoutMs)
    };
    if (this.options.proxyUrl) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node undici dispatcher
      (fetchOptions as any).dispatcher = new ProxyAgent(this.options.proxyUrl);
    }

    const response = await fetch(url, fetchOptions);
    this.log(`[fetchHtmlPlain] HTTP ${response.status} (${response.headers.get("content-length") ?? "?"} bytes)`);
    if (!response.ok) throw new Error(`fetchHtmlPlain: HTTP ${response.status} for ${url}`);

    const html = await response.text();
    const finalUrl = response.url || url;
    if (expectedPattern && !expectedPattern.test(html)) {
      this.log(`[fetchHtmlPlain] WARNING: expected pattern not matched in ${url} (${html.length} bytes)`);
    }
    try { await this.rawPageCache.set(url, { finalUrl, html }); } catch { /* non-fatal */ }

    return { html, url: finalUrl };
  }

  private async scrapeAreas(
    getContext: () => Promise<BrowserContext>
  ): Promise<ForestAreaWithForests[]> {
    const main = await this.fetchHtml(
      getContext,
      this.options.entryUrl,
      /solid fuel fire ban/i
    );
    const mainHtml = main.html;

    if (isCloudflareChallengeHtml(mainHtml)) {
      throw new Error(
        "Forestry site anti-bot verification blocked scraping. Try again shortly."
      );
    }

    const areas = parseMainFireBanPage(mainHtml, main.url);
    if (!areas.length) {
      throw new Error("No fire ban areas were found on the main Forestry page.");
    }

    const limit = pLimit(this.options.maxAreaConcurrency);
    const areasWithForests = await Promise.all(
      areas.map((area) =>
        limit(async () => {
          const areaHtml = (
            await this.fetchHtml(
              getContext,
              area.areaUrl,
              null
            )
          ).html;
          const forests = parseAreaForestNames(areaHtml);

          return {
            ...area,
            forests
          };
        })
      )
    );

    return areasWithForests;
  }

  private buildEmptyDirectorySnapshot(warning?: string): ForestDirectorySnapshot {
    return {
      filters: [],
      forests: [],
      warnings: warning ? [warning] : []
    };
  }

  private async loadDirectoryBasePage(
    getContext: () => Promise<BrowserContext>
  ): Promise<{ html: string; url: string } | null> {
    const urls = [
      this.options.forestsDirectoryUrl,
      this.options.forestsDirectoryUrl.replace("/visiting/", "/visit/"),
      this.options.forestsDirectoryUrl.replace("/visit/", "/visiting/")
    ].filter((value, index, list) => list.indexOf(value) === index);

    for (const url of urls) {
      let response: { html: string; url: string };
      try {
        response = await this.fetchHtml(
          getContext,
          url,
          /facilit|state forests list|showing \d+ results/i
        );
      } catch (directoryFetchError) {
        console.error(`  [loadDirectoryBasePage] ${url}: ${errorMessage(directoryFetchError)}`);
        continue;
      }

      if (isCloudflareChallengeHtml(response.html)) {
        continue;
      }

      return response;
    }

    return null;
  }

  private async scrapeDirectory(
    getContext: () => Promise<BrowserContext>
  ): Promise<ForestDirectorySnapshot> {
    const base = await this.loadDirectoryBasePage(getContext);
    if (!base) {
      return this.buildEmptyDirectorySnapshot(
        "Could not load Forestry forests facilities page; facilities filters are temporarily unavailable."
      );
    }

    const snapshot = parseForestDirectoryWithFacilities(base.html);

    if (!snapshot.filters.length && !snapshot.forests.length) {
      return this.buildEmptyDirectorySnapshot(
        "No facilities or forests were parsed from the Forestry forests directory page."
      );
    }

    return snapshot;
  }

  private async scrapeClosures(): Promise<{
    closures: ForestryScrapeResult["closures"];
    warnings: string[];
  }> {
    let response: { html: string; url: string };
    try {
      response = await this.fetchHtmlPlain(
        this.options.closuresUrl,
        /forest closures|closuredetailsframe/i
      );
    } catch (closuresFetchError) {
      const message = errorMessage(closuresFetchError);
      console.error(`  [scrapeClosures] ${message}`);
      return { closures: [], warnings: [`Could not load Forestry closures/notices page: ${message}`] };
    }
    if (isCloudflareChallengeHtml(response.html)) {
      return { closures: [], warnings: ["Could not load Forestry closures/notices page due to anti-bot verification."] };
    }
    const closures = parseClosureNoticesPage(response.html, response.url);
    if (!closures.length) {
      return { closures: [], warnings: ["No closure notices were parsed from Forestry closures/notices page."] };
    }

    const detailLimit = pLimit(this.options.maxClosureConcurrency);
    let detailFailureCount = 0;
    let detailChallengeCount = 0;

    const closuresWithDetails = await Promise.all(
      closures.map((closure) =>
        detailLimit(async (): Promise<ForestClosureNotice> => {
          try {
            const detailResponse = await this.fetchHtmlPlain(
              closure.detailUrl,
              /more information|go to forest closures list|closures and notices/i
            );
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

    const structured = await this.closureImpactEnricher.enrichNotices(closuresWithDetails);
    const closureWarnings = new Set<string>(structured.warnings);
    if (detailChallengeCount > 0) {
      closureWarnings.add(`Could not load ${detailChallengeCount} closure detail page(s) due to anti-bot verification.`);
    }
    if (detailFailureCount > 0) {
      closureWarnings.add(`Could not load ${detailFailureCount} closure detail page(s); list titles were used instead.`);
    }
    return { closures: structured.notices, warnings: [...closureWarnings] };
  }

  async scrape(): Promise<ForestryScrapeResult> {
    const runtime: { browser: Browser | null; context: BrowserContext | null; externalCleanup: (() => Promise<void>) | null } =
      { browser: null, context: null, externalCleanup: null };

    let contextPromise: Promise<BrowserContext> | null = null;
    const getContext = async (): Promise<BrowserContext> => {
      if (runtime.context) return runtime.context;

      if (!contextPromise) {
        contextPromise = (async () => {
          if (this.browserContextFactory) {
            const factoryResult = await this.browserContextFactory();
            runtime.context = factoryResult.context;
            runtime.externalCleanup = factoryResult.cleanup;
          } else {
            const profileDirectory = this.options.browserProfileDirectory;
            if (!existsSync(profileDirectory)) {
              mkdirSync(profileDirectory, { recursive: true });
            }
            this.log(`[scrape] Using persistent browser profile: ${profileDirectory}`);
            runtime.context = await chromium.launchPersistentContext(profileDirectory, {
              headless: true,
              userAgent: "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire ban lookup)",
              locale: "en-AU"
            });
          }
          await installResourceBlockingRoutes(runtime.context, this.log);
          return runtime.context;
        })();
      }
      return contextPromise;
    };

    try {
      // Sequential scraping avoids CDP session races in playwright-extra's
      // stealth plugin when multiple pages are opened concurrently on the
      // same BrowserContext.
      const areas = await this.scrapeAreas(getContext);
      const directory = await this.scrapeDirectory(getContext);
      const closuresResult = await this.scrapeClosures();

      return {
        areas,
        directory,
        closures: closuresResult.closures ?? [],
        warnings: [...new Set([...directory.warnings, ...closuresResult.warnings])]
      };
    } finally {
      if (runtime.externalCleanup) {
        await runtime.externalCleanup();
      } else if (runtime.context) {
        // launchPersistentContext: closing the context also closes the browser
        await runtime.context.close();
      }
    }
  }
}
