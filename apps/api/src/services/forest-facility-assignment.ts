import type {
  FacilityMatchDiagnostics,
  FacilityValue,
  ForestDirectorySnapshot
} from "../types/domain.js";
import {
  findBestForestNameMatch,
  normalizeForestNameForMatch
} from "../utils/fuzzy-forest-match.js";

export interface FacilityMatchResult {
  facilities: Record<string, FacilityValue>;
  matchedDirectoryForestName: string | null;
  score: number | null;
  matchType: "EXACT" | "FUZZY" | "UNMATCHED";
}

export const FACILITY_MATCH_THRESHOLD = 0.62;

export function buildUnknownFacilities(
  directory: ForestDirectorySnapshot
): Record<string, FacilityValue> {
  return Object.fromEntries(
    directory.filters.map((facility) => [facility.key, null])
  ) as Record<string, FacilityValue>;
}

export function createMatchedFacilities(
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

export function hasDirectionalConflict(leftName: string, rightName: string): boolean {
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

export function buildFacilityAssignments(
  fireBanForestNames: string[],
  directory: ForestDirectorySnapshot,
  byForestName: Map<string, Record<string, boolean>>
): {
  byFireBanForestName: Map<string, FacilityMatchResult>;
  diagnostics: FacilityMatchDiagnostics;
} {
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
      facilities: createMatchedFacilities(directory, byForestName, matchedExactNames),
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
}
