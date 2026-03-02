import { useEffect } from "react";
import type { ForestListSortOption } from "../app-domain-types";

const DRIVING_SORT_PREFIX = "DRIVING_";
const DEFAULT_FALLBACK_SORT: ForestListSortOption = "DIRECT_DISTANCE_ASC";

/**
 * When driving routes are unavailable, automatically switches any driving-based
 * sort option back to the default direct distance sort.
 */
export const useSortFallback = (
  hasDrivingRoutes: boolean,
  forestListSortOption: ForestListSortOption,
  setForestListSortOption: (option: ForestListSortOption) => void
): void => {
  useEffect(() => {
    if (hasDrivingRoutes) {
      return;
    }

    if (forestListSortOption.startsWith(DRIVING_SORT_PREFIX)) {
      setForestListSortOption(DEFAULT_FALLBACK_SORT);
    }
  }, [hasDrivingRoutes, forestListSortOption, setForestListSortOption]);
};
