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
import { OSMGeocoder } from "./osm-geocoder.js";
import type {
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestApiResponse,
  ForestAreaWithForests,
  ForestDataService,
  ForestDataServiceInput,
  ForestDirectorySnapshot,
  ForestPoint,
  NearestForest,
  PersistedSnapshot,
  UserLocation
} from "../types/domain.js";

interface LiveForestDataServiceOptions {
  snapshotPath?: string;
  scrapeTtlMs?: number;
  sourceName?: string;
  scraper?: ForestryScraper;
  geocoder?: OSMGeocoder;
}

const DEFAULT_OPTIONS: Required<Omit<LiveForestDataServiceOptions, "scraper" | "geocoder">> = {
  snapshotPath: "data/cache/forests-snapshot.json",
  scrapeTtlMs: 15 * 60 * 1000,
  sourceName: "Forestry Corporation NSW"
};

const FACILITY_MATCH_THRESHOLD = 0.62;
const SNAPSHOT_FORMAT_VERSION = 3;
const FIRE_BAN_ENTRY_URL = "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans";
const UNKNOWN_FIRE_BAN_AREA_NAME = "Not listed on fire-ban pages";
const UNKNOWN_FIRE_BAN_STATUS_TEXT =
  "Unknown (not listed on Solid Fuel Fire Ban pages)";

interface FacilityMatchResult {
  facilities: Record<string, FacilityValue>;
  matchedDirectoryForestName: string | null;
  score: number | null;
  matchType: "EXACT" | "FUZZY" | "UNMATCHED";
}

export class LiveForestDataService implements ForestDataService {
  private readonly options: Required<
    Omit<LiveForestDataServiceOptions, "scraper" | "geocoder">
  >;

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
          "https://www.forestrycorporation.com.au/visiting/forests"
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

      return {
        ...forest,
        forestUrl: typeof forest.forestUrl === "string" ? forest.forestUrl : null,
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
    const raw = await readJsonFile<PersistedSnapshot>(this.options.snapshotPath);
    return raw ? this.normalizeSnapshot(raw) : null;
  }

  private async persistSnapshot(snapshot: PersistedSnapshot): Promise<void> {
    await writeJsonFile(this.options.snapshotPath, snapshot);
    this.memorySnapshot = snapshot;
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
      !this.hasUnknownStatuses(this.memorySnapshot) &&
      this.hasFacilityDefinitions(this.memorySnapshot)
    ) {
      return this.memorySnapshot;
    }

    const persisted = await this.loadPersistedSnapshot();
    if (
      process.env.FORESTRY_SKIP_SCRAPE === "true" &&
      persisted
    ) {
      this.memorySnapshot = persisted;
      return persisted;
    }

    if (
      !forceRefresh &&
      persisted &&
      this.isSnapshotCompatible(persisted) &&
      this.isSnapshotFresh(persisted) &&
      this.hasAnyMappedForest(persisted) &&
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
        persisted &&
        this.hasAnyMappedForest(persisted)
      ) {
        const fallbackSnapshot: PersistedSnapshot = {
          ...persisted,
          stale: true,
          warnings: [
            ...new Set([
              ...(persisted.warnings ?? []),
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
      if (persisted) {
        const warning =
          error instanceof Error
            ? error.message
            : "Unknown scrape error while refreshing Forestry data.";

        const staleSnapshot: PersistedSnapshot = {
          ...persisted,
          stale: true,
          warnings: [...new Set([...(persisted.warnings ?? []), warning])]
        };
        this.memorySnapshot = staleSnapshot;
        return staleSnapshot;
      }

      throw error;
    }
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
          facilities: facilityMatch.facilities
        });
      }
    }

    const unmatchedFacilitiesForests = facilityAssignments.diagnostics.unmatchedFacilitiesForests;

    for (const forestName of unmatchedFacilitiesForests) {
      const geocode = await this.geocoder.geocodeForest(forestName);
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
