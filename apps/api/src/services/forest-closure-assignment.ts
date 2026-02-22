import type {
  ClosureImpactLevel,
  ClosureImpactSummary,
  ClosureMatchDiagnostics,
  ClosureStatus,
  ClosureTagKey,
  ForestClosureNotice
} from "../types/domain.js";
import { CLOSURE_TAG_DEFINITIONS } from "./forest-snapshot-normalizer.js";
import { findBestForestNameMatch } from "../utils/fuzzy-forest-match.js";
import { normalizeForestLabel } from "../utils/forest-name-validation.js";

const CLOSURE_MATCH_THRESHOLD = 0.68;

export const CLOSURE_IMPACT_ORDER: Record<ClosureImpactLevel, number> = {
  NONE: 0,
  ADVISORY: 1,
  RESTRICTED: 2,
  CLOSED: 3,
  UNKNOWN: -1
};

export function isClosureNoticeActive(notice: ForestClosureNotice, nowMs: number): boolean {
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

export function mergeClosureImpactLevel(
  leftImpact: ClosureImpactLevel,
  rightImpact: ClosureImpactLevel
): ClosureImpactLevel {
  if (CLOSURE_IMPACT_ORDER[rightImpact] > CLOSURE_IMPACT_ORDER[leftImpact]) {
    return rightImpact;
  }

  return leftImpact;
}

export function buildClosureTagsFromNotices(
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

export function buildClosureStatusFromNotices(notices: ForestClosureNotice[]): ClosureStatus {
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

export function buildClosureImpactSummaryFromNotices(
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

    summary.campingImpact = mergeClosureImpactLevel(summary.campingImpact, impact.campingImpact);
    summary.access2wdImpact = mergeClosureImpactLevel(
      summary.access2wdImpact,
      impact.access2wdImpact
    );
    summary.access4wdImpact = mergeClosureImpactLevel(
      summary.access4wdImpact,
      impact.access4wdImpact
    );
  }

  return summary;
}

export function buildClosureAssignments(
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
    if (!isClosureNoticeActive(notice, nowMs)) {
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
