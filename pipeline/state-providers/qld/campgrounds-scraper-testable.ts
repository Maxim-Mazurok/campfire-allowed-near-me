/**
 * Testable exports from campgrounds-scraper.ts
 * Exposes internal helper functions for unit testing.
 */

export { fetchQldCampgroundUrls, fetchQldCampground, fetchAllQldCampgrounds } from "./campgrounds-scraper.js";

// Re-export the parsing helper for direct unit testing
import { load } from "cheerio";

export const parseCampgroundLinksFromPage = (html: string): string[] => {
  const $ = load(html);
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^https:\/\/parks\.qld\.gov\.au\/parks\/[^/]+\/camping\/[^/]+$/.test(href)) {
      links.add(href);
    }
  });

  return Array.from(links);
};
