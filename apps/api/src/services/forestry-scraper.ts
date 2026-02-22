import pLimit from "p-limit";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  classifyClosureNoticeTags,
  parseClosureNoticeDetailPage,
  parseClosureNoticesPage,
  parseMainFireBanPage
} from "./forestry-parser.js";
import {
  isCloudflareChallengeHtml,
  parseAreaForestNames,
  parseForestDirectoryFilters,
  parseForestDirectoryForests
} from "./forestry-directory-parser.js";
import { ClosureImpactEnricher } from "./closure-impact-enricher.js";
import { RawPageCache } from "../utils/raw-page-cache.js";
import { DEFAULT_FORESTRY_RAW_CACHE_PATH } from "../utils/default-cache-paths.js";
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
  maxFilterConcurrency: number;
  maxClosureConcurrency: number;
  rawPageCachePath: string;
  rawPageCacheTtlMs: number;
}

interface ForestryScraperConstructorOptions extends Partial<ForestryScraperOptions> {
  rawPageCache?: RawPageCache;
  closureImpactEnricher?: ClosureImpactEnricher;
}

const DEFAULT_OPTIONS: ForestryScraperOptions = {
  entryUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
  forestsDirectoryUrl: "https://www.forestrycorporation.com.au/visiting/forests",
  closuresUrl: "https://forestclosure.fcnsw.net",
  timeoutMs: 60_000,
  maxAreaConcurrency: 3,
  maxFilterConcurrency: 4,
  maxClosureConcurrency: 4,
  rawPageCachePath: DEFAULT_FORESTRY_RAW_CACHE_PATH,
  rawPageCacheTtlMs: 60 * 60 * 1000
};

const waitForReadyContent = async (
  page: Page,
  expectedPattern: RegExp | null,
  timeoutMs: number
): Promise<string> => {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const html = await page.content();
    if (!isCloudflareChallengeHtml(html)) {
      if (!expectedPattern || expectedPattern.test(html)) {
        return html;
      }

      if (/<body/i.test(html) && html.length > 2000) {
        return html;
      }
    }

    await page.waitForTimeout(1500);
  }

  return page.content();
};

export class ForestryScraper {
  private readonly options: ForestryScraperOptions;

  private readonly rawPageCache: RawPageCache;

  private readonly closureImpactEnricher: ClosureImpactEnricher;

  constructor(options?: ForestryScraperConstructorOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.rawPageCache = options?.rawPageCache ??
      new RawPageCache({
        filePath: this.options.rawPageCachePath,
        ttlMs: this.options.rawPageCacheTtlMs
      });
    this.closureImpactEnricher = options?.closureImpactEnricher ?? new ClosureImpactEnricher();
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
      return {
        html: cached.html,
        url: cached.finalUrl
      };
    }

    const context = await getContext();
    const page = await context.newPage();
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeoutMs
      });

      const html = await waitForReadyContent(
        page,
        expectedPattern,
        this.options.timeoutMs
      );
      const finalUrl = page.url();

      if (!isCloudflareChallengeHtml(html)) {
        try {
          await this.rawPageCache.set(url, {
            finalUrl,
            html
          });
        } catch {
          // Keep scrape success even if cache write fails.
        }
      }

      return {
        html,
        url: finalUrl
      };
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
      const response = await this.fetchHtml(
        getContext,
        url,
        /facilit|state forests list|showing \d+ results/i
      );

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

    const filters = parseForestDirectoryFilters(base.html).filter((filter) => Boolean(filter.paramName));
    const baseForestEntries = parseForestDirectoryForests(base.html);

    if (!filters.length) {
      return this.buildEmptyDirectorySnapshot(
        "No facilities filters were parsed from Forestry forests page."
      );
    }

    const facilityKeys = filters.map((filter) => filter.key);
    const makeDefaultFacilities = (): Record<string, boolean> =>
      Object.fromEntries(facilityKeys.map((key) => [key, false]));

    const byForestName = new Map<
      string,
      { facilities: Record<string, boolean>; forestUrl: string | null }
    >();
    const ensureForest = (
      forestName: string,
      forestUrl?: string | null
    ): { facilities: Record<string, boolean>; forestUrl: string | null } => {
      const existing = byForestName.get(forestName);
      if (existing) {
        if (!existing.forestUrl && forestUrl) {
          existing.forestUrl = forestUrl;
        }
        return existing;
      }

      const created = {
        facilities: makeDefaultFacilities(),
        forestUrl: forestUrl ?? null
      };
      byForestName.set(forestName, created);
      return created;
    };

    for (const entry of baseForestEntries) {
      ensureForest(entry.forestName, entry.forestUrl);
    }

    const warnings = new Set<string>();
    const limit = pLimit(this.options.maxFilterConcurrency);

    await Promise.all(
      filters.map((filter) =>
        limit(async () => {
          const filterUrl = new URL(base.url);
          filterUrl.search = "";
          filterUrl.searchParams.set(filter.paramName, "Yes");

          const filteredHtml = (
            await this.fetchHtml(
              getContext,
              filterUrl.toString(),
              /state forest|showing \d+ results/i
            )
          ).html;

          if (isCloudflareChallengeHtml(filteredHtml)) {
            warnings.add(
              `Facilities filter "${filter.label}" could not be loaded due to anti-bot verification.`
            );
            return;
          }

          const forestsWithFacility = parseForestDirectoryForests(filteredHtml);
          for (const entry of forestsWithFacility) {
            const row = ensureForest(entry.forestName, entry.forestUrl);
            row.facilities[filter.key] = true;
          }
        })
      )
    );

    const forests = [...byForestName.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([forestName, row]) => ({
        forestName,
        forestUrl: row.forestUrl,
        facilities: row.facilities
      }));

    return {
      filters,
      forests,
      warnings: [...warnings]
    };
  }

  private async scrapeClosures(
    getContext: () => Promise<BrowserContext>
  ): Promise<{
    closures: ForestryScrapeResult["closures"];
    warnings: string[];
  }> {
    const response = await this.fetchHtml(
      getContext,
      this.options.closuresUrl,
      /forest closures|closuredetails/i
    );
    const html = response.html;

    if (isCloudflareChallengeHtml(html)) {
      return {
        closures: [],
        warnings: [
          "Could not load Forestry closures/notices page due to anti-bot verification."
        ]
      };
    }

    const closures = parseClosureNoticesPage(html, response.url);
    if (!closures.length) {
      return {
        closures: [],
        warnings: [
          "No closure notices were parsed from Forestry closures/notices page."
        ]
      };
    }

    const detailLimit = pLimit(this.options.maxClosureConcurrency);
    let detailFailureCount = 0;
    let detailChallengeCount = 0;

    const closuresWithDetails = await Promise.all(
      closures.map((closure) =>
        detailLimit(async (): Promise<ForestClosureNotice> => {
          try {
            const detailResponse = await this.fetchHtml(
              getContext,
              closure.detailUrl,
              /more information|go to forest closures list|closures and notices/i
            );
            const detailHtml = detailResponse.html;
            if (isCloudflareChallengeHtml(detailHtml)) {
              detailChallengeCount += 1;
              return {
                ...closure,
                detailText: null
              };
            }

            const detailText = parseClosureNoticeDetailPage(detailHtml);
            const mergedTags = [...new Set([
              ...closure.tags,
              ...classifyClosureNoticeTags(detailText ?? "")
            ])];

            return {
              ...closure,
              detailText,
              tags: mergedTags
            };
          } catch {
            detailFailureCount += 1;
            return {
              ...closure,
              detailText: null
            };
          }
        })
      )
    );

    const structured = await this.closureImpactEnricher.enrichNotices(closuresWithDetails);
    const warnings = new Set<string>(structured.warnings);
    if (detailChallengeCount > 0) {
      warnings.add(
        `Could not load ${detailChallengeCount} closure detail page(s) due to anti-bot verification.`
      );
    }
    if (detailFailureCount > 0) {
      warnings.add(
        `Could not load ${detailFailureCount} closure detail page(s); list titles were used instead.`
      );
    }

    return {
      closures: structured.notices,
      warnings: [...warnings]
    };
  }

  async scrape(): Promise<ForestryScrapeResult> {
    const runtime: { browser: Browser | null; context: BrowserContext | null } = {
      browser: null,
      context: null
    };

    const getContext = async (): Promise<BrowserContext> => {
      if (runtime.context) {
        return runtime.context;
      }

      runtime.browser = await chromium.launch({ headless: true });
      runtime.context = await runtime.browser.newContext({
        userAgent:
          "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire ban lookup)",
        locale: "en-AU"
      });

      return runtime.context;
    };

    try {
      const [areas, directory, closuresResult] = await Promise.all([
        this.scrapeAreas(getContext),
        this.scrapeDirectory(getContext),
        this.scrapeClosures(getContext)
      ]);

      return {
        areas,
        directory,
        closures: closuresResult.closures ?? [],
        warnings: [...new Set([...directory.warnings, ...closuresResult.warnings])]
      };
    } finally {
      const activeContext = runtime.context;
      if (activeContext) {
        await activeContext.close();
      }

      const activeBrowser = runtime.browser;
      if (activeBrowser) {
        await activeBrowser.close();
      }
    }
  }
}
