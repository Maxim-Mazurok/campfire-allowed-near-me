import { readJsonFile, writeJsonFile } from "../utils/fs-cache.js";
import { normalizeForestLabel } from "../utils/forest-name-validation.js";
import { DEFAULT_FORESTRY_RAW_CACHE_PATH } from "../utils/default-cache-paths.js";
import { ForestryScraper } from "./forestry-scraper.js";
import { OSMGeocoder } from "./osm-geocoder.js";
import { TotalFireBanService } from "./total-fire-ban-service.js";
import { GoogleRoutesService, type RouteService } from "./google-routes.js";
import type {
  ForestApiResponse,
  ForestDataService,
  ForestDataServiceInput,
  ForestPoint,
  PersistedSnapshot,
  RefreshTaskProgress
} from "../types/domain.js";
import {
  CLOSURE_TAG_DEFINITIONS,
  normalizeSnapshot,
  sanitizeWarnings
} from "./forest-snapshot-normalizer.js";
import { buildForestStatusKey } from "./forest-ban-helpers.js";
import { buildForestPoints } from "./forest-points-builder.js";
import { addTravelMetrics, findNearestLegalSpot } from "./forest-travel-metrics.js";

interface LiveForestDataServiceOptions {
  snapshotPath?: string | null;
  scrapeTtlMs?: number;
  sourceName?: string;
  scraper?: ForestryScraper;
  geocoder?: OSMGeocoder;
  totalFireBanService?: TotalFireBanService;
  routeService?: RouteService;
}

interface LiveForestDataServiceResolvedOptions {
  snapshotPath: string | null;
  scrapeTtlMs: number;
  sourceName: string;
}

const DEFAULT_OPTIONS: LiveForestDataServiceResolvedOptions = {
  snapshotPath: null,
  scrapeTtlMs: 15 * 60 * 1000,
  sourceName: "Forestry Corporation NSW"
};

const SNAPSHOT_FORMAT_VERSION = 7;
const MISSING_GEOCODE_ATTEMPTS_MESSAGE =
  "No geocoding attempt diagnostics were captured in this snapshot.";
const MISSING_TOTAL_FIRE_BAN_DIAGNOSTICS_MESSAGE =
  "No Total Fire Ban diagnostics were captured in this snapshot.";
const EMPTY_CLOSURE_DIAGNOSTICS = { unmatchedNotices: [], fuzzyMatches: [] };

export class LiveForestDataService implements ForestDataService {
  private readonly options: LiveForestDataServiceResolvedOptions;

  private readonly scraper: ForestryScraper;

  private readonly geocoder: OSMGeocoder;

  private readonly totalFireBanService: TotalFireBanService;

  private readonly routeService: RouteService;

  private memorySnapshot: PersistedSnapshot | null = null;

  private snapshotResolvePromise: Promise<PersistedSnapshot> | null = null;

  constructor(options?: LiveForestDataServiceOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.scraper = options?.scraper ??
      new ForestryScraper({
        entryUrl:
          process.env.FORESTRY_ENTRY_URL ??
          "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans",
        forestsDirectoryUrl:
          process.env.FORESTRY_DIRECTORY_URL ??
          "https://www.forestrycorporation.com.au/visiting/forests",
        rawPageCachePath:
          process.env.FORESTRY_RAW_CACHE_PATH ?? DEFAULT_FORESTRY_RAW_CACHE_PATH,
        rawPageCacheTtlMs: Number(
          process.env.FORESTRY_RAW_CACHE_TTL_MS ?? `${60 * 60 * 1000}`
        )
      });
    this.geocoder = options?.geocoder ??
      new OSMGeocoder({
        cacheDbPath: process.env.COORDINATE_CACHE_DB ?? "data/cache/coordinates.sqlite",
        maxNewLookupsPerRun: Number(
          process.env.GEOCODE_MAX_NEW_PER_REQUEST ?? "25"
        ),
        requestDelayMs: Number(process.env.GEOCODE_DELAY_MS ?? "1200"),
        requestTimeoutMs: Number(process.env.GEOCODE_TIMEOUT_MS ?? "15000"),
        retryAttempts: Number(process.env.GEOCODE_RETRY_ATTEMPTS ?? "3"),
        retryBaseDelayMs: Number(process.env.GEOCODE_RETRY_BASE_DELAY_MS ?? "750"),
        nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? undefined,
        googleApiKey: process.env.GOOGLE_MAPS_API_KEY ?? null
      });
    this.routeService = options?.routeService ??
      new GoogleRoutesService({
        apiKey: process.env.GOOGLE_MAPS_API_KEY ?? null,
        cacheDbPath: process.env.ROUTE_CACHE_DB ?? "data/cache/routes.sqlite",
        maxConcurrentRequests: Number(
          process.env.ROUTE_MAX_CONCURRENT_REQUESTS ?? "8"
        )
      });
    this.totalFireBanService = options?.totalFireBanService ?? new TotalFireBanService();
  }

  private isSnapshotCompatible(snapshot: PersistedSnapshot): boolean {
    return snapshot.schemaVersion === SNAPSHOT_FORMAT_VERSION;
  }

  private hasFacilityDefinitions(snapshot: PersistedSnapshot): boolean {
    return Array.isArray(snapshot.availableFacilities) && snapshot.availableFacilities.length > 0;
  }

  private async loadPersistedSnapshot(): Promise<PersistedSnapshot | null> {
    if (!this.options.snapshotPath) {
      return null;
    }

    const raw = await readJsonFile<PersistedSnapshot>(this.options.snapshotPath);
    return raw ? normalizeSnapshot(raw) : null;
  }

  private async persistSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    this.memorySnapshot = snapshot;

    if (!this.options.snapshotPath) {
      return;
    }

    await writeJsonFile(this.options.snapshotPath, snapshot);
  }

  private isSnapshotFresh(snapshot: PersistedSnapshot): boolean {
    const fetchedAtMs = Date.parse(snapshot.fetchedAt);
    if (Number.isNaN(fetchedAtMs)) {
      return false;
    }

    return Date.now() - fetchedAtMs <= this.options.scrapeTtlMs;
  }

  private hasAnyMappedForest(snapshot: PersistedSnapshot): boolean {
    return snapshot.forests.some(
      (forest) => forest.latitude !== null && forest.longitude !== null
    );
  }

  private hasUnknownStatuses(snapshot: PersistedSnapshot): boolean {
    const intentionallyUnknownForests = new Set(
      (snapshot.matchDiagnostics?.unmatchedFacilitiesForests ?? [])
        .map((forestName) => normalizeForestLabel(forestName))
        .filter(Boolean)
    );

    return snapshot.forests.some((forest) => {
      if (forest.banStatus !== "UNKNOWN") {
        return false;
      }

      return !intentionallyUnknownForests.has(normalizeForestLabel(forest.forestName));
    });
  }

  private hasCompleteGeocodeDiagnostics(snapshot: PersistedSnapshot): boolean {
    return snapshot.forests.every((forest) => {
      const hasMissingCoordinates = forest.latitude === null || forest.longitude === null;

      if (!hasMissingCoordinates) {
        return true;
      }

      const diagnostics = forest.geocodeDiagnostics;

      if (!diagnostics || typeof diagnostics.reason !== "string" || !diagnostics.reason.trim()) {
        return false;
      }

      if (!Array.isArray(diagnostics.debug) || diagnostics.debug.length === 0) {
        return false;
      }

      return diagnostics.debug.every((entry) => {
        if (typeof entry !== "string" || !entry.trim()) {
          return false;
        }

        return entry !== MISSING_GEOCODE_ATTEMPTS_MESSAGE;
      });
    });
  }

  private hasCompleteTotalFireBanDiagnostics(snapshot: PersistedSnapshot): boolean {
    return snapshot.forests.every((forest) => {
      if (forest.totalFireBanStatus !== "UNKNOWN") {
        return true;
      }

      const diagnostics = forest.totalFireBanDiagnostics;
      if (!diagnostics || typeof diagnostics.reason !== "string" || !diagnostics.reason.trim()) {
        return false;
      }

      if (!Array.isArray(diagnostics.debug) || diagnostics.debug.length === 0) {
        return false;
      }

      return diagnostics.debug.every((entry) => {
        if (typeof entry !== "string" || !entry.trim()) {
          return false;
        }

        return entry !== MISSING_TOTAL_FIRE_BAN_DIAGNOSTICS_MESSAGE;
      });
    });
  }

  private reportProgress(
    progressCallback: ForestDataServiceInput["progressCallback"],
    progress: RefreshTaskProgress
  ): void {
    progressCallback?.(progress);
  }

  private async resolveCachedSnapshotOnly(): Promise<PersistedSnapshot | null> {
    if (
      this.memorySnapshot &&
      this.isSnapshotCompatible(this.memorySnapshot) &&
      this.hasFacilityDefinitions(this.memorySnapshot)
    ) {
      return this.memorySnapshot;
    }

    const persistedSnapshot = await this.loadPersistedSnapshot();
    if (persistedSnapshot && this.isSnapshotCompatible(persistedSnapshot)) {
      this.memorySnapshot = persistedSnapshot;
      return persistedSnapshot;
    }

    return null;
  }

  private async resolveSnapshot(
    forceRefresh = false,
    progressCallback?: ForestDataServiceInput["progressCallback"]
  ): Promise<PersistedSnapshot> {
    const fixturePath = process.env.FORESTRY_USE_FIXTURE;
    if (fixturePath) {
      const fixture = await readJsonFile<PersistedSnapshot>(fixturePath);
      if (!fixture) {
        throw new Error(`Fixture file could not be loaded: ${fixturePath}`);
      }

      return normalizeSnapshot(fixture);
    }

    if (
      !forceRefresh &&
      this.memorySnapshot &&
      this.isSnapshotCompatible(this.memorySnapshot) &&
      this.isSnapshotFresh(this.memorySnapshot) &&
      this.hasAnyMappedForest(this.memorySnapshot) &&
      this.hasCompleteGeocodeDiagnostics(this.memorySnapshot) &&
      this.hasCompleteTotalFireBanDiagnostics(this.memorySnapshot) &&
      !this.hasUnknownStatuses(this.memorySnapshot) &&
      this.hasFacilityDefinitions(this.memorySnapshot)
    ) {
      return this.memorySnapshot;
    }

    const persisted = await this.loadPersistedSnapshot();
    if (process.env.FORESTRY_SKIP_SCRAPE === "true") {
      if (persisted) {
        this.memorySnapshot = persisted;
        return persisted;
      }

      if (this.memorySnapshot) {
        return this.memorySnapshot;
      }

      throw new Error(
        "FORESTRY_SKIP_SCRAPE=true but no processed snapshot is available."
      );
    }

    const staleFallbackSnapshot = persisted ?? this.memorySnapshot;

    if (
      !forceRefresh &&
      persisted &&
      this.isSnapshotCompatible(persisted) &&
      this.isSnapshotFresh(persisted) &&
      this.hasAnyMappedForest(persisted) &&
      this.hasCompleteGeocodeDiagnostics(persisted) &&
      this.hasCompleteTotalFireBanDiagnostics(persisted) &&
      !this.hasUnknownStatuses(persisted) &&
      this.hasFacilityDefinitions(persisted)
    ) {
      this.memorySnapshot = persisted;
      return persisted;
    }

    if (this.snapshotResolvePromise) {
      return this.snapshotResolvePromise;
    }

    const snapshotResolvePromise = (async (): Promise<PersistedSnapshot> => {
      try {
        this.reportProgress(progressCallback, {
          phase: "SCRAPE",
          message: "Scraping Forestry and Total Fire Ban source pages.",
          completed: 0,
          total: null
        });

        const [scraped, totalFireBanSnapshot] = await Promise.all([
          this.scraper.scrape(),
          this.totalFireBanService.fetchCurrentSnapshot()
        ]);

        this.reportProgress(progressCallback, {
          phase: "SCRAPE",
          message: "Source pages loaded. Preparing geocoding.",
          completed: 1,
          total: 1
        });

        const warningSet = new Set([
          ...(scraped.warnings ?? []),
          ...(totalFireBanSnapshot.warnings ?? [])
        ]);
        const unresolvedForestStatusKeys = new Set(
          (staleFallbackSnapshot?.forests ?? [])
            .filter((forest) => forest.latitude === null || forest.longitude === null)
            .map((forest) => buildForestStatusKey(forest.forestName))
            .filter(Boolean)
        );
        const forestResult = await buildForestPoints(
          scraped.areas,
          scraped.directory,
          scraped.closures ?? [],
          totalFireBanSnapshot,
          warningSet,
          unresolvedForestStatusKeys,
          progressCallback,
          this.geocoder,
          this.totalFireBanService,
          this.options.sourceName
        );

        this.reportProgress(progressCallback, {
          phase: "PERSIST",
          message: "Persisting refreshed snapshot.",
          completed: 0,
          total: 1
        });

        const snapshot: PersistedSnapshot = {
          schemaVersion: SNAPSHOT_FORMAT_VERSION,
          fetchedAt: new Date().toISOString(),
          stale: false,
          sourceName: this.options.sourceName,
          availableFacilities: scraped.directory.filters,
          availableClosureTags: CLOSURE_TAG_DEFINITIONS,
          matchDiagnostics: forestResult.diagnostics,
          closureDiagnostics: forestResult.closureDiagnostics,
          forests: forestResult.forests,
          warnings: [...warningSet]
        };

        if (
          !this.hasAnyMappedForest(snapshot) &&
          staleFallbackSnapshot &&
          this.hasAnyMappedForest(staleFallbackSnapshot)
        ) {
          const fallbackSnapshot: PersistedSnapshot = {
            ...staleFallbackSnapshot,
            stale: true,
            warnings: [
              ...new Set([
                ...(staleFallbackSnapshot.warnings ?? []),
                "Latest refresh had no mappable coordinates; using previous mapped snapshot."
              ])
            ]
          };
          this.memorySnapshot = fallbackSnapshot;
          return fallbackSnapshot;
        }

        await this.persistSnapshot(snapshot);

        this.reportProgress(progressCallback, {
          phase: "PERSIST",
          message: "Snapshot persisted.",
          completed: 1,
          total: 1
        });

        return snapshot;
      } catch (error) {
        if (staleFallbackSnapshot) {
          const warning =
            error instanceof Error
              ? error.message
              : "Unknown scrape error while refreshing Forestry data.";

          const staleSnapshot: PersistedSnapshot = {
            ...staleFallbackSnapshot,
            stale: true,
            warnings: [...new Set([...(staleFallbackSnapshot.warnings ?? []), warning])]
          };
          this.memorySnapshot = staleSnapshot;
          return staleSnapshot;
        }

        throw error;
      }
    })();

    this.snapshotResolvePromise = snapshotResolvePromise;

    try {
      return await snapshotResolvePromise;
    } finally {
      if (this.snapshotResolvePromise === snapshotResolvePromise) {
        this.snapshotResolvePromise = null;
      }
    }
  }

  async getForestData(input?: ForestDataServiceInput): Promise<ForestApiResponse> {
    const snapshot = input?.preferCachedSnapshot
      ? await this.resolveCachedSnapshotOnly()
      : null;

    if (input?.preferCachedSnapshot && !snapshot) {
      return {
        fetchedAt: new Date().toISOString(),
        stale: true,
        sourceName: this.options.sourceName,
        availableFacilities: [],
        availableClosureTags: CLOSURE_TAG_DEFINITIONS,
        matchDiagnostics: {
          unmatchedFacilitiesForests: [],
          fuzzyMatches: []
        },
        closureDiagnostics: EMPTY_CLOSURE_DIAGNOSTICS,
        forests: [],
        nearestLegalSpot: null,
        warnings: [
          "Refresh is running in the background. Cached forest data is not available yet."
        ]
      };
    }

    const resolvedSnapshot =
      snapshot ??
      (await this.resolveSnapshot(input?.forceRefresh, input?.progressCallback));
    const avoidTolls = input?.avoidTolls ?? true;
    const routeResult = await addTravelMetrics(
      resolvedSnapshot.forests,
      input?.userLocation,
      avoidTolls,
      input?.progressCallback,
      this.routeService
    );
    const forests = routeResult.forests;

    return {
      fetchedAt: resolvedSnapshot.fetchedAt,
      stale: resolvedSnapshot.stale,
      sourceName: resolvedSnapshot.sourceName,
      availableFacilities: resolvedSnapshot.availableFacilities,
      availableClosureTags: resolvedSnapshot.availableClosureTags ?? CLOSURE_TAG_DEFINITIONS,
      matchDiagnostics: resolvedSnapshot.matchDiagnostics,
      closureDiagnostics: resolvedSnapshot.closureDiagnostics ?? EMPTY_CLOSURE_DIAGNOSTICS,
      forests,
      nearestLegalSpot: findNearestLegalSpot(forests, input?.userLocation),
      warnings: sanitizeWarnings([...(resolvedSnapshot.warnings ?? []), ...routeResult.warnings])
    };
  }
}
