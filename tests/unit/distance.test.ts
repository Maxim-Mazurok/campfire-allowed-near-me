import { describe, expect, it } from "vitest";
import { haversineDistanceKm } from "../../apps/api/src/utils/distance.js";

describe("haversineDistanceKm", () => {
  it("returns near-zero for same coordinate", () => {
    expect(haversineDistanceKm(-33.8688, 151.2093, -33.8688, 151.2093)).toBeCloseTo(
      0,
      5
    );
  });

  it("calculates Sydney to Melbourne roughly", () => {
    const distance = haversineDistanceKm(-33.8688, 151.2093, -37.8136, 144.9631);
    expect(distance).toBeGreaterThan(700);
    expect(distance).toBeLessThan(760);
  });
});
