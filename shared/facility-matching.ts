import type {
  ClosureMatchDiagnostics,
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestClosureNotice,
  ForestDirectorySnapshot
} from "./contracts.js";
import { normalizeForestLabel } from "./text-utils.js";
import {
  findBestForestNameMatch,
  normalizeForestNameForMatch
} from "./fuzzy-forest-match.js";
import { isClosureNoticeActive } from "./closure-helpers.js";

export const FACILITY_MATCH_THRESHOLD = 0.62;
export const CLOSURE_MATCH_THRESHOLD = 0.68;

export interface FacilityMatchResult {
  facilities: Record<string, FacilityValue>;
  matchedDirectoryForestName: string | null;
  score: number | null;
  matchType: "EXACT" | "FUZZY" | "UNMATCHED";
}

export const hasDirectionalConflict = (leftName: string, rightName: string): boolean => {
  const left = normalizeForestNameForMatch(leftName);
  const right = normalizeForestNameForMatch(rightName);
  if (
    (/\beast\b/.test(left) && /\bwest\b/.test(right)) ||
    (/\bwest\b/.test(left) && /\beast\b/.test(right))
  ) return true;
  if (
    (/\bnorth\b/.test(left) && /\bsouth\b/.test(right)) ||
    (/\bsouth\b/.test(left) && /\bnorth\b/.test(right))
  ) return true;
  return false;
};

export const buildUnknownFacilities = (
  directory: ForestDirectorySnapshot
): Record<string, FacilityValue> =>
  Object.fromEntries(directory.filters.map((facility) => [facility.key, null])) as Record<string, FacilityValue>;

export const createMatchedFacilities = (
  directory: ForestDirectorySnapshot,
  byForestName: Map<string, Record<string, boolean>>,
  sourceForestNames: string[]
): Record<string, FacilityValue> =>
  Object.fromEntries(
    directory.filters.map((filter) => [
      filter.key,
      sourceForestNames.some((name) => Boolean(byForestName.get(name)?.[filter.key]))
    ])
  ) as Record<string, FacilityValue>;

export const buildFacilityAssignments = (
  fireBanForestNames: string[],
  directory: ForestDirectorySnapshot,
  byForestName: Map<string, Record<string, boolean>>
): {
  byFireBanForestName: Map<string, FacilityMatchResult>;
  diagnostics: FacilityMatchDiagnostics;
} => {
  const byFireBanForestName = new Map<string, FacilityMatchResult>();
  const unknown = buildUnknownFacilities(directory);

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
      facilities: createMatchedFacilities(directory, byForestName, matchedExactNames),
      matchedDirectoryForestName: matchedExactNames[0]!,
      score: 1,
      matchType: "EXACT"
    });
    for (const matchedName of matchedExactNames) {
      availableDirectoryNames.delete(matchedName);
    }
  }

  for (const fireBanForestName of unresolvedFireBanNames) {
    const candidates = [...availableDirectoryNames];
    const fuzzy = findBestForestNameMatch(fireBanForestName, candidates);

    if (
      !fuzzy ||
      fuzzy.score < FACILITY_MATCH_THRESHOLD ||
      hasDirectionalConflict(fireBanForestName, fuzzy.candidateName)
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
      facilities: createMatchedFacilities(directory, byForestName, [fuzzy.candidateName]),
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
};

export const buildClosureAssignments = (
  notices: ForestClosureNotice[],
  forestNames: string[]
): {
  byForestName: Map<string, ForestClosureNotice[]>;
  diagnostics: ClosureMatchDiagnostics;
} => {
  const byForestName = new Map<string, ForestClosureNotice[]>();
  for (const forestName of forestNames) {
    byForestName.set(forestName, []);
  }

  const unmatchedNotices: ForestClosureNotice[] = [];
  const fuzzyMatches: ClosureMatchDiagnostics["fuzzyMatches"] = [];
  const nowMs = Date.now();

  for (const notice of notices) {
    if (!isClosureNoticeActive(notice, nowMs)) continue;

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
    diagnostics: { unmatchedNotices, fuzzyMatches }
  };
};
