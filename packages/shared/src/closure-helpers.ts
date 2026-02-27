import type {
  ClosureImpactLevel,
  ClosureImpactSummary,
  ClosureStatus,
  ClosureTagDefinition,
  ClosureTagKey,
  ForestClosureNotice
} from "./contracts.js";

export const CLOSURE_TAG_DEFINITIONS: ClosureTagDefinition[] = [
  { key: "ROAD_ACCESS", label: "Road/trail access" },
  { key: "CAMPING", label: "Camping impact" },
  { key: "EVENT", label: "Event closure" },
  { key: "OPERATIONS", label: "Operations/safety" }
];

export const CLOSURE_IMPACT_ORDER: Record<ClosureImpactLevel, number> = {
  NONE: 0,
  ADVISORY: 1,
  RESTRICTED: 2,
  CLOSED: 3,
  UNKNOWN: -1
};

export const mergeClosureImpactLevel = (
  leftImpact: ClosureImpactLevel,
  rightImpact: ClosureImpactLevel
): ClosureImpactLevel =>
  CLOSURE_IMPACT_ORDER[rightImpact] > CLOSURE_IMPACT_ORDER[leftImpact] ? rightImpact : leftImpact;

export const isClosureNoticeActive = (notice: ForestClosureNotice, nowMs: number): boolean => {
  const listedAtMs = notice.listedAt ? Date.parse(notice.listedAt) : Number.NaN;
  if (!Number.isNaN(listedAtMs) && listedAtMs > nowMs) return false;
  const untilAtMs = notice.untilAt ? Date.parse(notice.untilAt) : Number.NaN;
  if (!Number.isNaN(untilAtMs) && untilAtMs < nowMs) return false;
  return true;
};

export const buildClosureTagsFromNotices = (
  notices: ForestClosureNotice[]
): Partial<Record<ClosureTagKey, boolean>> => {
  const tags: Partial<Record<ClosureTagKey, boolean>> = Object.fromEntries(
    CLOSURE_TAG_DEFINITIONS.map((definition) => [definition.key, false])
  ) as Partial<Record<ClosureTagKey, boolean>>;
  for (const notice of notices) {
    for (const tagKey of notice.tags) {
      tags[tagKey] = true;
    }
  }
  return tags;
};

export const buildClosureStatusFromNotices = (notices: ForestClosureNotice[]): ClosureStatus => {
  if (notices.some((notice) => notice.status === "CLOSED")) return "CLOSED";
  if (notices.some((notice) => notice.status === "PARTIAL")) return "PARTIAL";
  if (notices.length > 0) return "NOTICE";
  return "NONE";
};

export const buildClosureImpactSummaryFromNotices = (
  notices: ForestClosureNotice[]
): ClosureImpactSummary => {
  const summary: ClosureImpactSummary = {
    campingImpact: "NONE",
    access2wdImpact: "NONE",
    access4wdImpact: "NONE"
  };
  for (const notice of notices) {
    const impact = notice.structuredImpact;
    if (!impact) continue;
    summary.campingImpact = mergeClosureImpactLevel(summary.campingImpact, impact.campingImpact);
    summary.access2wdImpact = mergeClosureImpactLevel(summary.access2wdImpact, impact.access2wdImpact);
    summary.access4wdImpact = mergeClosureImpactLevel(summary.access4wdImpact, impact.access4wdImpact);
  }
  return summary;
};
