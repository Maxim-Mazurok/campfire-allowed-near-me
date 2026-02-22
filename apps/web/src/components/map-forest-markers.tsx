import { memo, useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  Pane,
  Popup,
  useMap
} from "react-leaflet";
import { ForestCardContent } from "./ForestCardContent";
import type { FacilityDefinition, ForestPoint } from "../lib/api";
import {
  getForestMarkerVisualOptions
} from "../lib/forest-marker-style";
import {
  getUnmatchedMarkerLimitForZoom,
  selectClosestForestsToCenter
} from "../lib/map-marker-rendering";
import {
  getForestMarkerInteractionOptions
} from "../lib/forest-marker-interaction";
import {
  buildSelectedForestPopupPosition,
  isSelectedForestStillAvailable
} from "../lib/forest-popup-behavior";

export const MAP_BOUNDS_PADDING_FACTOR = 0.2;

export type ForestWithCoordinates = ForestPoint & {
  latitude: number;
  longitude: number;
};

type MapViewportSnapshot = {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
  centerLatitude: number;
  centerLongitude: number;
};

const areMapViewportSnapshotsEqual = (
  leftMapViewportSnapshot: MapViewportSnapshot | null,
  rightMapViewportSnapshot: MapViewportSnapshot
): boolean => {
  if (!leftMapViewportSnapshot) {
    return false;
  }

  return (
    leftMapViewportSnapshot.west === rightMapViewportSnapshot.west &&
    leftMapViewportSnapshot.south === rightMapViewportSnapshot.south &&
    leftMapViewportSnapshot.east === rightMapViewportSnapshot.east &&
    leftMapViewportSnapshot.north === rightMapViewportSnapshot.north &&
    leftMapViewportSnapshot.zoom === rightMapViewportSnapshot.zoom &&
    leftMapViewportSnapshot.centerLatitude === rightMapViewportSnapshot.centerLatitude &&
    leftMapViewportSnapshot.centerLongitude === rightMapViewportSnapshot.centerLongitude
  );
};

type MarkerSelectionTestWindow = Window & {
  campfireMarkerSelectionHandlers?: Record<string, () => void>;
  campfireLeafletMap?: ReturnType<typeof useMap>;
  campfireForestPopupLifecycle?: {
    mountCount: number;
    unmountCount: number;
  };
};

export const MapTestBridge = () => {
  const map = useMap();

  useEffect(() => {
    const markerSelectionTestWindow = window as MarkerSelectionTestWindow;
    markerSelectionTestWindow.campfireLeafletMap = map;

    return () => {
      if (markerSelectionTestWindow.campfireLeafletMap === map) {
        delete markerSelectionTestWindow.campfireLeafletMap;
      }
    };
  }, [map]);

  return null;
};

type SelectedForestPopupState = {
  forest: ForestWithCoordinates;
  matchesFilters: boolean;
};

const ForestPopupContent = ({
  forest,
  availableFacilities,
  avoidTolls
}: {
  forest: ForestWithCoordinates;
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
}) => {
  useEffect(() => {
    const markerSelectionTestWindow = window as MarkerSelectionTestWindow;
    const popupLifecycle = markerSelectionTestWindow.campfireForestPopupLifecycle ?? {
      mountCount: 0,
      unmountCount: 0
    };

    popupLifecycle.mountCount += 1;
    markerSelectionTestWindow.campfireForestPopupLifecycle = popupLifecycle;

    return () => {
      const currentPopupLifecycle = markerSelectionTestWindow.campfireForestPopupLifecycle ?? popupLifecycle;
      currentPopupLifecycle.unmountCount += 1;
      markerSelectionTestWindow.campfireForestPopupLifecycle = currentPopupLifecycle;
    };
  }, []);

  return (
    <div className="forest-popup-card" data-testid="forest-popup-card">
      <ForestCardContent
        forest={forest}
        availableFacilities={availableFacilities}
        avoidTolls={avoidTolls}
      />
    </div>
  );
};

const ForestMarker = memo(({
  forest,
  matchesFilters,
  hoveredForestId,
  selectForestPopup
}: {
  forest: ForestWithCoordinates;
  matchesFilters: boolean;
  hoveredForestId: string | null;
  selectForestPopup: (selectedForestPopupState: SelectedForestPopupState) => void;
}) => {
  const isHoveredForest = hoveredForestId === forest.id;
  const markerPaneName = matchesFilters ? "matched-forests" : "unmatched-forests";
  const { markerRadius, markerPathOptions } = getForestMarkerVisualOptions({
    matchesFilters,
    isHoveredForest
  });
  const {
    displayMarkerInteractive,
    clickTargetMarkerRadius
  } = getForestMarkerInteractionOptions({
    matchesFilters,
    displayMarkerRadius: markerRadius
  });
  const selectForest = () => {
    selectForestPopup({
      forest,
      matchesFilters
    });
  };

  useEffect(() => {
    const markerSelectionTestWindow = window as MarkerSelectionTestWindow;
    const markerSelectionHandlers = markerSelectionTestWindow
      .campfireMarkerSelectionHandlers ?? (markerSelectionTestWindow.campfireMarkerSelectionHandlers = {});

    markerSelectionHandlers[forest.id] = selectForest;

    return () => {
      const currentMarkerSelectionHandlers = markerSelectionTestWindow.campfireMarkerSelectionHandlers;
      if (!currentMarkerSelectionHandlers) {
        return;
      }

      if (currentMarkerSelectionHandlers[forest.id] !== selectForest) {
        return;
      }

      delete currentMarkerSelectionHandlers[forest.id];
    };
  }, [forest.id, selectForest]);

  if (clickTargetMarkerRadius !== null) {
    return (
      <>
        <CircleMarker
          center={[forest.latitude, forest.longitude]}
          pane={markerPaneName}
          radius={markerRadius}
          pathOptions={markerPathOptions}
          interactive={displayMarkerInteractive}
        />
        <CircleMarker
          center={[forest.latitude, forest.longitude]}
          pane={markerPaneName}
          radius={clickTargetMarkerRadius}
          pathOptions={{
            color: "transparent",
            fillColor: "transparent",
            opacity: 0.01,
            fillOpacity: 0.01,
            weight: 0
          }}
          eventHandlers={{
            click: selectForest
          }}
        />
      </>
    );
  }

  return (
    <CircleMarker
      center={[forest.latitude, forest.longitude]}
      pane={markerPaneName}
      radius={markerRadius}
      pathOptions={markerPathOptions}
      interactive={displayMarkerInteractive}
      eventHandlers={{
        click: selectForest
      }}
    />
  );
});

ForestMarker.displayName = "ForestMarker";

export const VisibleForestMarkers = ({
  matchedForests,
  unmatchedForests,
  availableFacilities,
  avoidTolls,
  hoveredForestId
}: {
  matchedForests: ForestWithCoordinates[];
  unmatchedForests: ForestWithCoordinates[];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  hoveredForestId: string | null;
}) => {
  const map = useMap();
  const [mapViewportSnapshot, setMapViewportSnapshot] =
    useState<MapViewportSnapshot | null>(null);
  const [selectedForestPopupState, setSelectedForestPopupState] =
    useState<SelectedForestPopupState | null>(null);

  const readMapViewportSnapshot = (): MapViewportSnapshot => {
    const currentMapBounds = map.getBounds();
    const currentMapCenter = map.getCenter();
    const currentMapZoom = map.getZoom();

    return {
      west: currentMapBounds.getWest(),
      south: currentMapBounds.getSouth(),
      east: currentMapBounds.getEast(),
      north: currentMapBounds.getNorth(),
      zoom: currentMapZoom,
      centerLatitude: currentMapCenter.lat,
      centerLongitude: currentMapCenter.lng
    };
  };

  useEffect(() => {
    const refreshMapViewportSnapshot = () => {
      const nextMapViewportSnapshot = readMapViewportSnapshot();
      setMapViewportSnapshot((currentMapViewportSnapshot) => {
        if (areMapViewportSnapshotsEqual(currentMapViewportSnapshot, nextMapViewportSnapshot)) {
          return currentMapViewportSnapshot;
        }

        return nextMapViewportSnapshot;
      });
    };

    refreshMapViewportSnapshot();

    map.on("moveend", refreshMapViewportSnapshot);
    map.on("zoomend", refreshMapViewportSnapshot);
    map.on("resize", refreshMapViewportSnapshot);

    return () => {
      map.off("moveend", refreshMapViewportSnapshot);
      map.off("zoomend", refreshMapViewportSnapshot);
      map.off("resize", refreshMapViewportSnapshot);
    };
  }, [map]);

  const paddedVisibleMapBounds = useMemo(
    () => map.getBounds().pad(MAP_BOUNDS_PADDING_FACTOR),
    [map, mapViewportSnapshot]
  );
  const currentMapZoom = useMemo(() => map.getZoom(), [map, mapViewportSnapshot]);
  const currentMapCenter = useMemo(() => map.getCenter(), [map, mapViewportSnapshot]);

  const { visibleMatchedForests, renderedUnmatchedForests } = useMemo(() => {
    const nextVisibleMatchedForests: ForestWithCoordinates[] = [];
    const nextVisibleUnmatchedForests: ForestWithCoordinates[] = [];

    for (const forest of matchedForests) {
      if (paddedVisibleMapBounds.contains([forest.latitude, forest.longitude])) {
        nextVisibleMatchedForests.push(forest);
      }
    }

    for (const forest of unmatchedForests) {
      if (paddedVisibleMapBounds.contains([forest.latitude, forest.longitude])) {
        nextVisibleUnmatchedForests.push(forest);
      }
    }

    const unmatchedMarkerLimit = getUnmatchedMarkerLimitForZoom(currentMapZoom);
    if (
      unmatchedMarkerLimit === null ||
      nextVisibleUnmatchedForests.length <= unmatchedMarkerLimit
    ) {
      return {
        visibleMatchedForests: nextVisibleMatchedForests,
        renderedUnmatchedForests: nextVisibleUnmatchedForests
      };
    }

    return {
      visibleMatchedForests: nextVisibleMatchedForests,
      renderedUnmatchedForests: selectClosestForestsToCenter(
        nextVisibleUnmatchedForests,
        currentMapCenter.lat,
        currentMapCenter.lng,
        unmatchedMarkerLimit
      )
    };
  }, [
    matchedForests,
    unmatchedForests,
    paddedVisibleMapBounds,
    currentMapCenter.lat,
    currentMapCenter.lng,
    currentMapZoom
  ]);

  useEffect(() => {
    if (!selectedForestPopupState) {
      return;
    }

    const selectedForestStillExists = isSelectedForestStillAvailable({
      selectedForestId: selectedForestPopupState.forest.id,
      matchedForests,
      unmatchedForests
    });

    if (!selectedForestStillExists) {
      setSelectedForestPopupState(null);
    }
  }, [matchedForests, selectedForestPopupState, unmatchedForests]);

  const selectedForestPopupPosition = useMemo(() => {
    return buildSelectedForestPopupPosition({
      selectedForestPopupSnapshot: selectedForestPopupState
    });
  }, [
    selectedForestPopupState?.forest.id,
    selectedForestPopupState?.forest.latitude,
    selectedForestPopupState?.forest.longitude
  ]);

  useEffect(() => {
    if (!selectedForestPopupPosition) {
      return;
    }

    map.panInside(selectedForestPopupPosition, {
      animate: true,
      padding: [220, 220]
    });
  }, [map, selectedForestPopupPosition]);

  return (
    <>
      <Pane name="unmatched-forests" style={{ zIndex: 610 }}>
        {renderedUnmatchedForests.map((forest) => (
          <ForestMarker
            key={forest.id}
            forest={forest}
            matchesFilters={false}
            hoveredForestId={hoveredForestId}
            selectForestPopup={setSelectedForestPopupState}
          />
        ))}
      </Pane>

      <Pane name="matched-forests" style={{ zIndex: 660 }}>
        {visibleMatchedForests.map((forest) => (
          <ForestMarker
            key={forest.id}
            forest={forest}
            matchesFilters={true}
            hoveredForestId={hoveredForestId}
            selectForestPopup={setSelectedForestPopupState}
          />
        ))}
      </Pane>

      <Pane name="selected-forest-popup" style={{ zIndex: 900 }} />

      {selectedForestPopupState && selectedForestPopupPosition ? (
        <Popup
          position={selectedForestPopupPosition}
          className="forest-popup"
          minWidth={420}
          maxWidth={510}
          autoPan={false}
          keepInView={false}
          pane="selected-forest-popup"
          eventHandlers={{
            remove: () => {
              setSelectedForestPopupState(null);
            }
          }}
        >
          <ForestPopupContent
            forest={selectedForestPopupState.forest}
            availableFacilities={availableFacilities}
            avoidTolls={avoidTolls}
          />
        </Popup>
      ) : null}
    </>
  );
};
