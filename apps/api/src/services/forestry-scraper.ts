import pLimit from "p-limit";
import { chromium, type Page } from "playwright";
import {
  isCloudflareChallengeHtml,
  parseAreaForestNames,
  parseMainFireBanPage
} from "./forestry-parser.js";
import type { ForestAreaWithForests } from "../types/domain.js";

interface ForestryScraperOptions {
  entryUrl: string;
  timeoutMs: number;
  maxAreaConcurrency: number;
}

const DEFAULT_OPTIONS: ForestryScraperOptions = {
  entryUrl: "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
  timeoutMs: 60_000,
  maxAreaConcurrency: 3
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

  async scrape(): Promise<ForestAreaWithForests[]> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "campfire-allowed-near-me/1.0 (contact: local-dev; purpose: fire ban lookup)",
      locale: "en-AU"
    });

    try {
      const mainPage = await context.newPage();
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
      await context.close();
      await browser.close();
    }
  }
}
