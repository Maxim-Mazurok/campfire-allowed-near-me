// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSortFallback } from "../../web/src/lib/hooks/use-sort-fallback";
import type { ForestListSortOption } from "../../web/src/lib/app-domain-types";

describe("useSortFallback", () => {
  it("does not change sort option when driving routes are available", () => {
    const setForestListSortOption = vi.fn();

    renderHook(() =>
      useSortFallback(true, "DRIVING_DISTANCE_ASC", setForestListSortOption)
    );

    expect(setForestListSortOption).not.toHaveBeenCalled();
  });

  it("switches DRIVING_DISTANCE_ASC to DIRECT_DISTANCE_ASC when routes unavailable", () => {
    const setForestListSortOption = vi.fn();

    renderHook(() =>
      useSortFallback(false, "DRIVING_DISTANCE_ASC", setForestListSortOption)
    );

    expect(setForestListSortOption).toHaveBeenCalledWith("DIRECT_DISTANCE_ASC");
  });

  it("switches DRIVING_DISTANCE_DESC to DIRECT_DISTANCE_ASC when routes unavailable", () => {
    const setForestListSortOption = vi.fn();

    renderHook(() =>
      useSortFallback(false, "DRIVING_DISTANCE_DESC", setForestListSortOption)
    );

    expect(setForestListSortOption).toHaveBeenCalledWith("DIRECT_DISTANCE_ASC");
  });

  it("switches DRIVING_TIME_ASC to DIRECT_DISTANCE_ASC when routes unavailable", () => {
    const setForestListSortOption = vi.fn();

    renderHook(() =>
      useSortFallback(false, "DRIVING_TIME_ASC", setForestListSortOption)
    );

    expect(setForestListSortOption).toHaveBeenCalledWith("DIRECT_DISTANCE_ASC");
  });

  it("switches DRIVING_TIME_DESC to DIRECT_DISTANCE_ASC when routes unavailable", () => {
    const setForestListSortOption = vi.fn();

    renderHook(() =>
      useSortFallback(false, "DRIVING_TIME_DESC", setForestListSortOption)
    );

    expect(setForestListSortOption).toHaveBeenCalledWith("DIRECT_DISTANCE_ASC");
  });

  it("does not change direct distance sort options when routes unavailable", () => {
    const setForestListSortOption = vi.fn();

    renderHook(() =>
      useSortFallback(false, "DIRECT_DISTANCE_ASC", setForestListSortOption)
    );

    expect(setForestListSortOption).not.toHaveBeenCalled();
  });

  it("does not change DIRECT_DISTANCE_DESC when routes unavailable", () => {
    const setForestListSortOption = vi.fn();

    renderHook(() =>
      useSortFallback(false, "DIRECT_DISTANCE_DESC", setForestListSortOption)
    );

    expect(setForestListSortOption).not.toHaveBeenCalled();
  });

  it("reacts to hasDrivingRoutes changing from true to false", () => {
    const setForestListSortOption = vi.fn();
    const sortOption: ForestListSortOption = "DRIVING_DISTANCE_ASC";

    const { rerender } = renderHook(
      ({ hasDrivingRoutes }) =>
        useSortFallback(hasDrivingRoutes, sortOption, setForestListSortOption),
      { initialProps: { hasDrivingRoutes: true } }
    );

    expect(setForestListSortOption).not.toHaveBeenCalled();

    rerender({ hasDrivingRoutes: false });

    expect(setForestListSortOption).toHaveBeenCalledWith("DIRECT_DISTANCE_ASC");
  });
});
