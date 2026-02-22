export type ForestIdentity = {
  id: string;
};

export type SelectedForestPopupSnapshot = {
  forest: {
    id: string;
    latitude: number;
    longitude: number;
  };
};

export const isSelectedForestStillAvailable = ({
  selectedForestId,
  matchedForests,
  unmatchedForests
}: {
  selectedForestId: string;
  matchedForests: ForestIdentity[];
  unmatchedForests: ForestIdentity[];
}): boolean => {
  return (
    matchedForests.some((forest) => forest.id === selectedForestId) ||
    unmatchedForests.some((forest) => forest.id === selectedForestId)
  );
};

export const buildSelectedForestPopupPosition = ({
  selectedForestPopupSnapshot
}: {
  selectedForestPopupSnapshot: SelectedForestPopupSnapshot | null;
}): [number, number] | null => {
  if (!selectedForestPopupSnapshot) {
    return null;
  }

  return [
    selectedForestPopupSnapshot.forest.latitude,
    selectedForestPopupSnapshot.forest.longitude
  ];
};
