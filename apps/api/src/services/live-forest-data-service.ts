import { readJsonFile, writeJsonFile } from "../utils/fs-cache.js";
import {
  findBestForestNameMatch,
  normalizeForestNameForMatch
} from "../utils/fuzzy-forest-match.js";
import {
  isLikelyStateForestName,
  normalizeForestLabel
} from "../utils/forest-name-validation.js";
import { slugify } from "../utils/slugs.js";
import { haversineDistanceKm } from "../utils/distance.js";
import { DEFAULT_FORESTRY_RAW_CACHE_PATH } from "../utils/default-cache-paths.js";
import { ForestryScraper } from "./forestry-scraper.js";
import {
  OSMGeocoder,
  type GeocodeLookupAttempt,
  type GeocodeResponse
} from "./osm-geocoder.js";
import {
  TotalFireBanService,
  UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT,
  type TotalFireBanLookupResult,
  type TotalFireBanSnapshot
} from "./total-fire-ban-service.js";
import {
  GoogleRoutesService,
  type RouteLookupResult,
  type RouteService
} from "./google-routes.js";
import type {
  BanStatus,
  ClosureImpactLevel,
  ClosureImpactSummary,
  ClosureMatchDiagnostics,
  ClosureStatus,
  ClosureTagDefinition,
  ClosureTagKey,
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestApiResponse,
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDataService,
  ForestDataServiceInput,
  ForestDirectorySnapshot,
  ForestGeocodeDiagnostics,
  ForestPoint,
  ForestTotalFireBanDiagnostics,
  NearestForest,
  PersistedSnapshot,
  RefreshTaskProgress,
  UserLocation
} from "../types/domain.js";

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

const FACILITY_MATCH_THRESHOLD = 0.62;
const CLOSURE_MATCH_THRESHOLD = 0.68;
const SNAPSHOT_FORMAT_VERSION = 7;
const FIRE_BAN_ENTRY_URL = "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const UNKNOWN_FIRE_BAN_AREA_NAME = "Not listed on Solid Fuel Fire Ban pages";
const UNKNOWN_FIRE_BAN_STATUS_TEXT =
  "Unknown (not listed on Solid Fuel Fire Ban pages)";
const MISSING_GEOCODE_ATTEMPTS_MESSAGE =
  "No geocoding attempt diagnostics were captured in this snapshot.";
const MISSING_TOTAL_FIRE_BAN_DIAGNOSTICS_MESSAGE =
  "No Total Fire Ban diagnostics were captured in this snapshot.";

const CLOSURE_TAG_DEFINITIONS: ClosureTagDefinition[] = [
  { key: "ROAD_ACCESS", label: "Road/trail access" },
  { key: "CAMPING", label: "Camping impact" },
  { key: "EVENT", label: "Event closure" },
  { key: "OPERATIONS", label: "Operations/safety" }
];

const EMPTY_CLOSURE_DIAGNOSTICS: ClosureMatchDiagnostics = {
  unmatchedNotices: [],
  fuzzyMatches: []
};

const CLOSURE_IMPACT_ORDER: Record<ClosureImpactLevel, number> = {
  NONE: 0,
  ADVISORY: 1,
  RESTRICTED: 2,
  CLOSED: 3,
  UNKNOWN: -1
};

interface FacilityMatchResult {
  facilities: Record<string, FacilityValue>;
  matchedDirectoryForestName: string | null;
  score: number | null;
  matchType: "EXACT" | "FUZZY" | "UNMATCHED";
}

interface ForestBanSummary {
  status: BanStatus;
  statusText: string;
}

const BAN_STATUS_PRIORITY: Record<BanStatus, number> = {
  UNKNOWN: 0,
  NOT_BANNED: 1,
  BANNED: 2
};

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

  private isFacilitiesMismatchWarning(warning: string): boolean {
    return /Facilities page includes .* not present on the Solid Fuel Fire Ban pages/i.test(
      warning
    );
  }

  private hasValidForestSampleInWarning(warning: string): boolean {
    if (!this.isFacilitiesMismatchWarning(warning)) {
      return true;
    }

    const separatorIndex = warning.indexOf(":");
    if (separatorIndex === -1) {
      return true;
    }

    const sampleSegment = warning
      .slice(separatorIndex + 1)
      .replace(/\(\+\d+\s+more\)\.?\s*$/i, "")
      .replace(/\.\s*$/, "");
    const sampleNames = sampleSegment
      .split(",")
      .map((entry) => normalizeForestLabel(entry))
      .filter(Boolean);

    if (!sampleNames.length) {
      return true;
    }

    return sampleNames.every((entry) => isLikelyStateForestName(entry));
  }

  private sanitizeMatchDiagnostics(
    diagnostics: FacilityMatchDiagnostics | undefined
  ): FacilityMatchDiagnostics {
    const unmatchedFacilitiesForests = [
      ...new Set(
        (diagnostics?.unmatchedFacilitiesForests ?? [])
          .map((entry) => normalizeForestLabel(entry))
          .filter((entry) => isLikelyStateForestName(entry))
      )
    ].sort((left, right) => left.localeCompare(right));

    const fuzzyMatches = (diagnostics?.fuzzyMatches ?? [])
      .map((match) => ({
        fireBanForestName: normalizeForestLabel(match.fireBanForestName),
        facilitiesForestName: normalizeForestLabel(match.facilitiesForestName),
        score: match.score
      }))
      .filter(
        (match) =>
          isLikelyStateForestName(match.fireBanForestName) &&
          isLikelyStateForestName(match.facilitiesForestName)
      )
      .sort((left, right) => left.fireBanForestName.localeCompare(right.fireBanForestName));

    return {
      unmatchedFacilitiesForests,
      fuzzyMatches
    };
  }

  private sanitizeClosureDiagnostics(
    diagnostics: ClosureMatchDiagnostics | undefined
  ): ClosureMatchDiagnostics {
    const unmatchedNotices = [...(diagnostics?.unmatchedNotices ?? [])];
    const fuzzyMatches = [...(diagnostics?.fuzzyMatches ?? [])]
      .filter(
        (match) =>
          typeof match.noticeId === "string" &&
          typeof match.noticeTitle === "string" &&
          typeof match.matchedForestName === "string" &&
          typeof match.score === "number"
      )
      .sort((left, right) => left.noticeTitle.localeCompare(right.noticeTitle));

    return {
      unmatchedNotices,
      fuzzyMatches
    };
  }

  private toClosureStatus(value: unknown): ClosureStatus {
    if (value === "NONE" || value === "NOTICE" || value === "PARTIAL" || value === "CLOSED") {
      return value;
    }

    return "NONE";
  }

  private toClosureImpactLevel(value: unknown): ClosureImpactLevel {
    if (
      value === "NONE" ||
      value === "ADVISORY" ||
      value === "RESTRICTED" ||
      value === "CLOSED" ||
      value === "UNKNOWN"
    ) {
      return value;
    }

    return "NONE";
  }

  private sanitizeWarnings(warnings: string[]): string[] {
    return [...new Set(warnings)].filter((warning) => {
      if (/Facilities data could not be matched for/i.test(warning)) {
        return false;
      }

      if (!this.hasValidForestSampleInWarning(warning)) {
        return false;
      }

      return true;
    });
  }

  private isSnapshotCompatible(snapshot: PersistedSnapshot): boolean {
    return snapshot.schemaVersion === SNAPSHOT_FORMAT_VERSION;
  }

  private normalizeSnapshot(snapshot: PersistedSnapshot): PersistedSnapshot {
    const availableFacilities = snapshot.availableFacilities ?? [];
    const availableClosureTags = snapshot.availableClosureTags ?? CLOSURE_TAG_DEFINITIONS;
    const facilityKeys = availableFacilities.map((facility) => facility.key);
    const matchDiagnostics = this.sanitizeMatchDiagnostics(snapshot.matchDiagnostics);
    const closureDiagnostics = this.sanitizeClosureDiagnostics(snapshot.closureDiagnostics);
    const warnings = this.sanitizeWarnings(snapshot.warnings ?? []);

    const forests = snapshot.forests.map((forest) => {
      const existingFacilities = forest.facilities ?? {};
      const facilities = Object.fromEntries(
        facilityKeys.map((key) => {
          const value = existingFacilities[key];
          if (typeof value === "boolean") {
            return [key, value];
          }

          return [key, null];
        })
      ) as Record<string, FacilityValue>;

      const normalizedGeocodeDiagnostics =
        forest.geocodeDiagnostics &&
        typeof forest.geocodeDiagnostics === "object" &&
        typeof forest.geocodeDiagnostics.reason === "string"
          ? {
              reason: forest.geocodeDiagnostics.reason,
              debug: Array.isArray(forest.geocodeDiagnostics.debug)
                ? forest.geocodeDiagnostics.debug.filter((entry): entry is string =>
                    typeof entry === "string"
                  )
                : []
            }
          : null;

      const normalizedTotalFireBanStatus =
        forest.totalFireBanStatus === "BANNED" ||
        forest.totalFireBanStatus === "NOT_BANNED" ||
        forest.totalFireBanStatus === "UNKNOWN"
          ? forest.totalFireBanStatus
          : "UNKNOWN";

      const normalizedTotalFireBanStatusText =
        typeof forest.totalFireBanStatusText === "string" &&
        forest.totalFireBanStatusText.trim()
          ? forest.totalFireBanStatusText
          : normalizedTotalFireBanStatus === "BANNED"
            ? "Total Fire Ban"
            : normalizedTotalFireBanStatus === "NOT_BANNED"
              ? "No Total Fire Ban"
              : UNKNOWN_TOTAL_FIRE_BAN_STATUS_TEXT;

      const normalizedTotalFireBanDiagnostics =
        forest.totalFireBanDiagnostics &&
        typeof forest.totalFireBanDiagnostics === "object" &&
        typeof forest.totalFireBanDiagnostics.reason === "string"
          ? {
              reason: forest.totalFireBanDiagnostics.reason,
              lookupCode:
                forest.totalFireBanDiagnostics.lookupCode === "MATCHED" ||
                forest.totalFireBanDiagnostics.lookupCode === "NO_COORDINATES" ||
                forest.totalFireBanDiagnostics.lookupCode === "NO_AREA_MATCH" ||
                forest.totalFireBanDiagnostics.lookupCode === "MISSING_AREA_STATUS" ||
                forest.totalFireBanDiagnostics.lookupCode === "DATA_UNAVAILABLE"
                  ? forest.totalFireBanDiagnostics.lookupCode
                  : "DATA_UNAVAILABLE",
              fireWeatherAreaName:
                typeof forest.totalFireBanDiagnostics.fireWeatherAreaName === "string" &&
                forest.totalFireBanDiagnostics.fireWeatherAreaName.trim()
                  ? forest.totalFireBanDiagnostics.fireWeatherAreaName
                  : null,
              debug: Array.isArray(forest.totalFireBanDiagnostics.debug)
                ? forest.totalFireBanDiagnostics.debug.filter((entry): entry is string =>
                    typeof entry === "string"
                  )
                : []
            }
          : null;

      const closureStatus = this.toClosureStatus(forest.closureStatus);
      const closureNotices = Array.isArray(forest.closureNotices) ? forest.closureNotices : [];
      const closureTags = Object.fromEntries(
        CLOSURE_TAG_DEFINITIONS.map((definition) => [
          definition.key,
          forest.closureTags?.[definition.key] === true
        ])
      ) as Partial<Record<ClosureTagKey, boolean>>;
      const closureImpactSummary: ClosureImpactSummary = {
        campingImpact: this.toClosureImpactLevel(forest.closureImpactSummary?.campingImpact),
        access2wdImpact: this.toClosureImpactLevel(forest.closureImpactSummary?.access2wdImpact),
        access4wdImpact: this.toClosureImpactLevel(forest.closureImpactSummary?.access4wdImpact)
      };

      return {
        ...forest,
        forestUrl: typeof forest.forestUrl === "string" ? forest.forestUrl : null,
        totalFireBanStatus: normalizedTotalFireBanStatus,
        totalFireBanStatusText: normalizedTotalFireBanStatusText,
        totalFireBanDiagnostics: normalizedTotalFireBanDiagnostics,
        geocodeDiagnostics: normalizedGeocodeDiagnostics,
        facilities,
        closureStatus,
        closureNotices,
        closureTags,
        closureImpactSummary
      };
    });

    return {
      ...snapshot,
      schemaVersion: typeof snapshot.schemaVersion === "number" ? snapshot.schemaVersion : 0,
      availableFacilities,
      availableClosureTags,
      matchDiagnostics,
      closureDiagnostics,
      warnings,
      forests
    };
  }

  private hasFacilityDefinitions(snapshot: PersistedSnapshot): boolean {
    return Array.isArray(snapshot.availableFacilities) && snapshot.availableFacilities.length > 0;
  }

  private async loadPersistedSnapshot(): Promise<PersistedSnapshot | null> {
    if (!this.options.snapshotPath) {
      return null;
    }

    const raw = await readJsonFile<PersistedSnapshot>(this.options.snapshotPath);
    return raw ? this.normalizeSnapshot(raw) : null;
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

      return this.normalizeSnapshot(fixture);
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
            .map((forest) => this.buildForestStatusKey(forest.forestName))
            .filter(Boolean)
        );
        const forestResult = await this.buildForestPoints(
          scraped.areas,
          scraped.directory,
          scraped.closures ?? [],
          totalFireBanSnapshot,
          warningSet,
          unresolvedForestStatusKeys,
          progressCallback
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

  private getGeocodeAttempts(response: GeocodeResponse | null | undefined): GeocodeLookupAttempt[] {
    if (!response?.attempts) {
      return [];
    }

    return response.attempts;
  }

  private describeGeocodeAttempt(prefix: string, attempt: GeocodeLookupAttempt): string {
    const details: string[] = [
      `${prefix}: ${attempt.outcome}`,
      `provider=${attempt.provider}`,
      `query=${attempt.query}`
    ];
    if (attempt.httpStatus !== null) {
      details.push(`http=${attempt.httpStatus}`);
    }
    if (attempt.resultCount !== null) {
      details.push(`results=${attempt.resultCount}`);
    }
    if (attempt.errorMessage) {
      details.push(`error=${attempt.errorMessage}`);
    }

    return details.join(" | ");
  }

  private selectGeocodeFailureReason(attempts: GeocodeLookupAttempt[]): string {
    if (attempts.some((attempt) => attempt.outcome === "LIMIT_REACHED")) {
      return "Geocoding lookup limit reached before coordinates were resolved.";
    }

    if (attempts.some((attempt) => attempt.outcome === "GOOGLE_API_KEY_MISSING")) {
      return "Google Places geocoding is unavailable because GOOGLE_MAPS_API_KEY is missing.";
    }

    if (
      attempts.some(
        (attempt) => attempt.outcome === "HTTP_ERROR" || attempt.outcome === "REQUEST_FAILED"
      )
    ) {
      return "Geocoding request failed before coordinates were resolved.";
    }

    if (
      attempts.some(
        (attempt) =>
          attempt.outcome === "EMPTY_RESULT" || attempt.outcome === "INVALID_COORDINATES"
      )
    ) {
      return "No usable geocoding results were returned for this forest.";
    }

    return "Coordinates were unavailable after forest and area geocoding.";
  }

  private buildGeocodeDiagnostics(
    forestLookup: GeocodeResponse,
    areaLookup?: GeocodeResponse | null
  ): ForestGeocodeDiagnostics {
    const forestAttempts = this.getGeocodeAttempts(forestLookup);
    const areaAttempts = this.getGeocodeAttempts(areaLookup);
    const allAttempts = [...forestAttempts, ...areaAttempts];
    const debug = [
      ...forestAttempts.map((attempt) => this.describeGeocodeAttempt("Forest lookup", attempt)),
      ...areaAttempts.map((attempt) => this.describeGeocodeAttempt("Area fallback", attempt))
    ];

    if (!debug.length) {
      debug.push("No geocoding attempt diagnostics were captured in this snapshot.");
    }

    return {
      reason: this.selectGeocodeFailureReason(allAttempts),
      debug
    };
  }

  private shouldUseAreaFallbackForForestLookup(forestLookup: GeocodeResponse): boolean {
    const attempts = this.getGeocodeAttempts(forestLookup);

    if (!attempts.length) {
      return true;
    }

    const hasNoResultOutcome = attempts.some(
      (attempt) =>
        attempt.outcome === "EMPTY_RESULT" || attempt.outcome === "INVALID_COORDINATES"
    );

    const hasTransientOrConfigFailure = attempts.some(
      (attempt) =>
        attempt.outcome === "LIMIT_REACHED" ||
        attempt.outcome === "HTTP_ERROR" ||
        attempt.outcome === "REQUEST_FAILED" ||
        attempt.outcome === "GOOGLE_API_KEY_MISSING"
    );

    return hasNoResultOutcome && !hasTransientOrConfigFailure;
  }

  private buildTotalFireBanDiagnostics(
    totalFireBanLookup: TotalFireBanLookupResult,
    latitude: number | null,
    longitude: number | null,
    totalFireBanSnapshot: TotalFireBanSnapshot
  ): ForestTotalFireBanDiagnostics | null {
    if (totalFireBanLookup.status !== "UNKNOWN") {
      return null;
    }

    const reason =
      totalFireBanLookup.lookupCode === "NO_COORDINATES"
        ? "Coordinates were unavailable, so Total Fire Ban lookup could not run."
        : totalFireBanLookup.lookupCode === "NO_AREA_MATCH"
          ? "Coordinates did not match a NSW RFS fire weather area polygon."
          : totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS"
            ? "A fire weather area was matched, but the status feed had no status entry for that area."
            : totalFireBanLookup.lookupCode === "DATA_UNAVAILABLE"
              ? "Total Fire Ban source data was unavailable or incomplete during lookup."
              : "Matched fire weather area returned an unknown Total Fire Ban status value.";

    const debug = [
      `lookupCode=${totalFireBanLookup.lookupCode}`,
      `statusText=${totalFireBanLookup.statusText}`,
      `latitude=${latitude === null ? "null" : String(latitude)}`,
      `longitude=${longitude === null ? "null" : String(longitude)}`,
      `fireWeatherAreaName=${totalFireBanLookup.fireWeatherAreaName ?? "null"}`,
      `snapshotAreaStatuses=${totalFireBanSnapshot.areaStatuses.length}`,
      `snapshotGeoAreas=${totalFireBanSnapshot.geoAreas.length}`,
      `snapshotWarnings=${totalFireBanSnapshot.warnings.length}`
    ];

    if (totalFireBanLookup.rawStatusText !== null) {
      debug.push(`rawStatusText=${totalFireBanLookup.rawStatusText}`);
    }

    return {
      reason,
      lookupCode: totalFireBanLookup.lookupCode,
      fireWeatherAreaName: totalFireBanLookup.fireWeatherAreaName,
      debug
    };
  }

  private collectGeocodeWarnings(
    warningSet: Set<string>,
    response: GeocodeResponse | null | undefined
  ): void {
    for (const warning of response?.warnings ?? []) {
      warningSet.add(warning);
    }
  }

  private buildUnknownFacilities(directory: ForestDirectorySnapshot): Record<string, FacilityValue> {
    return Object.fromEntries(
      directory.filters.map((facility) => [facility.key, null])
    ) as Record<string, FacilityValue>;
  }

  private normalizeBanStatusText(status: BanStatus, statusText: string): string {
    const normalized = statusText.trim();
    if (normalized) {
      return normalized;
    }

    if (status === "BANNED") {
      return "Solid Fuel Fire Ban";
    }

    if (status === "NOT_BANNED") {
      return "No Solid Fuel Fire Ban";
    }

    return "Unknown";
  }

  private buildForestStatusKey(forestName: string): string {
    return normalizeForestLabel(forestName).toLowerCase();
  }

  private buildMostRestrictiveBanByForest(
    areas: ForestAreaWithForests[]
  ): Map<string, ForestBanSummary> {
    const byForest = new Map<string, ForestBanSummary>();

    for (const area of areas) {
      const uniqueForestNames = [...new Set(
        area.forests.map((forest) => normalizeForestLabel(forest)).filter(Boolean)
      )];
      const candidateSummary: ForestBanSummary = {
        status: area.status,
        statusText: this.normalizeBanStatusText(area.status, area.statusText)
      };

      for (const forestName of uniqueForestNames) {
        const key = this.buildForestStatusKey(forestName);
        const existingSummary = byForest.get(key);

        if (
          !existingSummary ||
          BAN_STATUS_PRIORITY[candidateSummary.status] >
            BAN_STATUS_PRIORITY[existingSummary.status]
        ) {
          byForest.set(key, candidateSummary);
        }
      }
    }

    return byForest;
  }

  private hasDirectionalConflict(leftName: string, rightName: string): boolean {
    const left = normalizeForestNameForMatch(leftName);
    const right = normalizeForestNameForMatch(rightName);

    if (
      (/\beast\b/.test(left) && /\bwest\b/.test(right)) ||
      (/\bwest\b/.test(left) && /\beast\b/.test(right))
    ) {
      return true;
    }

    if (
      (/\bnorth\b/.test(left) && /\bsouth\b/.test(right)) ||
      (/\bsouth\b/.test(left) && /\bnorth\b/.test(right))
    ) {
      return true;
    }

    return false;
  }

  private createMatchedFacilities(
    directory: ForestDirectorySnapshot,
    byForestName: Map<string, Record<string, boolean>>,
    sourceForestNames: string[]
  ): Record<string, FacilityValue> {
    return Object.fromEntries(
      directory.filters.map((filter) => [
        filter.key,
        sourceForestNames.some((name) => Boolean(byForestName.get(name)?.[filter.key]))
      ])
    ) as Record<string, FacilityValue>;
  }

  private buildFacilityAssignments(
    fireBanForestNames: string[],
    directory: ForestDirectorySnapshot,
    byForestName: Map<string, Record<string, boolean>>
  ): {
    byFireBanForestName: Map<string, FacilityMatchResult>;
    diagnostics: FacilityMatchDiagnostics;
  } {
    const byFireBanForestName = new Map<string, FacilityMatchResult>();
    const unknown = this.buildUnknownFacilities(directory);

    if (!directory.filters.length || !directory.forests.length) {
      for (const forestName of fireBanForestNames) {
        byFireBanForestName.set(forestName, {
          facilities: unknown,
          matchedDirectoryForestName: null,
          score: null,
          matchType: "UNMATCHED"
        });
      }

      return {
        byFireBanForestName,
        diagnostics: {
          unmatchedFacilitiesForests: directory.forests.map((entry) => entry.forestName),
          fuzzyMatches: []
        }
      };
    }

    const uniqueFireBanNames = [...new Set(fireBanForestNames)];
    const availableDirectoryNames = new Set(byForestName.keys());
    const byNormalizedDirectoryName = new Map<string, string[]>();
    const fireBanCountByNormalizedName = new Map<string, number>();

    for (const fireBanForestName of uniqueFireBanNames) {
      const normalized = normalizeForestNameForMatch(fireBanForestName);
      fireBanCountByNormalizedName.set(
        normalized,
        (fireBanCountByNormalizedName.get(normalized) ?? 0) + 1
      );
    }

    for (const directoryForestName of availableDirectoryNames) {
      const normalized = normalizeForestNameForMatch(directoryForestName);
      const rows = byNormalizedDirectoryName.get(normalized) ?? [];
      rows.push(directoryForestName);
      byNormalizedDirectoryName.set(normalized, rows);
    }

    const unresolvedFireBanNames: string[] = [];

    // Pass 1: exact normalized matching, one-to-one.
    for (const fireBanForestName of uniqueFireBanNames) {
      const normalized = normalizeForestNameForMatch(fireBanForestName);
      const exactCandidates = (byNormalizedDirectoryName.get(normalized) ?? [])
        .filter((candidate) => availableDirectoryNames.has(candidate))
        .sort((left, right) => left.localeCompare(right));

      if (!exactCandidates.length) {
        unresolvedFireBanNames.push(fireBanForestName);
        continue;
      }

      const allowVariantMerge =
        exactCandidates.length > 1 && (fireBanCountByNormalizedName.get(normalized) ?? 0) === 1;
      const matchedExactNames = allowVariantMerge ? exactCandidates : [exactCandidates[0]!];

      byFireBanForestName.set(fireBanForestName, {
        facilities: this.createMatchedFacilities(directory, byForestName, matchedExactNames),
        matchedDirectoryForestName: matchedExactNames[0]!,
        score: 1,
        matchType: "EXACT"
      });
      for (const matchedName of matchedExactNames) {
        availableDirectoryNames.delete(matchedName);
      }
    }

    // Pass 2: fuzzy matching only among remaining unmatched names/candidates.
    for (const fireBanForestName of unresolvedFireBanNames) {
      const candidates = [...availableDirectoryNames];
      const fuzzy = findBestForestNameMatch(fireBanForestName, candidates);

      if (
        !fuzzy ||
        fuzzy.score < FACILITY_MATCH_THRESHOLD ||
        this.hasDirectionalConflict(fireBanForestName, fuzzy.candidateName)
      ) {
        byFireBanForestName.set(fireBanForestName, {
          facilities: unknown,
          matchedDirectoryForestName: null,
          score: fuzzy?.score ?? null,
          matchType: "UNMATCHED"
        });
        continue;
      }

      byFireBanForestName.set(fireBanForestName, {
        facilities: this.createMatchedFacilities(
          directory,
          byForestName,
          [fuzzy.candidateName]
        ),
        matchedDirectoryForestName: fuzzy.candidateName,
        score: fuzzy.score,
        matchType: "FUZZY"
      });
      availableDirectoryNames.delete(fuzzy.candidateName);
    }

    const fuzzyMatches = [...byFireBanForestName.entries()]
      .filter(([, match]) => match.matchType === "FUZZY")
      .map(([fireBanForestName, match]) => ({
        fireBanForestName,
        facilitiesForestName: match.matchedDirectoryForestName!,
        score: match.score ?? 0
      }))
      .sort((left, right) => left.fireBanForestName.localeCompare(right.fireBanForestName));

    return {
      byFireBanForestName,
      diagnostics: {
        unmatchedFacilitiesForests: [...availableDirectoryNames].sort((left, right) =>
          left.localeCompare(right)
        ),
        fuzzyMatches
      }
    };
  }

  private isClosureNoticeActive(notice: ForestClosureNotice, nowMs: number): boolean {
    const listedAtMs = notice.listedAt ? Date.parse(notice.listedAt) : Number.NaN;
    if (!Number.isNaN(listedAtMs) && listedAtMs > nowMs) {
      return false;
    }

    const untilAtMs = notice.untilAt ? Date.parse(notice.untilAt) : Number.NaN;
    if (!Number.isNaN(untilAtMs) && untilAtMs < nowMs) {
      return false;
    }

    return true;
  }

  private mergeClosureImpactLevel(
    leftImpact: ClosureImpactLevel,
    rightImpact: ClosureImpactLevel
  ): ClosureImpactLevel {
    if (CLOSURE_IMPACT_ORDER[rightImpact] > CLOSURE_IMPACT_ORDER[leftImpact]) {
      return rightImpact;
    }

    return leftImpact;
  }

  private buildClosureTagsFromNotices(
    notices: ForestClosureNotice[]
  ): Partial<Record<ClosureTagKey, boolean>> {
    const tags: Partial<Record<ClosureTagKey, boolean>> = Object.fromEntries(
      CLOSURE_TAG_DEFINITIONS.map((definition) => [definition.key, false])
    ) as Partial<Record<ClosureTagKey, boolean>>;

    for (const notice of notices) {
      for (const tagKey of notice.tags) {
        tags[tagKey] = true;
      }
    }

    return tags;
  }

  private buildClosureStatusFromNotices(notices: ForestClosureNotice[]): ClosureStatus {
    if (notices.some((notice) => notice.status === "CLOSED")) {
      return "CLOSED";
    }

    if (notices.some((notice) => notice.status === "PARTIAL")) {
      return "PARTIAL";
    }

    if (notices.length > 0) {
      return "NOTICE";
    }

    return "NONE";
  }

  private buildClosureImpactSummaryFromNotices(
    notices: ForestClosureNotice[]
  ): ClosureImpactSummary {
    const summary: ClosureImpactSummary = {
      campingImpact: "NONE",
      access2wdImpact: "NONE",
      access4wdImpact: "NONE"
    };

    for (const notice of notices) {
      const impact = notice.structuredImpact;
      if (!impact) {
        continue;
      }

      summary.campingImpact = this.mergeClosureImpactLevel(
        summary.campingImpact,
        impact.campingImpact
      );
      summary.access2wdImpact = this.mergeClosureImpactLevel(
        summary.access2wdImpact,
        impact.access2wdImpact
      );
      summary.access4wdImpact = this.mergeClosureImpactLevel(
        summary.access4wdImpact,
        impact.access4wdImpact
      );
    }

    return summary;
  }

  private buildClosureAssignments(
    notices: ForestClosureNotice[],
    forestNames: string[]
  ): {
    byForestName: Map<string, ForestClosureNotice[]>;
    diagnostics: ClosureMatchDiagnostics;
  } {
    const byForestName = new Map<string, ForestClosureNotice[]>();
    for (const forestName of forestNames) {
      byForestName.set(forestName, []);
    }

    const unmatchedNotices: ForestClosureNotice[] = [];
    const fuzzyMatches: ClosureMatchDiagnostics["fuzzyMatches"] = [];
    const nowMs = Date.now();

    for (const notice of notices) {
      if (!this.isClosureNoticeActive(notice, nowMs)) {
        continue;
      }

      const hint = notice.forestNameHint ? normalizeForestLabel(notice.forestNameHint) : "";
      if (!hint) {
        unmatchedNotices.push(notice);
        continue;
      }

      const exactMatchForestName = forestNames.find(
        (forestName) => normalizeForestLabel(forestName) === hint
      );

      if (exactMatchForestName) {
        const existing = byForestName.get(exactMatchForestName) ?? [];
        existing.push(notice);
        byForestName.set(exactMatchForestName, existing);
        continue;
      }

      const fuzzyMatch = findBestForestNameMatch(hint, forestNames);
      if (!fuzzyMatch || fuzzyMatch.score < CLOSURE_MATCH_THRESHOLD) {
        unmatchedNotices.push(notice);
        continue;
      }

      const existing = byForestName.get(fuzzyMatch.candidateName) ?? [];
      existing.push(notice);
      byForestName.set(fuzzyMatch.candidateName, existing);
      fuzzyMatches.push({
        noticeId: notice.id,
        noticeTitle: notice.title,
        matchedForestName: fuzzyMatch.candidateName,
        score: fuzzyMatch.score
      });
    }

    return {
      byForestName,
      diagnostics: {
        unmatchedNotices,
        fuzzyMatches
      }
    };
  }

  private async buildForestPoints(
    areas: ForestAreaWithForests[],
    directory: ForestDirectorySnapshot,
    closureNotices: ForestClosureNotice[],
    totalFireBanSnapshot: TotalFireBanSnapshot,
    warningSet: Set<string>,
    unresolvedForestStatusKeys: Set<string>,
    progressCallback?: ForestDataServiceInput["progressCallback"]
  ): Promise<{
    forests: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[];
    diagnostics: FacilityMatchDiagnostics;
    closureDiagnostics: ClosureMatchDiagnostics;
  }> {
    if ("resetLookupBudgetForRun" in this.geocoder) {
      this.geocoder.resetLookupBudgetForRun();
    }

    const points: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[] = [];
    const areaGeocodeMap = new Map<string, Awaited<ReturnType<OSMGeocoder["geocodeArea"]>>>();
    const byForestName = new Map(
      directory.forests.map((entry) => [entry.forestName, entry.facilities] as const)
    );
    const byForestUrl = new Map(
      directory.forests.map((entry) => [entry.forestName, entry.forestUrl ?? null] as const)
    );
    const mostRestrictiveBanByForest = this.buildMostRestrictiveBanByForest(areas);
    const uniqueFireBanNames = [...new Set(
      areas.flatMap((area) => area.forests.map((forest) => forest.trim()).filter(Boolean))
    )];
    const facilityAssignments = this.buildFacilityAssignments(
      uniqueFireBanNames,
      directory,
      byForestName
    );
    const totalForestGeocodeCount =
      areas.reduce(
        (runningTotal, area) =>
          runningTotal + new Set(area.forests.map((forest) => forest.trim()).filter(Boolean)).size,
        0
      ) + facilityAssignments.diagnostics.unmatchedFacilitiesForests.length;
    const totalFireBanNoAreaMatchForests = new Set<string>();
    const totalFireBanMissingStatusAreas = new Set<string>();
    let completedAreaGeocodes = 0;
    let completedForestGeocodes = 0;

    this.reportProgress(progressCallback, {
      phase: "GEOCODE_AREAS",
      message: "Resolving area coordinates.",
      completed: completedAreaGeocodes,
      total: areas.length
    });

    // Prioritize one lookup per area first so every forest can fall back to an area centroid.
    for (const area of areas) {
      const areaGeocode = await this.geocoder.geocodeArea(area.areaName, area.areaUrl);
      areaGeocodeMap.set(area.areaUrl, areaGeocode);
      this.collectGeocodeWarnings(warningSet, areaGeocode);
      completedAreaGeocodes += 1;
      this.reportProgress(progressCallback, {
        phase: "GEOCODE_AREAS",
        message: `Resolving area coordinates (${completedAreaGeocodes}/${areas.length}).`,
        completed: completedAreaGeocodes,
        total: areas.length
      });
    }

    this.reportProgress(progressCallback, {
      phase: "GEOCODE_FORESTS",
      message: "Resolving forest coordinates.",
      completed: completedForestGeocodes,
      total: totalForestGeocodeCount
    });

    if ("resetLookupBudgetForRun" in this.geocoder) {
      this.geocoder.resetLookupBudgetForRun();
    }

    const sortForestNamesForRetryPriority = (forestNames: string[]): string[] =>
      [...forestNames].sort((leftForestName, rightForestName) => {
        const leftPriority = unresolvedForestStatusKeys.has(
          this.buildForestStatusKey(leftForestName)
        )
          ? 0
          : 1;
        const rightPriority = unresolvedForestStatusKeys.has(
          this.buildForestStatusKey(rightForestName)
        )
          ? 0
          : 1;

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return leftForestName.localeCompare(rightForestName);
      });

    for (const area of areas) {
      const uniqueForestNames = sortForestNamesForRetryPriority(
        [...new Set(area.forests.map((forest) => forest.trim()).filter(Boolean))]
      );
      const areaGeocode = areaGeocodeMap.get(area.areaUrl) ?? {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null,
        provider: null
      };

      for (const forestName of uniqueForestNames) {
        if (!forestName) {
          continue;
        }

        const banSummary =
          mostRestrictiveBanByForest.get(this.buildForestStatusKey(forestName)) ?? {
            status: area.status,
            statusText: this.normalizeBanStatusText(area.status, area.statusText)
          };
        const geocodeStartMs = Date.now();
        const geocode = await this.geocoder.geocodeForest(forestName, area.areaName);
        const geocodeElapsedMs = Date.now() - geocodeStartMs;
        const geocodeOutcomes = (geocode.attempts ?? []).map((attempt) => `${attempt.provider}:${attempt.outcome}`);
        const wasCacheHit = geocodeOutcomes.some((outcome) => outcome === "CACHE:CACHE_HIT");
        console.log(
          `[GEOCODE_FORESTS] ${forestName} | ${wasCacheHit ? "CACHE_HIT" : "LOOKUP"} | ${geocodeElapsedMs}ms | outcomes=[${geocodeOutcomes.join(", ")}]`
        );
        this.collectGeocodeWarnings(warningSet, geocode);
        completedForestGeocodes += 1;
        this.reportProgress(progressCallback, {
          phase: "GEOCODE_FORESTS",
          message: `Resolving forest coordinates (${completedForestGeocodes}/${totalForestGeocodeCount}).`,
          completed: completedForestGeocodes,
          total: totalForestGeocodeCount
        });
        const usedAreaFallback =
          geocode.latitude === null &&
          areaGeocode.latitude !== null &&
          this.shouldUseAreaFallbackForForestLookup(geocode);
        const resolvedLatitude = usedAreaFallback ? areaGeocode.latitude : geocode.latitude;
        const resolvedLongitude = usedAreaFallback ? areaGeocode.longitude : geocode.longitude;
        const geocodeDiagnostics =
          resolvedLatitude === null || resolvedLongitude === null
            ? this.buildGeocodeDiagnostics(geocode, areaGeocode)
            : null;
        const facilityMatch =
          facilityAssignments.byFireBanForestName.get(forestName) ??
          ({
            facilities: this.buildUnknownFacilities(directory),
            matchedDirectoryForestName: null,
            score: null,
            matchType: "UNMATCHED"
          } satisfies FacilityMatchResult);
        const totalFireBanLookup = this.totalFireBanService.lookupStatusByCoordinates(
          totalFireBanSnapshot,
          resolvedLatitude,
          resolvedLongitude
        );
        const totalFireBanDiagnostics = this.buildTotalFireBanDiagnostics(
          totalFireBanLookup,
          resolvedLatitude,
          resolvedLongitude,
          totalFireBanSnapshot
        );

        if (totalFireBanLookup.lookupCode === "NO_AREA_MATCH") {
          totalFireBanNoAreaMatchForests.add(forestName);
        } else if (totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS") {
          if (totalFireBanLookup.fireWeatherAreaName) {
            totalFireBanMissingStatusAreas.add(totalFireBanLookup.fireWeatherAreaName);
          }
        }

        points.push({
          id: `${slugify(area.areaName)}-${slugify(forestName)}`,
          source: this.options.sourceName,
          areaName: area.areaName,
          areaUrl: area.areaUrl,
          forestName,
          forestUrl: facilityMatch.matchedDirectoryForestName
            ? (byForestUrl.get(facilityMatch.matchedDirectoryForestName) ?? null)
            : null,
          banStatus: banSummary.status,
          banStatusText: banSummary.statusText,
          totalFireBanStatus: totalFireBanLookup.status,
          totalFireBanStatusText: totalFireBanLookup.statusText,
          totalFireBanDiagnostics,
          latitude: resolvedLatitude,
          longitude: resolvedLongitude,
          geocodeName: usedAreaFallback
            ? `${areaGeocode.displayName} (area centroid approximation)`
            : geocode.displayName,
          geocodeConfidence: geocode.confidence ?? areaGeocode.confidence,
          geocodeDiagnostics,
          facilities: facilityMatch.facilities
        });
      }
    }

    const unmatchedFacilitiesForests = sortForestNamesForRetryPriority(
      facilityAssignments.diagnostics.unmatchedFacilitiesForests
    );

    for (const forestName of unmatchedFacilitiesForests) {
      const geocodeStartMs = Date.now();
      const geocode = await this.geocoder.geocodeForest(forestName);
      const geocodeElapsedMs = Date.now() - geocodeStartMs;
      const geocodeOutcomes = (geocode.attempts ?? []).map((attempt) => `${attempt.provider}:${attempt.outcome}`);
      const wasCacheHit = geocodeOutcomes.some((outcome) => outcome === "CACHE:CACHE_HIT");
      console.log(
        `[GEOCODE_FORESTS] ${forestName} (unmatched) | ${wasCacheHit ? "CACHE_HIT" : "LOOKUP"} | ${geocodeElapsedMs}ms | outcomes=[${geocodeOutcomes.join(", ")}]`
      );
      this.collectGeocodeWarnings(warningSet, geocode);
      completedForestGeocodes += 1;
      this.reportProgress(progressCallback, {
        phase: "GEOCODE_FORESTS",
        message: `Resolving forest coordinates (${completedForestGeocodes}/${totalForestGeocodeCount}).`,
        completed: completedForestGeocodes,
        total: totalForestGeocodeCount
      });
      const geocodeDiagnostics =
        geocode.latitude === null || geocode.longitude === null
          ? this.buildGeocodeDiagnostics(geocode)
          : null;
      const directoryFacilities = this.createMatchedFacilities(
        directory,
        byForestName,
        [forestName]
      );
      const totalFireBanLookup = this.totalFireBanService.lookupStatusByCoordinates(
        totalFireBanSnapshot,
        geocode.latitude,
        geocode.longitude
      );
      const totalFireBanDiagnostics = this.buildTotalFireBanDiagnostics(
        totalFireBanLookup,
        geocode.latitude,
        geocode.longitude,
        totalFireBanSnapshot
      );

      if (totalFireBanLookup.lookupCode === "NO_AREA_MATCH") {
        totalFireBanNoAreaMatchForests.add(forestName);
      } else if (totalFireBanLookup.lookupCode === "MISSING_AREA_STATUS") {
        if (totalFireBanLookup.fireWeatherAreaName) {
          totalFireBanMissingStatusAreas.add(totalFireBanLookup.fireWeatherAreaName);
        }
      }

      points.push({
        id: `${slugify("unmatched-fire-ban")}-${slugify(forestName)}`,
        source: this.options.sourceName,
        areaName: UNKNOWN_FIRE_BAN_AREA_NAME,
        areaUrl: FIRE_BAN_ENTRY_URL,
        forestName,
        forestUrl: byForestUrl.get(forestName) ?? null,
        banStatus: "UNKNOWN",
        banStatusText: UNKNOWN_FIRE_BAN_STATUS_TEXT,
        totalFireBanStatus: totalFireBanLookup.status,
        totalFireBanStatusText: totalFireBanLookup.statusText,
        totalFireBanDiagnostics,
        latitude: geocode.latitude,
        longitude: geocode.longitude,
        geocodeName: geocode.displayName,
        geocodeConfidence: geocode.confidence,
        geocodeDiagnostics,
        facilities: directoryFacilities
      });
    }

    if (unmatchedFacilitiesForests.length) {
      const sample = unmatchedFacilitiesForests.slice(0, 8);
      const suffix =
        unmatchedFacilitiesForests.length > sample.length
          ? ` (+${unmatchedFacilitiesForests.length - sample.length} more)`
          : "";
      warningSet.add(
        `Facilities page includes ${unmatchedFacilitiesForests.length} forest(s) not present on the Solid Fuel Fire Ban pages: ${sample.join(", ")}${suffix}.`
      );
    }

    const fuzzyMatchesList = facilityAssignments.diagnostics.fuzzyMatches;

    if (fuzzyMatchesList.length) {
      warningSet.add(
        `Applied fuzzy facilities matching for ${fuzzyMatchesList.length} forest name(s) with minor naming differences.`
      );
    }

    if (totalFireBanNoAreaMatchForests.size) {
      const unmatchedForests = [...totalFireBanNoAreaMatchForests].sort((left, right) =>
        left.localeCompare(right)
      );
      const sample = unmatchedForests.slice(0, 8);
      const suffix =
        unmatchedForests.length > sample.length
          ? ` (+${unmatchedForests.length - sample.length} more)`
          : "";
      warningSet.add(
        `Total Fire Ban area could not be matched for ${unmatchedForests.length} forest(s) using current coordinates: ${sample.join(", ")}${suffix}.`
      );
    }

    if (totalFireBanMissingStatusAreas.size) {
      const missingAreas = [...totalFireBanMissingStatusAreas].sort((left, right) =>
        left.localeCompare(right)
      );
      warningSet.add(
        `Total Fire Ban status feed did not include ${missingAreas.length} mapped fire weather area(s): ${missingAreas.join(", ")}.`
      );
    }

    const closureAssignments = this.buildClosureAssignments(
      closureNotices,
      points.map((point) => point.forestName)
    );

    const pointsWithClosures = points.map((point) => {
      const notices = closureAssignments.byForestName.get(point.forestName) ?? [];
      return {
        ...point,
        closureStatus: this.buildClosureStatusFromNotices(notices),
        closureNotices: notices,
        closureTags: this.buildClosureTagsFromNotices(notices),
        closureImpactSummary: this.buildClosureImpactSummaryFromNotices(notices)
      };
    });

    if (closureAssignments.diagnostics.unmatchedNotices.length) {
      const sample = closureAssignments.diagnostics.unmatchedNotices
        .slice(0, 6)
        .map((notice) => notice.title);
      const suffix =
        closureAssignments.diagnostics.unmatchedNotices.length > sample.length
          ? ` (+${closureAssignments.diagnostics.unmatchedNotices.length - sample.length} more)`
          : "";
      warningSet.add(
        `Could not match ${closureAssignments.diagnostics.unmatchedNotices.length} closure notice(s) to Solid Fuel Fire Ban forest names: ${sample.join(", ")}${suffix}.`
      );
    }

    if (closureAssignments.diagnostics.fuzzyMatches.length) {
      warningSet.add(
        `Applied fuzzy closure notice matching for ${closureAssignments.diagnostics.fuzzyMatches.length} notice(s) with minor naming differences.`
      );
    }

    return {
      forests: pointsWithClosures,
      diagnostics: {
        unmatchedFacilitiesForests,
        fuzzyMatches: fuzzyMatchesList
      },
      closureDiagnostics: closureAssignments.diagnostics
    };
  }

  private async addTravelMetrics(
    forests: Omit<ForestPoint, "distanceKm" | "travelDurationMinutes">[],
    location: UserLocation | undefined,
    avoidTolls: boolean,
    progressCallback?: ForestDataServiceInput["progressCallback"]
  ): Promise<{
    forests: ForestPoint[];
    warnings: string[];
  }> {
    if (!location) {
      return {
        forests: forests.map((forest) => ({
          ...forest,
          distanceKm: null,
          travelDurationMinutes: null
        })),
        warnings: []
      };
    }

    const routableForests = forests
      .filter(
        (forest) =>
          forest.latitude !== null &&
          forest.longitude !== null
      )
      .map((forest) => ({
        id: forest.id,
        latitude: forest.latitude!,
        longitude: forest.longitude!
      }));

    let routeLookup: RouteLookupResult = {
      byForestId: new Map(),
      warnings: []
    };

    if (routableForests.length) {
      try {
        this.reportProgress(progressCallback, {
          phase: "ROUTES",
          message: "Computing driving routes.",
          completed: 0,
          total: routableForests.length
        });

        routeLookup = await this.routeService.getDrivingRouteMetrics({
          userLocation: location,
          forests: routableForests,
          avoidTolls,
          progressCallback: ({ completed, total, message }) => {
            this.reportProgress(progressCallback, {
              phase: "ROUTES",
              message,
              completed,
              total
            });
          }
        });
      } catch (error) {
        routeLookup = {
          byForestId: new Map(),
          warnings: [
            `Driving route lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`
          ]
        };
      }

      this.reportProgress(progressCallback, {
        phase: "ROUTES",
        message: "Driving routes completed.",
        completed: routableForests.length,
        total: routableForests.length
      });
    }

    return {
      forests: forests.map((forest) => {
        const metric = routeLookup.byForestId.get(forest.id);

        return {
          ...forest,
          distanceKm: metric?.distanceKm ?? null,
          travelDurationMinutes: metric?.durationMinutes ?? null
        };
      }),
      warnings: routeLookup.warnings
    };
  }

  private findNearestLegalSpot(
    forests: ForestPoint[],
    userLocation?: UserLocation
  ): NearestForest | null {
    let nearest: { forest: ForestPoint; effectiveDistanceKm: number } | null = null;

    for (const forest of forests) {
      if (
        forest.banStatus !== "NOT_BANNED" ||
        forest.totalFireBanStatus === "BANNED" ||
        forest.closureStatus === "CLOSED"
      ) {
        continue;
      }

      const effectiveDistanceKm =
        forest.distanceKm ??
        (userLocation && forest.latitude !== null && forest.longitude !== null
          ? haversineDistanceKm(
              userLocation.latitude,
              userLocation.longitude,
              forest.latitude,
              forest.longitude
            )
          : null);

      if (effectiveDistanceKm === null) {
        continue;
      }

      if (!nearest || nearest.effectiveDistanceKm > effectiveDistanceKm) {
        nearest = {
          forest,
          effectiveDistanceKm
        };
      }
    }

    if (!nearest) {
      return null;
    }

    const { forest } = nearest;

    return {
      id: forest.id,
      forestName: forest.forestName,
      areaName: forest.areaName,
      distanceKm: forest.distanceKm ?? nearest.effectiveDistanceKm,
      travelDurationMinutes: forest.travelDurationMinutes
    };
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
    const routeResult = await this.addTravelMetrics(
      resolvedSnapshot.forests,
      input?.userLocation,
      avoidTolls,
      input?.progressCallback
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
      nearestLegalSpot: this.findNearestLegalSpot(forests, input?.userLocation),
      warnings: this.sanitizeWarnings([...(resolvedSnapshot.warnings ?? []), ...routeResult.warnings])
    };
  }
}
