import { describe, expect, it } from "vitest";
import {
  getForestMarkerInteractionOptions
} from "../../web/src/lib/forest-marker-interaction";

describe("forest marker interaction", () => {
  it("keeps green matched markers directly interactive", () => {
    const forestMarkerInteractionOptions = getForestMarkerInteractionOptions({
      matchesFilters: true,
      displayMarkerRadius: 9
    });

    expect(forestMarkerInteractionOptions).toEqual({
      displayMarkerRadius: 9,
      displayMarkerInteractive: true,
      clickTargetMarkerRadius: null
    });
  });

  it("uses separate click target for grey unmatched markers", () => {
    const forestMarkerInteractionOptions = getForestMarkerInteractionOptions({
      matchesFilters: false,
      displayMarkerRadius: 4
    });

    expect(forestMarkerInteractionOptions).toEqual({
      displayMarkerRadius: 4,
      displayMarkerInteractive: false,
      clickTargetMarkerRadius: 9
    });
  });
});
