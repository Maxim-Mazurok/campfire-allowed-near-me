import type { BrowserContext } from "playwright";

/**
 * Allowlisted domains for proxy-routed browser scraping.
 *
 * Only requests to these domains are allowed through. Everything else
 * is aborted to minimise residential proxy bandwidth. This is much
 * safer than a blocklist: new third-party inclusions on the target
 * site are blocked by default instead of silently consuming proxy data.
 *
 * Required domains:
 *   - forestrycorporation.com.au — the scraping target
 *   - challenges.cloudflare.com  — Cloudflare Turnstile challenge JS
 */
const ALLOWED_DOMAINS = [
  "forestrycorporation.com.au",
  "challenges.cloudflare.com",
];

/**
 * Resource types that are never needed for HTML content scraping,
 * even from allowed domains. Blocking these saves additional bandwidth.
 */
const BLOCKED_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);

/**
 * Install route-level filters on a Playwright BrowserContext to allowlist
 * only essential domains and block non-essential resource types.
 *
 * Only HTML documents and JavaScript from the target site and Cloudflare
 * challenge domain are allowed through. All other domains and non-essential
 * resource types (images, CSS, fonts, media) are aborted.
 */
export const installResourceBlockingRoutes = async (
  context: BrowserContext,
  log?: (message: string) => void,
): Promise<void> => {
  log?.("[resource-blocking] Installing allowlist route filters (only target site + Cloudflare challenges)");

  await context.route("**/*", (route) => {
    const request = route.request();
    const url = request.url();

    const isAllowedDomain = ALLOWED_DOMAINS.some((domain) => url.includes(domain));
    if (!isAllowedDomain) {
      return route.abort();
    }

    const resourceType = request.resourceType();
    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      return route.abort();
    }

    return route.continue();
  });
};
