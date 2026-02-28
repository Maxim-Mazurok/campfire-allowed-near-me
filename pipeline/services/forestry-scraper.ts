import pLimit from "p-limit";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import {
  isCloudflareChallengeHtml,
  parseAreaForestNames,
  parseForestDirectoryWithFacilities,
  parseMainFireBanPage
} from "./forestry-parser.js";
import { scrapeClosures } from "./closure-scraper.js";
import { RawPageCache } from "../utils/raw-page-cache.js";
import { DEFAULT_FORESTRY_RAW_CACHE_PATH, DEFAULT_BROWSER_PROFILE_PATH } from "../utils/default-cache-paths.js";
import { installResourceBlockingRoutes } from "../utils/resource-blocking.js";
import { waitForReadyContent } from "./wait-for-ready-content.js";
import type {
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDirectorySnapshot
} from "../../shared/contracts.js";

interface ForestryScrapeResult {
  areas: ForestAreaWithForests[];
  directory: ForestDirectorySnapshot;
  closures: ForestClosureNotice[];
  warnings: string[];
}

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
  debugArtifactDirectory: string | null;
}

interface BrowserContextFactoryResult {
  context: BrowserContext;
  cleanup: () => Promise<void>;
}

export type BrowserContextFactory = () => Promise<BrowserContextFactoryResult>;

interface ForestryScraperConstructorOptions extends Partial<ForestryScraperOptions> {
  rawPageCache?: RawPageCache;
  browserContextFactory?: BrowserContextFactory;
  verbose?: boolean;
  proxyUrl?: string | null;
  debugArtifactDirectory?: string | null;
}

const DEFAULT_OPTIONS: ForestryScraperOptions = {
  entryUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
  forestsDirectoryUrl: "https://www.forestrycorporation.com.au/visiting/forests",
  closuresUrl: "https://forestclosure.fcnsw.net/indexframe",
  timeoutMs: 120_000,
  maxAreaConcurrency: 1,
  maxClosureConcurrency: 1,
  rawPageCachePath: DEFAULT_FORESTRY_RAW_CACHE_PATH,
  rawPageCacheTtlMs: 60 * 60 * 1000,
  proxyUrl: null,
  browserProfileDirectory: DEFAULT_BROWSER_PROFILE_PATH,
  debugArtifactDirectory: null
};
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class ForestryScraper {
  private readonly options: ForestryScraperOptions;
  private readonly rawPageCache: RawPageCache;
  private readonly browserContextFactory: BrowserContextFactory | null;
  private readonly log: (message: string) => void;

  constructor(options?: ForestryScraperConstructorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rawPageCache = options?.rawPageCache ??
      new RawPageCache({
        filePath: this.options.rawPageCachePath,
        ttlMs: this.options.rawPageCacheTtlMs
      });
    this.browserContextFactory = options?.browserContextFactory ?? null;
    this.log = options?.verbose ? (message) => console.log(`  ${message}`) : () => {};
  }

  private async captureDebugArtifacts(
    page: import("playwright").Page,
    url: string,
    html: string
  ): Promise<void> {
    const artifactDirectory = this.options.debugArtifactDirectory;
    if (!artifactDirectory) return;

    try {
      if (!existsSync(artifactDirectory)) {
        mkdirSync(artifactDirectory, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const sanitizedUrl = url
        .replace(/^https?:\/\//, "")
        .replace(/[^a-zA-Z0-9-]/g, "_")
        .slice(0, 80);
      const baseFilename = `${timestamp}_${sanitizedUrl}`;

      const screenshotPath = join(artifactDirectory, `${baseFilename}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      this.log(`[debug-artifact] Screenshot saved: ${screenshotPath}`);

      const htmlPath = join(artifactDirectory, `${baseFilename}.html`);
      writeFileSync(htmlPath, html, "utf-8");
      this.log(`[debug-artifact] HTML saved: ${htmlPath}`);
    } catch (artifactError) {
      this.log(
        `[debug-artifact] Failed to capture debug artifacts: ${errorMessage(artifactError)}`
      );
    }
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
        this.log,
        this.options.debugArtifactDirectory
      );
      const finalUrl = page.url();

      if (isCloudflareChallengeHtml(html)) {
        await this.captureDebugArtifacts(page, url, html);
      }

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

  private async runClosureScrape(): Promise<{
    closures: ForestClosureNotice[];
    warnings: string[];
  }> {
    return scrapeClosures({
      closuresUrl: this.options.closuresUrl,
      timeoutMs: this.options.timeoutMs,
      maxClosureConcurrency: this.options.maxClosureConcurrency,
      proxyUrl: this.options.proxyUrl,
      rawPageCache: this.rawPageCache,
      log: this.log
    });
  }

  private createBrowserContextManager(): {
    getContext: () => Promise<BrowserContext>;
    cleanup: () => Promise<void>;
  } {
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

    const cleanup = async () => {
      if (runtime.externalCleanup) {
        await runtime.externalCleanup();
      } else if (runtime.context) {
        await runtime.context.close();
      }
    };

    return { getContext, cleanup };
  }

  /**
   * Scrape Forestry fire ban pages and directory (facilities).
   * Requires a browser for Cloudflare-protected pages.
   * Returns areas with forest names, directory with facilities, and warnings.
   */
  async scrapeForestryPages(): Promise<{
    areas: ForestAreaWithForests[];
    directory: ForestDirectorySnapshot;
    warnings: string[];
  }> {
    const { getContext, cleanup } = this.createBrowserContextManager();
    try {
      const areas = await this.scrapeAreas(getContext);
      const directory = await this.scrapeDirectory(getContext);
      return {
        areas,
        directory,
        warnings: [...directory.warnings]
      };
    } finally {
      await cleanup();
    }
  }

  /**
   * Scrape closure notices from FCNSW.
   * Does not require a browser — uses plain fetch.
   * Returns raw closure notices (without LLM enrichment) and warnings.
   */
  async scrapeClosureNotices(): Promise<{
    closures: ForestClosureNotice[];
    warnings: string[];
  }> {
    return this.runClosureScrape();
  }

  /**
   * Scrape all sources: forestry pages + closures.
   * This is the combined method for full pipeline or live service use.
   */
  async scrape(): Promise<ForestryScrapeResult> {
    const { getContext, cleanup } = this.createBrowserContextManager();

    try {
      // Sequential scraping avoids CDP session races in playwright-extra's
      // stealth plugin when multiple pages are opened concurrently on the
      // same BrowserContext.
      const areas = await this.scrapeAreas(getContext);
      const directory = await this.scrapeDirectory(getContext);
      const closuresResult = await this.runClosureScrape();

      return {
        areas,
        directory,
        closures: closuresResult.closures,
        warnings: [...new Set([...directory.warnings, ...closuresResult.warnings])]
      };
    } finally {
      await cleanup();
    }
  }
}
