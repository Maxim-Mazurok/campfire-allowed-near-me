import { describe, expect, it } from "vitest";
import {
  findBestForestNameMatch,
  normalizeForestNameForMatch,
  scoreForestNameSimilarity
} from "../../apps/api/src/utils/fuzzy-forest-match.js";

describe("normalizeForestNameForMatch", () => {
  it("normalizes punctuation and bracket suffixes", () => {
    expect(normalizeForestNameForMatch("Chichester State Forest (Allyn River)")).toBe(
      "chichester state forest"
    );
  });
});

describe("scoreForestNameSimilarity", () => {
  it("scores exact names as 1", () => {
    expect(scoreForestNameSimilarity("Belanglo State Forest", "Belanglo State Forest")).toBe(1);
  });

  it("scores close variants strongly", () => {
    const score = scoreForestNameSimilarity(
      "Chichester State Forest",
      "Chichester State Forest (Corkscrew)"
    );
    expect(score).toBeGreaterThan(0.9);
  });

  it("handles minor typos", () => {
    const score = scoreForestNameSimilarity("Belanglo State Forest", "Belangalo State Forest");
    expect(score).toBeGreaterThan(0.7);
  });
});

describe("findBestForestNameMatch", () => {
  it("returns the highest scoring candidate", () => {
    const match = findBestForestNameMatch("Murramarrang State Forest", [
      "Marramarra State Forest",
      "Murramarang State Forest",
      "Awaba State Forest"
    ]);

    expect(match).not.toBeNull();
    expect(match?.candidateName).toBe("Murramarang State Forest");
    expect(match?.score ?? 0).toBeGreaterThan(0.7);
  });
});
