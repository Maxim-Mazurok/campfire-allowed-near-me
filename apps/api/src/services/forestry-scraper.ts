import pLimit from "p-limit";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  isCloudflareChallengeHtml,
  parseAreaForestNames,
  parseForestDirectoryFilters,
  parseForestDirectoryForestNames,
  parseMainFireBanPage
} from "./forestry-parser.js";
import type {
  ForestAreaWithForests,
  ForestDirectorySnapshot,
  ForestryScrapeResult
} from "../types/domain.js";

interface ForestryScraperOptions {
  entryUrl: string;
  forestsDirectoryUrl: string;
  timeoutMs: number;
  maxAreaConcurrency: number;
  maxFilterConcurrency: number;
}

const DEFAULT_OPTIONS: ForestryScraperOptions = {
  entryUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
  forestsDirectoryUrl: "https://www.forestrycorporation.com.au/visiting/forests",
  timeoutMs: 60_000,
  maxAreaConcurrency: 3,
  maxFilterConcurrency: 4
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

  constructor(options?: Partial<ForestryScraperOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  private async scrapeAreas(context: BrowserContext): Promise<ForestAreaWithForests[]> {
    const mainPage = await context.newPage();
    try {
      await mainPage.goto(this.options.entryUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeoutMs
      });

      const mainHtml = await waitForReadyContent(
        mainPage,
        /solid fuel fire ban/i,
        this.options.timeoutMs
      );

      if (isCloudflareChallengeHtml(mainHtml)) {
        throw new Error(
          "Forestry site anti-bot verification blocked scraping. Try again shortly."
        );
      }

      const areas = parseMainFireBanPage(mainHtml, this.options.entryUrl);
      if (!areas.length) {
        throw new Error("No fire ban areas were found on the main Forestry page.");
      }

      const limit = pLimit(this.options.maxAreaConcurrency);
      const areasWithForests = await Promise.all(
        areas.map((area) =>
          limit(async () => {
            const page = await context.newPage();
            try {
              await page.goto(area.areaUrl, {
                waitUntil: "domcontentloaded",
                timeout: this.options.timeoutMs
              });

              const areaHtml = await waitForReadyContent(
                page,
                null,
                this.options.timeoutMs
              );

              const forests = parseAreaForestNames(areaHtml);

              return {
                ...area,
                forests
              };
            } finally {
              await page.close();
            }
          })
        )
      );

      return areasWithForests;
    } finally {
      await mainPage.close();
    }
  }

  private buildEmptyDirectorySnapshot(warning?: string): ForestDirectorySnapshot {
    return {
      filters: [],
      forests: [],
      warnings: warning ? [warning] : []
    };
  }

  private async loadDirectoryBasePage(
    context: BrowserContext
  ): Promise<{ html: string; url: string } | null> {
    const urls = [
      this.options.forestsDirectoryUrl,
      this.options.forestsDirectoryUrl.replace("/visiting/", "/visit/"),
      this.options.forestsDirectoryUrl.replace("/visit/", "/visiting/")
    ].filter((value, index, list) => list.indexOf(value) === index);

    for (const url of urls) {
      const page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: this.options.timeoutMs
        });

        const html = await waitForReadyContent(
          page,
          /facilit|state forests list|showing \d+ results/i,
          this.options.timeoutMs
        );

        if (isCloudflareChallengeHtml(html)) {
          continue;
        }

        return {
          html,
          url: page.url()
        };
      } finally {
        await page.close();
      }
    }

    return null;
  }

  private async scrapeDirectory(context: BrowserContext): Promise<ForestDirectorySnapshot> {
    const base = await this.loadDirectoryBasePage(context);
    if (!base) {
      return this.buildEmptyDirectorySnapshot(
        "Could not load Forestry forests facilities page; facilities filters are temporarily unavailable."
      );
    }

    const filters = parseForestDirectoryFilters(base.html).filter((filter) => Boolean(filter.paramName));
    const allForestNames = parseForestDirectoryForestNames(base.html);

    if (!filters.length) {
      return this.buildEmptyDirectorySnapshot(
        "No facilities filters were parsed from Forestry forests page."
      );
    }

    const facilityKeys = filters.map((filter) => filter.key);
    const makeDefaultFacilities = (): Record<string, boolean> =>
      Object.fromEntries(facilityKeys.map((key) => [key, false]));

    const byForestName = new Map<string, Record<string, boolean>>();
    const ensureForest = (forestName: string): Record<string, boolean> => {
      const existing = byForestName.get(forestName);
      if (existing) {
        return existing;
      }

      const created = makeDefaultFacilities();
      byForestName.set(forestName, created);
      return created;
    };

    for (const forestName of allForestNames) {
      ensureForest(forestName);
    }

    const warnings = new Set<string>();
    const limit = pLimit(this.options.maxFilterConcurrency);

    await Promise.all(
      filters.map((filter) =>
        limit(async () => {
          const page = await context.newPage();
          try {
            const filterUrl = new URL(base.url);
            filterUrl.search = "";
            filterUrl.searchParams.set(filter.paramName, "Yes");

            await page.goto(filterUrl.toString(), {
              waitUntil: "domcontentloaded",
              timeout: this.options.timeoutMs
            });

            const filteredHtml = await waitForReadyContent(
              page,
              /state forest|showing \d+ results/i,
              this.options.timeoutMs
            );

            if (isCloudflareChallengeHtml(filteredHtml)) {
              warnings.add(
                `Facilities filter "${filter.label}" could not be loaded due to anti-bot verification.`
              );
              return;
            }

            const forestsWithFacility = parseForestDirectoryForestNames(filteredHtml);
            for (const forestName of forestsWithFacility) {
              const row = ensureForest(forestName);
              row[filter.key] = true;
            }
          } finally {
            await page.close();
          }
        })
      )
    );

    const forests = [...byForestName.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([forestName, facilities]) => ({
        forestName,
        facilities
      }));

    return {
      filters,
      forests,
      warnings: [...warnings]
    };
  }

  async scrape(): Promise<ForestryScrapeResult> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire ban lookup)",
      locale: "en-AU"
    });

    try {
      const [areas, directory] = await Promise.all([
        this.scrapeAreas(context),
        this.scrapeDirectory(context)
      ]);

      return {
        areas,
        directory,
        warnings: [...directory.warnings]
      };
    } finally {
      await context.close();
      await browser.close();
    }
  }
}
