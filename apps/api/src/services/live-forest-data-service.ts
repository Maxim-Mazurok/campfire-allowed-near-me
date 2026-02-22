import { readJsonFile, writeJsonFile } from "../utils/fs-cache.js";
import { haversineDistanceKm } from "../utils/distance.js";
import {
  findBestForestNameMatch,
  normalizeForestNameForMatch
} from "../utils/fuzzy-forest-match.js";
import {
  isLikelyStateForestName,
  normalizeForestLabel
} from "../utils/forest-name-validation.js";
import { slugify } from "../utils/slugs.js";
import { ForestryScraper } from "./forestry-scraper.js";
import {
  OSMGeocoder,
  type GeocodeLookupAttempt,
  type GeocodeResponse
} from "./osm-geocoder.js";
import type {
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestApiResponse,
  ForestAreaWithForests,
  ForestDataService,
  ForestDataServiceInput,
  ForestDirectorySnapshot,
  ForestGeocodeDiagnostics,
  ForestPoint,
  NearestForest,
  PersistedSnapshot,
  UserLocation
} from "../types/domain.js";

interface LiveForestDataServiceOptions {
  snapshotPath?: string | null;
  scrapeTtlMs?: number;
  sourceName?: string;
  scraper?: ForestryScraper;
  geocoder?: OSMGeocoder;
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
const SNAPSHOT_FORMAT_VERSION = 4;
const FIRE_BAN_ENTRY_URL = "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const UNKNOWN_FIRE_BAN_AREA_NAME = "Not listed on fire-ban pages";
const UNKNOWN_FIRE_BAN_STATUS_TEXT =
  "Unknown (not listed on Solid Fuel Fire Ban pages)";
const MISSING_GEOCODE_ATTEMPTS_MESSAGE =
  "No geocoding attempt diagnostics were captured in this snapshot.";

interface FacilityMatchResult {
  facilities: Record<string, FacilityValue>;
  matchedDirectoryForestName: string | null;
  score: number | null;
  matchType: "EXACT" | "FUZZY" | "UNMATCHED";
}

export class LiveForestDataService implements ForestDataService {
  private readonly options: LiveForestDataServiceResolvedOptions;

  private readonly scraper: ForestryScraper;

  private readonly geocoder: OSMGeocoder;

  private memorySnapshot: PersistedSnapshot | null = null;

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
          process.env.FORESTRY_RAW_CACHE_PATH ?? "data/cache/forestry-raw-pages.json",
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
        requestDelayMs: Number(process.env.GEOCODE_DELAY_MS ?? "1200")
      });
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
    const facilityKeys = availableFacilities.map((facility) => facility.key);
    const matchDiagnostics = this.sanitizeMatchDiagnostics(snapshot.matchDiagnostics);
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

      return {
        ...forest,
        forestUrl: typeof forest.forestUrl === "string" ? forest.forestUrl : null,
        geocodeDiagnostics: normalizedGeocodeDiagnostics,
        facilities
      };
    });

    return {
      ...snapshot,
      schemaVersion: typeof snapshot.schemaVersion === "number" ? snapshot.schemaVersion : 0,
      availableFacilities,
      matchDiagnostics,
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

  private async resolveSnapshot(forceRefresh = false): Promise<PersistedSnapshot> {
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
      !this.hasUnknownStatuses(persisted) &&
      this.hasFacilityDefinitions(persisted)
    ) {
      this.memorySnapshot = persisted;
      return persisted;
    }

    try {
      const scraped = await this.scraper.scrape();
      const warningSet = new Set(scraped.warnings ?? []);
      const forestResult = await this.buildForestPoints(
        scraped.areas,
        scraped.directory,
        warningSet
      );

      const snapshot: PersistedSnapshot = {
        schemaVersion: SNAPSHOT_FORMAT_VERSION,
        fetchedAt: new Date().toISOString(),
        stale: false,
        sourceName: this.options.sourceName,
        availableFacilities: scraped.directory.filters,
        matchDiagnostics: forestResult.diagnostics,
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
  }

  private getGeocodeAttempts(response: GeocodeResponse | null | undefined): GeocodeLookupAttempt[] {
    if (!response?.attempts) {
      return [];
    }

    return response.attempts;
  }

  private describeGeocodeAttempt(prefix: string, attempt: GeocodeLookupAttempt): string {
    const details: string[] = [`${prefix}: ${attempt.outcome}`, `query=${attempt.query}`];
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

  private buildUnknownFacilities(directory: ForestDirectorySnapshot): Record<string, FacilityValue> {
    return Object.fromEntries(
      directory.filters.map((facility) => [facility.key, null])
    ) as Record<string, FacilityValue>;
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

  private async buildForestPoints(
    areas: ForestAreaWithForests[],
    directory: ForestDirectorySnapshot,
    warningSet: Set<string>
  ): Promise<{
    forests: Omit<ForestPoint, "distanceKm">[];
    diagnostics: FacilityMatchDiagnostics;
  }> {
    const points: Omit<ForestPoint, "distanceKm">[] = [];
    const areaGeocodeMap = new Map<string, Awaited<ReturnType<OSMGeocoder["geocodeArea"]>>>();
    const byForestName = new Map(
      directory.forests.map((entry) => [entry.forestName, entry.facilities] as const)
    );
    const byForestUrl = new Map(
      directory.forests.map((entry) => [entry.forestName, entry.forestUrl ?? null] as const)
    );
    const uniqueFireBanNames = [...new Set(
      areas.flatMap((area) => area.forests.map((forest) => forest.trim()).filter(Boolean))
    )];
    const facilityAssignments = this.buildFacilityAssignments(
      uniqueFireBanNames,
      directory,
      byForestName
    );

    // Prioritize one lookup per area first so every forest can fall back to an area centroid.
    for (const area of areas) {
      const areaGeocode = await this.geocoder.geocodeArea(area.areaName, area.areaUrl);
      areaGeocodeMap.set(area.areaUrl, areaGeocode);
    }

    for (const area of areas) {
      const uniqueForestNames = [...new Set(area.forests.map((forest) => forest.trim()))];
      const areaGeocode = areaGeocodeMap.get(area.areaUrl) ?? {
        latitude: null,
        longitude: null,
        displayName: null,
        confidence: null
      };

      for (const forestName of uniqueForestNames) {
        if (!forestName) {
          continue;
        }

        const geocode = await this.geocoder.geocodeForest(forestName, area.areaName);
        const resolvedLatitude = geocode.latitude ?? areaGeocode.latitude;
        const resolvedLongitude = geocode.longitude ?? areaGeocode.longitude;
        const usedAreaFallback = geocode.latitude === null && areaGeocode.latitude !== null;
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

        points.push({
          id: `${slugify(area.areaName)}-${slugify(forestName)}`,
          source: this.options.sourceName,
          areaName: area.areaName,
          areaUrl: area.areaUrl,
          forestName,
          forestUrl: facilityMatch.matchedDirectoryForestName
            ? (byForestUrl.get(facilityMatch.matchedDirectoryForestName) ?? null)
            : null,
          banStatus: area.status,
          banStatusText: area.statusText,
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

    const unmatchedFacilitiesForests = facilityAssignments.diagnostics.unmatchedFacilitiesForests;

    for (const forestName of unmatchedFacilitiesForests) {
      const geocode = await this.geocoder.geocodeForest(forestName);
      const geocodeDiagnostics =
        geocode.latitude === null || geocode.longitude === null
          ? this.buildGeocodeDiagnostics(geocode)
          : null;
      const directoryFacilities = this.createMatchedFacilities(
        directory,
        byForestName,
        [forestName]
      );

      points.push({
        id: `${slugify("unmatched-fire-ban")}-${slugify(forestName)}`,
        source: this.options.sourceName,
        areaName: UNKNOWN_FIRE_BAN_AREA_NAME,
        areaUrl: FIRE_BAN_ENTRY_URL,
        forestName,
        forestUrl: byForestUrl.get(forestName) ?? null,
        banStatus: "UNKNOWN",
        banStatusText: UNKNOWN_FIRE_BAN_STATUS_TEXT,
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

    return {
      forests: points,
      diagnostics: {
        unmatchedFacilitiesForests,
        fuzzyMatches: fuzzyMatchesList
      }
    };
  }

  private addDistances(
    forests: Omit<ForestPoint, "distanceKm">[],
    location?: UserLocation
  ): ForestPoint[] {
    return forests.map((forest) => {
      if (
        !location ||
        forest.latitude === null ||
        forest.longitude === null
      ) {
        return {
          ...forest,
          distanceKm: null
        };
      }

      return {
        ...forest,
        distanceKm: haversineDistanceKm(
          location.latitude,
          location.longitude,
          forest.latitude,
          forest.longitude
        )
      };
    });
  }

  private findNearestLegalSpot(forests: ForestPoint[]): NearestForest | null {
    let nearest: ForestPoint | null = null;

    for (const forest of forests) {
      if (forest.banStatus !== "NOT_BANNED") {
        continue;
      }

      if (forest.distanceKm === null) {
        continue;
      }

      if (!nearest || (nearest.distanceKm ?? Infinity) > forest.distanceKm) {
        nearest = forest;
      }
    }

    if (!nearest || nearest.distanceKm === null) {
      return null;
    }

    return {
      id: nearest.id,
      forestName: nearest.forestName,
      areaName: nearest.areaName,
      distanceKm: nearest.distanceKm
    };
  }

  async getForestData(input?: ForestDataServiceInput): Promise<ForestApiResponse> {
    const snapshot = await this.resolveSnapshot(input?.forceRefresh);
    const forests = this.addDistances(snapshot.forests, input?.userLocation);

    return {
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
      sourceName: snapshot.sourceName,
      availableFacilities: snapshot.availableFacilities,
      matchDiagnostics: snapshot.matchDiagnostics,
      forests,
      nearestLegalSpot: this.findNearestLegalSpot(forests),
      warnings: this.sanitizeWarnings(snapshot.warnings)
    };
  }
}
