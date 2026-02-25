export type {
  BanStatus,
  ClosureImpactConfidence,
  ClosureImpactLevel,
  ClosureImpactSummary,
  ClosureMatchDiagnostics,
  ClosureNoticeStatus,
  ClosureNoticeStructuredImpact,
  ClosureStatus,
  ClosureTagDefinition,
  ClosureTagKey,
  FacilityDefinition,
  FacilityForestEntry,
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestApiResponse,
  ForestAreaReference,
  ForestAreaSummary,
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDirectorySnapshot,
  ForestGeocodeDiagnostics,
  ForestLoadProgressState,
  ForestLoadStatus,
  ForestPoint,
  ForestTotalFireBanDiagnostics,
  FuzzyClosureMatch,
  FuzzyFacilityMatch,
  NearestForest,
  PersistedSnapshot,
  RefreshTaskPhase,
  RefreshTaskProgress,
  RefreshTaskState,
  RefreshTaskStatus,
  TotalFireBanLookupCode,
  UserLocation
} from "../../../../packages/shared/src/contracts.js";

export {
  getForestBanStatus,
  getForestBanStatusText,
  getForestPrimaryAreaName,
  getForestPrimaryAreaUrl
} from "../../../../packages/shared/src/forest-helpers.js";

import type {
  ForestApiResponse,
  ForestAreaWithForests,
  ForestClosureNotice,
  ForestDirectorySnapshot,
  RefreshTaskProgress,
  UserLocation
} from "../../../../packages/shared/src/contracts.js";

export interface ForestDataServiceInput {
  forceRefresh?: boolean;
  userLocation?: UserLocation;
  avoidTolls?: boolean;
  preferCachedSnapshot?: boolean;
  progressCallback?: (progress: RefreshTaskProgress) => void;
}

export interface ForestryScrapeResult {
  areas: ForestAreaWithForests[];
  directory: ForestDirectorySnapshot;
  closures?: ForestClosureNotice[];
  warnings: string[];
}

export interface ForestDataService {
  getForestData(input?: ForestDataServiceInput): Promise<ForestApiResponse>;
}
