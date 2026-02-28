import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { DEFAULT_BROWSER_PROFILE_PATH } from "../utils/default-cache-paths.js";
import "dotenv/config";
import type { BrowserContextFactory } from "../services/forestry-scraper.js";

// ---------------------------------------------------------------------------
// playwright-extra stealth plugin workaround
// ---------------------------------------------------------------------------
process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes("Target page, context or browser has been closed")) {
    console.warn(
      "[playwright-extra] Suppressed CDP session race (page already closed)."
    );
    return;
  }
  throw reason;
});

chromium.use(StealthPlugin());

// ---------------------------------------------------------------------------
// Environment configuration
// ---------------------------------------------------------------------------

export const PROXY_USERNAME = process.env.PROXY_USERNAME ?? "";
export const PROXY_PASSWORD = process.env.PROXY_PASSWORD ?? "";
export const PROXY_HOST = process.env.PROXY_HOST ?? "au.decodo.com";
export const PROXY_PORTS = (
  process.env.PROXY_PORTS ?? "30001,30002,30003,30004,30005,30006,30007,30008,30009,30010"
)
  .split(",")
  .map((port) => port.trim())
  .filter(Boolean);
export const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
export const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";
export const GEOCODE_CACHE_PATH =
  process.env.GEOCODE_CACHE_PATH ?? "data/cache/coordinates.sqlite";
export const MAX_GEOCODE_LOOKUPS_PER_RUN = Number(
  process.env.MAX_GEOCODE_LOOKUPS_PER_RUN ?? "300"
);
export const MAX_PROXY_RETRIES = Number(
  process.env.MAX_PROXY_RETRIES ?? "5"
);
export const BROWSER_PROFILE_DIRECTORY =
  process.env.BROWSER_PROFILE_DIR ?? DEFAULT_BROWSER_PROFILE_PATH;
export const SNAPSHOT_OUTPUT_PATH =
  process.env.SNAPSHOT_OUTPUT_PATH ?? "web/public/forests-snapshot.json";

export const SCRAPE_DEBUG_ARTIFACT_DIRECTORY =
  process.env.SCRAPE_DEBUG_ARTIFACT_DIR ?? null;

export const IS_RUNNING_IN_CI = Boolean(process.env.CI);
export const FORCE_PROXY = Boolean(process.env.FORCE_PROXY);
export const HAS_PROXY = (IS_RUNNING_IN_CI || FORCE_PROXY) && Boolean(PROXY_USERNAME && PROXY_PASSWORD);

if (!IS_RUNNING_IN_CI && !FORCE_PROXY && PROXY_USERNAME) {
  console.log("⚠ Proxy credentials found but CI env not detected — skipping proxy (local run).");
  console.log("  Set FORCE_PROXY=true to use the proxy locally for debugging.");
}

// ---------------------------------------------------------------------------
// Browser context factory for Cloudflare-protected pages
// ---------------------------------------------------------------------------

export const createProxyBrowserContextFactory = (proxyPort: string): BrowserContextFactory | undefined => {
  if (!HAS_PROXY) {
    console.log(
      "⚠ No proxy credentials found. Using plain browser (may be blocked by Cloudflare)."
    );
    return undefined;
  }

  return async () => {
    const profileDirectory = BROWSER_PROFILE_DIRECTORY;
    if (!existsSync(profileDirectory)) {
      mkdirSync(profileDirectory, { recursive: true });
    }
    console.log(`Launching stealth browser with residential proxy (${PROXY_HOST}:${proxyPort})...`);
    console.log(`Browser profile directory: ${profileDirectory}`);

    const context = await chromium.launchPersistentContext(profileDirectory, {
      headless: false,
      args: ["--no-sandbox"],
      proxy: {
        server: `http://${PROXY_HOST}:${proxyPort}`,
        username: PROXY_USERNAME,
        password: PROXY_PASSWORD
      },
      locale: "en-AU",
      viewport: { width: 1920, height: 1080 },
      timezoneId: "Australia/Sydney"
    });

    return {
      context,
      cleanup: async () => {
        await context.close();
      }
    };
  };
};

// ---------------------------------------------------------------------------
// Proxy URL for plain-fetch targets (closures)
// ---------------------------------------------------------------------------

export const buildProxyUrl = (proxyPort: string): string | null => {
  if (!HAS_PROXY) {
    return null;
  }
  return `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${proxyPort}`;
};

// ---------------------------------------------------------------------------
// Retry helper — shuffled proxy ports
// ---------------------------------------------------------------------------

export const getShuffledProxyPorts = (): string[] =>
  [...PROXY_PORTS].sort(() => Math.random() - 0.5);

export const runWithProxyRetries = async <T>(
  operation: (proxyPort: string) => Promise<T>
): Promise<T> => {
  const shuffledPorts = getShuffledProxyPorts();
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_PROXY_RETRIES; attempt++) {
    const proxyPort = shuffledPorts[attempt % shuffledPorts.length]!;
    console.log(
      `\n--- Attempt ${attempt + 1}/${MAX_PROXY_RETRIES} (port ${proxyPort}) ---\n`
    );

    try {
      return await operation(proxyPort);
    } catch (error) {
      lastError = error;
      console.error(
        `Attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : error
      );
      if (attempt < MAX_PROXY_RETRIES - 1) {
        const delaySeconds = 5 + attempt * 5;
        console.log(`Waiting ${delaySeconds}s before retrying with next proxy port...\n`);
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
    }
  }

  console.error(`\nAll ${MAX_PROXY_RETRIES} proxy attempts failed. Last error:`);
  throw lastError;
};
