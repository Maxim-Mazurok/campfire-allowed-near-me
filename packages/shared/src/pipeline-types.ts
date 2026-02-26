import type {
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDirectorySnapshot,
  ForestGeocodeDiagnostics
} from "./contracts.js";
import type { TotalFireBanSnapshot } from "../../../apps/api/src/services/total-fire-ban-service.js";

// ---------------------------------------------------------------------------
// Common envelope for all pipeline stage outputs
// ---------------------------------------------------------------------------

export interface PipelineStageOutput<T> {
  stage: string;
  version: number;
  createdAt: string;
  data: T;
}

// ---------------------------------------------------------------------------
// Stage 1a: Scrape Forestry (fire ban pages + directory)
// ---------------------------------------------------------------------------

export interface ScrapeForestryData {
  areas: ForestAreaWithForests[];
  directory: ForestDirectorySnapshot;
  warnings: string[];
}

export const SCRAPE_FORESTRY_STAGE = "scrape-forestry";
export const SCRAPE_FORESTRY_VERSION = 1;

export type ScrapeForestryOutput = PipelineStageOutput<ScrapeForestryData>;

// ---------------------------------------------------------------------------
// Stage 1b: Scrape Closures
// ---------------------------------------------------------------------------

export interface ScrapeClosuresData {
  closures: ForestClosureNotice[];
  warnings: string[];
}

export const SCRAPE_CLOSURES_STAGE = "scrape-closures";
export const SCRAPE_CLOSURES_VERSION = 1;

export type ScrapeClosuresOutput = PipelineStageOutput<ScrapeClosuresData>;

// ---------------------------------------------------------------------------
// Stage 1c: Scrape Total Fire Ban
// ---------------------------------------------------------------------------

export interface ScrapeTotalFireBanData {
  snapshot: TotalFireBanSnapshot;
}

export const SCRAPE_TOTAL_FIRE_BAN_STAGE = "scrape-total-fire-ban";
export const SCRAPE_TOTAL_FIRE_BAN_VERSION = 1;

export type ScrapeTotalFireBanOutput = PipelineStageOutput<ScrapeTotalFireBanData>;

// ---------------------------------------------------------------------------
// Stage 2: Geocode Forests
// ---------------------------------------------------------------------------

export interface GeocodedForestEntry {
  forestName: string;
  areaName: string | null;
  directoryForestName: string | null;
  latitude: number | null;
  longitude: number | null;
  displayName: string | null;
  confidence: number | null;
  diagnostics: ForestGeocodeDiagnostics | null;
  warnings: string[];
}

export interface GeocodeForestData {
  forests: GeocodedForestEntry[];
  warnings: string[];
}

export const GEOCODE_FORESTS_STAGE = "geocode-forests";
export const GEOCODE_FORESTS_VERSION = 1;

export type GeocodeForestOutput = PipelineStageOutput<GeocodeForestData>;

// ---------------------------------------------------------------------------
// Stage 3: Enrich Closures (LLM)
// ---------------------------------------------------------------------------

export interface EnrichClosuresData {
  closures: ForestClosureNotice[];
  warnings: string[];
}

export const ENRICH_CLOSURES_STAGE = "enrich-closures";
export const ENRICH_CLOSURES_VERSION = 1;

export type EnrichClosuresOutput = PipelineStageOutput<EnrichClosuresData>;

// ---------------------------------------------------------------------------
// Raw pages archive (output of scrape stages)
// ---------------------------------------------------------------------------

export interface RawPagesArchiveEntry {
  fetchedAt: string;
  finalUrl: string;
  html: string;
}

export interface RawPagesArchive {
  schemaVersion: number;
  pages: Record<string, RawPagesArchiveEntry>;
}

export const RAW_PAGES_ARCHIVE_VERSION = 1;

// ---------------------------------------------------------------------------
// Pipeline paths
// ---------------------------------------------------------------------------

export const PIPELINE_DIRECTORY = "data/pipeline";

export const PIPELINE_PATHS = {
  rawForestryPages: `${PIPELINE_DIRECTORY}/raw-forestry-pages.json`,
  rawClosurePages: `${PIPELINE_DIRECTORY}/raw-closure-pages.json`,
  rawTotalFireBan: `${PIPELINE_DIRECTORY}/raw-total-fire-ban.json`,
  scrapeForestry: `${PIPELINE_DIRECTORY}/scrape-forestry.json`,
  scrapeClosures: `${PIPELINE_DIRECTORY}/scrape-closures.json`,
  scrapeTotalFireBan: `${PIPELINE_DIRECTORY}/scrape-total-fire-ban.json`,
  geocodedForests: `${PIPELINE_DIRECTORY}/geocoded-forests.json`,
  enrichedClosures: `${PIPELINE_DIRECTORY}/enriched-closures.json`
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const createStageOutput = <T>(
  stage: string,
  version: number,
  data: T
): PipelineStageOutput<T> => ({
  stage,
  version,
  createdAt: new Date().toISOString(),
  data
});
