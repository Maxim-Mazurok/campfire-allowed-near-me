import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { ForestryScraper } from "../apps/api/src/services/forestry-scraper.js";
import { OSMGeocoder } from "../apps/api/src/services/osm-geocoder.js";
import { TotalFireBanService } from "../apps/api/src/services/total-fire-ban-service.js";
import { LiveForestDataService } from "../apps/api/src/services/live-forest-data-service.js";
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
const PROXY_PORT = process.env.PROXY_PORT ?? "30000";
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

const hasProxy = Boolean(PROXY_USERNAME && PROXY_PASSWORD);

// ---------------------------------------------------------------------------
// Browser context factory (stealth + residential proxy)
// ---------------------------------------------------------------------------

const createProxyBrowserContextFactory = () => {
  if (!hasProxy) {
    console.log(
      "⚠ No proxy credentials found. Using plain browser (may be blocked by Cloudflare)."
    );
    return undefined;
  }

  return async () => {
    console.log("Launching stealth browser with residential proxy...");
    const browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox"]
    });

    const context = await browser.newContext({
      proxy: {
        server: `http://${PROXY_HOST}:${PROXY_PORT}`,
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
        await context.close();
        await browser.close();
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
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  const startTime = Date.now();
  console.log("=== Forest Snapshot Generator ===");
  console.log(`Output: ${SNAPSHOT_OUTPUT_PATH}`);
  console.log(`Proxy: ${hasProxy ? `${PROXY_HOST}:${PROXY_PORT}` : "none"}`);
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

  // Set up services
  const scraper = new ForestryScraper({
    browserContextFactory: createProxyBrowserContextFactory()
  });

  const geocoder = new OSMGeocoder({
    cacheDbPath: GEOCODE_CACHE_PATH,
    nominatimBaseUrl: NOMINATIM_BASE_URL,
    googleApiKey: GOOGLE_MAPS_API_KEY || null,
    maxNewLookupsPerRun: MAX_GEOCODE_LOOKUPS_PER_RUN,
    requestDelayMs: 1200
  });

  const totalFireBanService = new TotalFireBanService();

  const forestDataService = new LiveForestDataService({
    scraper,
    geocoder,
    totalFireBanService,
    // snapshotPath is intentionally null so that LiveForestDataService does NOT
    // read the placeholder snapshot as a stale fallback (which would silently
    // swallow scraping errors and return 0 forests). We persist manually below.
    snapshotPath: null
  });

  // Generate snapshot (scrape → geocode → build → persist)
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
