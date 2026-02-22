const STOP_WORDS = new Set([
  "state",
  "forest",
  "forests",
  "nsw",
  "new",
  "south",
  "wales",
  "region",
  "area",
  "native",
  "around"
]);

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const cleanForestName = (value: string): string =>
  normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
  );

const tokenize = (value: string): string[] =>
  cleanForestName(value)
    .split(" ")
    .filter(Boolean);

const toCoreTokens = (value: string): string[] =>
  tokenize(value).filter((token) => !STOP_WORDS.has(token));

const toBigrams = (value: string): string[] => {
  if (!value) {
    return [];
  }

  if (value.length < 2) {
    return [value];
  }

  const grams: string[] = [];
  for (let i = 0; i < value.length - 1; i += 1) {
    grams.push(value.slice(i, i + 2));
  }
  return grams;
};

const diceCoefficient = (a: string, b: string): number => {
  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const aBigrams = toBigrams(a);
  const bBigrams = toBigrams(b);

  if (!aBigrams.length || !bBigrams.length) {
    return 0;
  }

  const counts = new Map<string, number>();
  for (const gram of aBigrams) {
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }

  let overlap = 0;
  for (const gram of bBigrams) {
    const remaining = counts.get(gram) ?? 0;
    if (remaining > 0) {
      overlap += 1;
      counts.set(gram, remaining - 1);
    }
  }

  return (2 * overlap) / (aBigrams.length + bBigrams.length);
};

const jaccardSimilarity = (leftTokens: string[], rightTokens: string[]): number => {
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const left = new Set(leftTokens);
  const right = new Set(rightTokens);

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  const union = left.size + right.size - overlap;
  return union === 0 ? 0 : overlap / union;
};

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  if (!left.length) {
    return right.length;
  }

  if (!right.length) {
    return left.length;
  }

  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0)
  );

  for (let i = 0; i <= left.length; i += 1) {
    matrix[i]![0] = i;
  }

  for (let j = 0; j <= right.length; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + substitutionCost
      );
    }
  }

  return matrix[left.length]![right.length]!;
};

const levenshteinSimilarity = (left: string, right: string): number => {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const distance = levenshteinDistance(left, right);
  return 1 - distance / Math.max(left.length, right.length);
};

export const normalizeForestNameForMatch = (value: string): string =>
  normalizeWhitespace(cleanForestName(value));

export const scoreForestNameSimilarity = (leftRaw: string, rightRaw: string): number => {
  const left = normalizeForestNameForMatch(leftRaw);
  const right = normalizeForestNameForMatch(rightRaw);

  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftCoreTokens = toCoreTokens(left);
  const rightCoreTokens = toCoreTokens(right);
  const leftCore = leftCoreTokens.join(" ");
  const rightCore = rightCoreTokens.join(" ");
  const leftComparable = leftCore || left;
  const rightComparable = rightCore || right;

  if (leftCore && leftCore === rightCore) {
    return 0.98;
  }

  const dice = diceCoefficient(leftComparable, rightComparable);
  const jaccard = jaccardSimilarity(leftCoreTokens, rightCoreTokens);
  const edit = levenshteinSimilarity(leftComparable, rightComparable);
  const includesBonus =
    leftCore && rightCore && (leftCore.includes(rightCore) || rightCore.includes(leftCore))
      ? 0.07
      : 0;
  const singleTokenBonus =
    leftCoreTokens.length === 1 && rightCoreTokens.length === 1 && edit >= 0.8
      ? 0.18
      : 0;

  return Math.min(
    0.99,
    0.45 * dice + 0.2 * jaccard + 0.35 * edit + includesBonus + singleTokenBonus
  );
};

export interface BestForestNameMatch {
  candidateName: string;
  score: number;
}

export const findBestForestNameMatch = (
  targetName: string,
  candidateNames: string[]
): BestForestNameMatch | null => {
  let best: BestForestNameMatch | null = null;

  for (const candidateName of candidateNames) {
    const score = scoreForestNameSimilarity(targetName, candidateName);
    if (!best || score > best.score) {
      best = {
        candidateName,
        score
      };
    }
  }

  return best;
};
