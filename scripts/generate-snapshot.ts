import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { ForestryScraper } from "../apps/api/src/services/forestry-scraper.js";
import { ForestGeocoder } from "../apps/api/src/services/forest-geocoder.js";
import { TotalFireBanService } from "../apps/api/src/services/total-fire-ban-service.js";
import { LiveForestDataService } from "../apps/api/src/services/live-forest-data-service.js";
import { DEFAULT_BROWSER_PROFILE_PATH } from "../apps/api/src/utils/default-cache-paths.js";
import "dotenv/config";
import type { PersistedSnapshot } from "../packages/shared/src/contracts.js";

// ---------------------------------------------------------------------------
// playwright-extra stealth plugin workaround
// ---------------------------------------------------------------------------
// The stealth plugin's puppeteer compatibility shim sends CDP commands
// asynchronously when pages are created. When a page closes before the CDP
// command resolves, the resulting rejection is unhandled and crashes Node.
// This is a known playwright-extra issue — suppress the specific error.
// ---------------------------------------------------------------------------
process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (message.includes("Target page, context or browser has been closed")) {
    console.warn(
      "[playwright-extra] Suppressed CDP session race (page already closed)."
    );
    return;
  }
  // Re-throw anything else so it still crashes on real errors
  throw reason;
});

chromium.use(StealthPlugin());

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROXY_USERNAME = process.env.PROXY_USERNAME ?? "";
const PROXY_PASSWORD = process.env.PROXY_PASSWORD ?? "";
const PROXY_HOST = process.env.PROXY_HOST ?? "au.decodo.com";
const PROXY_PORTS = (
  process.env.PROXY_PORTS ?? "30001,30002,30003,30004,30005,30006,30007,30008,30009,30010"
)
  .split(",")
  .map((port) => port.trim())
  .filter(Boolean);
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? "";
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";
const SNAPSHOT_OUTPUT_PATH =
  process.env.SNAPSHOT_OUTPUT_PATH ??
  resolve("apps/web/public/forests-snapshot.json");
const GEOCODE_CACHE_PATH =
  process.env.GEOCODE_CACHE_PATH ?? "data/cache/coordinates.sqlite";
const MAX_GEOCODE_LOOKUPS_PER_RUN = Number(
  process.env.MAX_GEOCODE_LOOKUPS_PER_RUN ?? "300"
);
const MAX_PROXY_RETRIES = Number(
  process.env.MAX_PROXY_RETRIES ?? "5"
);
const BROWSER_PROFILE_DIRECTORY =
  process.env.BROWSER_PROFILE_DIR ?? DEFAULT_BROWSER_PROFILE_PATH;

const isRunningInCI = Boolean(process.env.CI);
const hasProxy = isRunningInCI && Boolean(PROXY_USERNAME && PROXY_PASSWORD);
if (!isRunningInCI && PROXY_USERNAME) {
  console.log("⚠ Proxy credentials found but CI env not detected — skipping proxy (local run).");
}

// ---------------------------------------------------------------------------
// Browser context factory (stealth + residential proxy + persistent cache)
// ---------------------------------------------------------------------------

const createProxyBrowserContextFactory = (proxyPort: string) => {
  if (!hasProxy) {
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
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "en-AU",
      viewport: { width: 1920, height: 1080 },
      timezoneId: "Australia/Sydney"
    });

    return {
      context,
      cleanup: async () => {
        // launchPersistentContext: closing the context also closes the browser
        await context.close();
      }
    };
  };
};

// ---------------------------------------------------------------------------
// Snapshot validation
// ---------------------------------------------------------------------------

const validateSnapshot = (snapshot: PersistedSnapshot): string[] => {
  const errors: string[] = [];

  if (!snapshot.forests.length) {
    errors.push("Snapshot contains zero forests.");
  }

  const forestsWithCoordinates = snapshot.forests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  );

  if (forestsWithCoordinates.length < 10) {
    errors.push(
      `Only ${forestsWithCoordinates.length} forests have coordinates (expected at least 10).`
    );
  }

  const forestsWithBanStatus = snapshot.forests.filter(
    (forest) => forest.banStatus !== "UNKNOWN"
  );

  if (forestsWithBanStatus.length < 10) {
    errors.push(
      `Only ${forestsWithBanStatus.length} forests have known ban status (expected at least 10).`
    );
  }

  if (!snapshot.availableFacilities.length) {
    errors.push("Snapshot has no facility definitions.");
  }

  return errors;
};

// ---------------------------------------------------------------------------
// Scrape attempt (one proxy port)
// ---------------------------------------------------------------------------

const attemptScrape = async (
  proxyPort: string,
  geocoder: ForestGeocoder,
  totalFireBanService: TotalFireBanService
) => {
  const proxyUrl = hasProxy
    ? `http://${PROXY_USERNAME}:${PROXY_PASSWORD}@${PROXY_HOST}:${proxyPort}`
    : null;

  const scraper = new ForestryScraper({
    browserContextFactory: createProxyBrowserContextFactory(proxyPort),
    verbose: true,
    rawPageCacheTtlMs: 0, // Disable caching — each attempt must fetch fresh pages
    proxyUrl,
    browserProfileDirectory: BROWSER_PROFILE_DIRECTORY
  });

  const forestDataService = new LiveForestDataService({
    scraper,
    geocoder,
    totalFireBanService,
    // snapshotPath is intentionally null so that LiveForestDataService does NOT
    // read the placeholder snapshot as a stale fallback (which would silently
    // swallow scraping errors and return 0 forests). We persist manually below.
    snapshotPath: null
  });

  console.log("[1/4] Scraping source pages...");
  const response = await forestDataService.getForestData({
    forceRefresh: true,
    progressCallback: (progress) => {
      const totalSuffix =
        progress.total !== null ? `/${progress.total}` : "";
      console.log(
        `  [${progress.phase}] ${progress.message} (${progress.completed}${totalSuffix})`
      );
    }
  });

  return response;
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const startTime = Date.now();
  console.log("=== Forest Snapshot Generator ===");
  console.log(`Output: ${SNAPSHOT_OUTPUT_PATH}`);
  console.log(`Proxy: ${hasProxy ? `${PROXY_HOST} (ports: ${PROXY_PORTS.join(", ")})` : "none"}`);
  console.log(`Max retries: ${MAX_PROXY_RETRIES}`);
  console.log(`Nominatim: ${NOMINATIM_BASE_URL}`);
  console.log(
    `Google API key: ${GOOGLE_MAPS_API_KEY ? "configured" : "not configured"}`
  );
  console.log("");

  // Ensure output directory exists
  const outputDirectory = dirname(SNAPSHOT_OUTPUT_PATH);
  if (!existsSync(outputDirectory)) {
    mkdirSync(outputDirectory, { recursive: true });
  }

  // Set up shared services (geocoder + TFB are reusable across retries)
  const geocoder = new ForestGeocoder({
    cacheDbPath: GEOCODE_CACHE_PATH,
    nominatimBaseUrl: NOMINATIM_BASE_URL,
    googleApiKey: GOOGLE_MAPS_API_KEY || null,
    maxNewLookupsPerRun: MAX_GEOCODE_LOOKUPS_PER_RUN,
    requestDelayMs: 1200
  });

  const totalFireBanService = new TotalFireBanService();

  // Retry loop — pick a random proxy port each attempt
  const shuffledPorts = [...PROXY_PORTS].sort(() => Math.random() - 0.5);
  let response: Awaited<ReturnType<typeof attemptScrape>> | undefined;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_PROXY_RETRIES; attempt++) {
    const proxyPort = shuffledPorts[attempt % shuffledPorts.length];
    console.log(
      `\n--- Attempt ${attempt + 1}/${MAX_PROXY_RETRIES} (port ${proxyPort}) ---\n`
    );

    try {
      response = await attemptScrape(proxyPort, geocoder, totalFireBanService);
      break; // success — exit retry loop
    } catch (error) {
      lastError = error;
      console.error(
        `Attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : error
      );
      if (attempt < MAX_PROXY_RETRIES - 1) {
        const delaySeconds = 5 + attempt * 5; // 5s, 10s, 15s, ...
        console.log(`Waiting ${delaySeconds}s before retrying with next proxy port...\n`);
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
    }
  }

  if (!response) {
    console.error(
      `\nAll ${MAX_PROXY_RETRIES} proxy attempts failed. Last error:`
    );
    throw lastError;
  }

  console.log("");
  console.log(`[2/4] Snapshot generated: ${response.forests.length} forests`);

  if (response.warnings.length) {
    console.log("  Scrape warnings:");
    for (const warning of response.warnings) {
      console.log(`    ⚠ ${warning}`);
    }
  }

  if (response.stale) {
    console.log("  ⚠ Response is marked as stale.");
  }

  // Build and persist the snapshot ourselves
  const savedSnapshot: PersistedSnapshot = {
    schemaVersion: 7,
    fetchedAt: response.fetchedAt,
    stale: response.stale,
    sourceName: response.sourceName,
    availableFacilities: response.availableFacilities,
    availableClosureTags: response.availableClosureTags,
    matchDiagnostics: response.matchDiagnostics,
    closureDiagnostics: response.closureDiagnostics,
    forests: response.forests.map(
      ({ distanceKm: _distanceKm, travelDurationMinutes: _travelDurationMinutes, ...forest }) => forest
    ),
    warnings: response.warnings
  };

  writeFileSync(SNAPSHOT_OUTPUT_PATH, JSON.stringify(savedSnapshot, null, 2));

  console.log(`[3/4] Validating snapshot...`);
  const validationErrors = validateSnapshot(savedSnapshot);

  if (validationErrors.length) {
    console.error("Snapshot validation FAILED:");
    for (const validationError of validationErrors) {
      console.error(`  ✗ ${validationError}`);
    }
    process.exit(1);
  }

  // Summary
  const forestsWithCoordinates = savedSnapshot.forests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  );
  const forestsNotBanned = savedSnapshot.forests.filter(
    (forest) => forest.banStatus === "NOT_BANNED"
  );
  const forestsBanned = savedSnapshot.forests.filter(
    (forest) => forest.banStatus === "BANNED"
  );
  const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`[4/4] Summary:`);
  console.log(`  Total forests: ${savedSnapshot.forests.length}`);
  console.log(`  With coordinates: ${forestsWithCoordinates.length}`);
  console.log(`  Campfire allowed: ${forestsNotBanned.length}`);
  console.log(`  Campfire banned: ${forestsBanned.length}`);
  console.log(`  Facilities defined: ${savedSnapshot.availableFacilities.length}`);
  console.log(`  Warnings: ${savedSnapshot.warnings.length}`);
  console.log(`  Schema version: ${savedSnapshot.schemaVersion ?? "unversioned"}`);
  console.log(`  Elapsed: ${elapsedSeconds}s`);
  console.log("");

  if (savedSnapshot.warnings.length) {
    console.log("Warnings:");
    for (const warning of savedSnapshot.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
    console.log("");
  }

  console.log(`✓ Snapshot saved to ${SNAPSHOT_OUTPUT_PATH}`);

  // Write a metadata file for GHA
  const metadataPath = SNAPSHOT_OUTPUT_PATH.replace(/\.json$/, ".meta.json");
  writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        forestCount: savedSnapshot.forests.length,
        mappedForestCount: forestsWithCoordinates.length,
        allowedCount: forestsNotBanned.length,
        bannedCount: forestsBanned.length,
        warningCount: savedSnapshot.warnings.length,
        elapsedSeconds: Number(elapsedSeconds)
      },
      null,
      2
    )
  );
};

main().catch((error) => {
  console.error("Fatal error during snapshot generation:");
  console.error(error);
  process.exit(1);
});
