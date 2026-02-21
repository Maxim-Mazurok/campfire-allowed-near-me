import { readJsonFile, writeJsonFile } from "../utils/fs-cache.js";
import { haversineDistanceKm } from "../utils/distance.js";
import { slugify } from "../utils/slugs.js";
import { ForestryScraper } from "./forestry-scraper.js";
import { OSMGeocoder } from "./osm-geocoder.js";
import type {
  ForestApiResponse,
  ForestAreaWithForests,
  ForestDataService,
  ForestDataServiceInput,
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
          "https://www.forestrycorporation.com.au/visit/solid-fuel-fire-bans"
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

  private async loadPersistedSnapshot(): Promise<PersistedSnapshot | null> {
    return readJsonFile<PersistedSnapshot>(this.options.snapshotPath);
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
    return snapshot.forests.some((forest) => forest.banStatus === "UNKNOWN");
  }

  private async resolveSnapshot(forceRefresh = false): Promise<PersistedSnapshot> {
    const fixturePath = process.env.FORESTRY_USE_FIXTURE;
    if (fixturePath) {
      const fixture = await readJsonFile<PersistedSnapshot>(fixturePath);
      if (!fixture) {
        throw new Error(`Fixture file could not be loaded: ${fixturePath}`);
      }

      return fixture;
    }

    if (
      !forceRefresh &&
      this.memorySnapshot &&
      this.isSnapshotFresh(this.memorySnapshot) &&
      this.hasAnyMappedForest(this.memorySnapshot) &&
      !this.hasUnknownStatuses(this.memorySnapshot)
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
      this.isSnapshotFresh(persisted) &&
      this.hasAnyMappedForest(persisted) &&
      !this.hasUnknownStatuses(persisted)
    ) {
      this.memorySnapshot = persisted;
      return persisted;
    }

    try {
      const areas = await this.scraper.scrape();
      const forests = await this.buildForestPoints(areas);

      const snapshot: PersistedSnapshot = {
        fetchedAt: new Date().toISOString(),
        stale: false,
        sourceName: this.options.sourceName,
        forests,
        warnings: []
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

  private async buildForestPoints(
    areas: ForestAreaWithForests[]
  ): Promise<Omit<ForestPoint, "distanceKm">[]> {
    const points: Omit<ForestPoint, "distanceKm">[] = [];
    const areaGeocodeMap = new Map<string, Awaited<ReturnType<OSMGeocoder["geocodeArea"]>>>();

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

        points.push({
          id: `${slugify(area.areaName)}-${slugify(forestName)}`,
          source: this.options.sourceName,
          areaName: area.areaName,
          areaUrl: area.areaUrl,
          forestName,
          banStatus: area.status,
          banStatusText: area.statusText,
          latitude: resolvedLatitude,
          longitude: resolvedLongitude,
          geocodeName: usedAreaFallback
            ? `${areaGeocode.displayName} (area centroid approximation)`
            : geocode.displayName,
          geocodeConfidence: geocode.confidence ?? areaGeocode.confidence
        });
      }
    }

    return points;
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
      forests,
      nearestLegalSpot: this.findNearestLegalSpot(forests),
      warnings: snapshot.warnings
    };
  }
}
