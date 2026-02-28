import type { ForestPoint } from "./api";

const LOW_ZOOM_UNMATCHED_MARKER_LIMIT = 450;
const MID_ZOOM_UNMATCHED_MARKER_LIMIT = 1_200;

export const getUnmatchedMarkerLimitForZoom = (zoomLevel: number): number | null => {
  if (zoomLevel <= 6) {
    return LOW_ZOOM_UNMATCHED_MARKER_LIMIT;
  }

  if (zoomLevel <= 7) {
    return MID_ZOOM_UNMATCHED_MARKER_LIMIT;
  }

  return null;
};

type ForestDistanceEntry<TForest extends ForestPoint> = {
  forest: TForest;
  distanceFromCenterSquared: number;
};

const calculateDistanceFromCenterSquared = (
  latitude: number,
  longitude: number,
  centerLatitude: number,
  centerLongitude: number
): number => {
  const latitudeDelta = latitude - centerLatitude;
  const longitudeDelta = longitude - centerLongitude;
  return latitudeDelta * latitudeDelta + longitudeDelta * longitudeDelta;
};

const swapHeapEntries = <TForest extends ForestPoint>(
  forestDistanceHeap: ForestDistanceEntry<TForest>[],
  firstIndex: number,
  secondIndex: number
): void => {
  const firstEntry = forestDistanceHeap[firstIndex]!;
  const secondEntry = forestDistanceHeap[secondIndex]!;

  forestDistanceHeap[firstIndex] = secondEntry;
  forestDistanceHeap[secondIndex] = firstEntry;
};

const siftHeapUpByDistance = <TForest extends ForestPoint>(
  forestDistanceHeap: ForestDistanceEntry<TForest>[],
  startingIndex: number
): void => {
  let childIndex = startingIndex;

  while (childIndex > 0) {
    const parentIndex = Math.floor((childIndex - 1) / 2);
    const parentEntry = forestDistanceHeap[parentIndex]!;
    const childEntry = forestDistanceHeap[childIndex]!;

    if (parentEntry.distanceFromCenterSquared >= childEntry.distanceFromCenterSquared) {
      return;
    }

    swapHeapEntries(forestDistanceHeap, parentIndex, childIndex);
    childIndex = parentIndex;
  }
};

const siftHeapDownByDistance = <TForest extends ForestPoint>(
  forestDistanceHeap: ForestDistanceEntry<TForest>[]
): void => {
  let parentIndex = 0;

  while (true) {
    const leftChildIndex = parentIndex * 2 + 1;
    const rightChildIndex = leftChildIndex + 1;

    let largestDistanceIndex = parentIndex;
    const parentEntry = forestDistanceHeap[parentIndex]!;
    const leftChildEntry = forestDistanceHeap[leftChildIndex];
    const rightChildEntry = forestDistanceHeap[rightChildIndex];

    if (
      leftChildEntry &&
      leftChildEntry.distanceFromCenterSquared >
        forestDistanceHeap[largestDistanceIndex]!.distanceFromCenterSquared
    ) {
      largestDistanceIndex = leftChildIndex;
    }

    if (
      rightChildEntry &&
      rightChildEntry.distanceFromCenterSquared >
        forestDistanceHeap[largestDistanceIndex]!.distanceFromCenterSquared
    ) {
      largestDistanceIndex = rightChildIndex;
    }

    if (largestDistanceIndex === parentIndex) {
      return;
    }

    swapHeapEntries(forestDistanceHeap, parentIndex, largestDistanceIndex);
    parentIndex = largestDistanceIndex;
  }
};

/**
 * Selects up to `limit` nearest forests to the provided center using a bounded max-heap.
 *
 * The heap keeps the current farthest selected forest at index 0, so each new candidate
 * replaces it only when closer to the center. This avoids sorting the full input list.
 *
 * Time complexity: O(n log k), where `n` is `forests.length` and `k` is `limit`.
 * Space complexity: O(k).
 */
export const selectClosestForestsToCenter = <TForest extends ForestPoint>(
  forests: TForest[],
  centerLatitude: number,
  centerLongitude: number,
  limit: number
): TForest[] => {
  if (limit <= 0) {
    return [];
  }

  if (forests.length <= limit) {
    return forests;
  }

  const forestDistanceHeap: ForestDistanceEntry<TForest>[] = [];

  for (const forest of forests) {
    if (forest.latitude === null || forest.longitude === null) {
      continue;
    }

    const distanceFromCenterSquared = calculateDistanceFromCenterSquared(
      forest.latitude,
      forest.longitude,
      centerLatitude,
      centerLongitude
    );

    if (forestDistanceHeap.length < limit) {
      forestDistanceHeap.push({ forest, distanceFromCenterSquared });
      siftHeapUpByDistance(forestDistanceHeap, forestDistanceHeap.length - 1);
      continue;
    }

    const farthestSelectedForest = forestDistanceHeap[0]!;

    if (distanceFromCenterSquared >= farthestSelectedForest.distanceFromCenterSquared) {
      continue;
    }

    forestDistanceHeap[0] = { forest, distanceFromCenterSquared };
    siftHeapDownByDistance(forestDistanceHeap);
  }

  return forestDistanceHeap
    .sort((leftEntry, rightEntry) => {
      return leftEntry.distanceFromCenterSquared - rightEntry.distanceFromCenterSquared;
    })
    .map((entry) => entry.forest);
};
