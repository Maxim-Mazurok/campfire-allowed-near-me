import type { BrowserContext } from "playwright";

/**
 * Resource types that are never needed for HTML content scraping.
 * Blocking these saves significant proxy bandwidth.
 */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

/**
 * Third-party domains that serve analytics, map tiles, fonts, and other
 * assets irrelevant to the HTML content we scrape. Requests to these
 * domains are aborted to reduce proxy traffic.
 *
 * NOT blocked (required for anti-bot challenges):
 *   - challenges.cloudflare.com
 *   - www.google.com (potential reCAPTCHA)
 */
const BLOCKED_DOMAINS = [
  "googletagmanager.com",
  "google-analytics.com",
  "maps.googleapis.com",
  "maps.gstatic.com",
  "fonts.gstatic.com",
  "fonts.googleapis.com",
  "tile.opentopomap.org",
  "mapservices.fcnsw.net",
  "cdn.fcnsw.net",
  "connectivitycheck.gstatic.com",
];

/**
 * Install route-level filters on a Playwright BrowserContext to block
 * non-essential resources (images, CSS, fonts, analytics, map tiles).
 *
 * Only HTML documents and essential JavaScript (including Cloudflare
 * challenge scripts) are allowed through. This typically saves 300+ MB
 * of proxy bandwidth per full scrape run.
 */
export const installResourceBlockingRoutes = async (
  context: BrowserContext,
  log?: (message: string) => void,
): Promise<void> => {
  log?.("[resource-blocking] Installing route filters (images, CSS, fonts, analytics, map tiles)");

  await context.route("**/*", (route) => {
    const request = route.request();
    const resourceType = request.resourceType();

    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      return route.abort();
    }

    const url = request.url();
    if (BLOCKED_DOMAINS.some((domain) => url.includes(domain))) {
      return route.abort();
    }

    return route.continue();
  });
};
