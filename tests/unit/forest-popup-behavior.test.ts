import { describe, expect, it } from "vitest";
import {
  buildSelectedForestPopupPosition,
  isSelectedForestStillAvailable
} from "../../apps/web/src/lib/forest-popup-behavior";

describe("forest popup behavior", () => {
  it("keeps selected popup open while selected forest remains in mapped data", () => {
    const selectedForestStillAvailable = isSelectedForestStillAvailable({
      selectedForestId: "forest-a",
      matchedForests: [{ id: "forest-a" }],
      unmatchedForests: [{ id: "forest-b" }]
    });

    expect(selectedForestStillAvailable).toBe(true);
  });

  it("closes selected popup when selected forest disappears from mapped data", () => {
    const selectedForestStillAvailable = isSelectedForestStillAvailable({
      selectedForestId: "forest-missing",
      matchedForests: [{ id: "forest-a" }],
      unmatchedForests: [{ id: "forest-b" }]
    });

    expect(selectedForestStillAvailable).toBe(false);
  });

  it("builds stable popup position from selected forest coordinates", () => {
    const selectedForestPopupPosition = buildSelectedForestPopupPosition({
      selectedForestPopupSnapshot: {
        forest: {
          id: "forest-a",
          latitude: -32.1633,
          longitude: 147.0166
        }
      }
    });

    expect(selectedForestPopupPosition).toEqual([-32.1633, 147.0166]);
  });

  it("returns null popup position when no selection exists", () => {
    const selectedForestPopupPosition = buildSelectedForestPopupPosition({
      selectedForestPopupSnapshot: null
    });

    expect(selectedForestPopupPosition).toBeNull();
  });
});
