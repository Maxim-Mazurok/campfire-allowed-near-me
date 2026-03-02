import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Popup,
  TileLayer,
  useMap,
  useMapEvents
} from "react-leaflet";
import L from "leaflet";
import { ForestCardContent } from "./ForestCardContent";
import { PopupShadowContainer } from "./PopupShadowContainer";
import type { FacilityDefinition, ForestPoint } from "../lib/api";
import { forestBelongsToArea } from "../lib/app-domain-forest";
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
import type { LocationSource } from "../lib/location-constants";

const DEFAULT_CENTER: [number, number] = [-32.1633, 147.0166];
const MAP_BOUNDS_PADDING_FACTOR = 0.2;
type ForestWithCoordinates = ForestPoint & {
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

const FitToUser = ({
  latitude,
  longitude,
  locationSource
}: {
  latitude: number;
  longitude: number;
  locationSource: LocationSource;
}) => {
  const map = useMap();
  const previousSourceReference = useRef<LocationSource | null>(null);

  useEffect(() => {
    const isFirstRender = previousSourceReference.current === null;
    const sourceChanged = previousSourceReference.current !== locationSource;
    previousSourceReference.current = locationSource;

    // When the user places a map pin (including the first click), never
    // change the zoom — they are interacting directly with the map.
    if (locationSource === "MAP_PIN") {
      return;
    }

    // For geolocation or default, only fly on source change (not coord-only changes).
    if (sourceChanged && !isFirstRender) {
      map.setView([latitude, longitude], 8);
    }
  }, [latitude, longitude, map, locationSource]);

  return null;
};

const FitToForests = ({ forests }: { forests: ForestWithCoordinates[] }) => {
  const map = useMap();

  useEffect(() => {
    const points = forests.map((forest) => [forest.latitude, forest.longitude] as [number, number]);

    if (!points.length) {
      return;
    }

    map.fitBounds(points, { padding: [26, 26], maxZoom: 8 });
  }, [forests, map]);

  return null;
};

const LONG_TAP_DURATION_MILLISECONDS = 500;

const userPinIcon = L.divIcon({
  className: "user-pin-icon",
  html: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42" fill="none">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 26 16 26s16-14 16-26C32 7.163 24.837 0 16 0z" fill="#2b6cb0"/>
    <circle cx="16" cy="16" r="6" fill="white"/>
  </svg>`,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -42]
});

const MapPinHandler = ({
  onPinLocation
}: {
  onPinLocation: (latitude: number, longitude: number) => void;
}) => {
  const longTapTimerReference = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTouchDeviceReference = useRef(false);

  const cancelLongTap = useCallback(() => {
    if (longTapTimerReference.current) {
      clearTimeout(longTapTimerReference.current);
      longTapTimerReference.current = null;
    }
  }, []);

  useMapEvents({
    click(event) {
      if (isTouchDeviceReference.current) {
        return;
      }

      onPinLocation(event.latlng.lat, event.latlng.lng);
    }
  });

  const map = useMap();

  useEffect(() => {
    const mapContainer = map.getContainer();

    const handleTouchStart = (event: TouchEvent) => {
      isTouchDeviceReference.current = true;

      if (event.touches.length !== 1) {
        cancelLongTap();
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const startX = touch.clientX;
      const startY = touch.clientY;

      longTapTimerReference.current = setTimeout(() => {
        const containerPoint = map.mouseEventToContainerPoint({
          clientX: startX,
          clientY: startY
        } as MouseEvent);
        const latitudeLongitude = map.containerPointToLatLng(containerPoint);
        onPinLocation(latitudeLongitude.lat, latitudeLongitude.lng);
        longTapTimerReference.current = null;
      }, LONG_TAP_DURATION_MILLISECONDS);
    };

    const handleTouchMove = () => {
      cancelLongTap();
    };

    const handleTouchEnd = () => {
      cancelLongTap();
    };

    mapContainer.addEventListener("touchstart", handleTouchStart, { passive: true });
    mapContainer.addEventListener("touchmove", handleTouchMove, { passive: true });
    mapContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
    mapContainer.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      cancelLongTap();
      mapContainer.removeEventListener("touchstart", handleTouchStart);
      mapContainer.removeEventListener("touchmove", handleTouchMove);
      mapContainer.removeEventListener("touchend", handleTouchEnd);
      mapContainer.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [map, onPinLocation, cancelLongTap]);

  return null;
};

const DraggableUserPin = ({
  latitude,
  longitude,
  locationSource,
  onPinDragEnd
}: {
  latitude: number;
  longitude: number;
  locationSource: LocationSource;
  onPinDragEnd: (latitude: number, longitude: number) => void;
}) => {
  const markerReference = useRef<L.Marker | null>(null);

  const handleDragEnd = useCallback(() => {
    const marker = markerReference.current;
    if (!marker) {
      return;
    }

    const position = marker.getLatLng();
    onPinDragEnd(position.lat, position.lng);
  }, [onPinDragEnd]);

  if (locationSource === "DEFAULT_SYDNEY") {
    return null;
  }

  return (
    <Marker
      position={[latitude, longitude]}
      icon={userPinIcon}
      draggable
      ref={markerReference}
      eventHandlers={{ dragend: handleDragEnd }}
    >
      <Popup>
        {locationSource === "GEOLOCATION" ? "Your location (drag to adjust)" : "Custom location (drag to adjust)"}
      </Popup>
    </Marker>
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

const MapTestBridge = () => {
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
  avoidTolls,
  onHoveredAreaNameChange
}: {
  forest: ForestWithCoordinates;
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  onHoveredAreaNameChange?: (hoveredAreaName: string | null) => void;
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
    <PopupShadowContainer>
      <div className="forest-popup-card" data-testid="forest-popup-card">
        <ForestCardContent
          forest={forest}
          availableFacilities={availableFacilities}
          avoidTolls={avoidTolls}
          onHoveredAreaNameChange={onHoveredAreaNameChange}
        />
      </div>
    </PopupShadowContainer>
  );
};

const ForestMarker = memo(({
  forest,
  matchesFilters,
  hoveredForestId,
  hoveredAreaName,
  selectForestPopup
}: {
  forest: ForestWithCoordinates;
  matchesFilters: boolean;
  hoveredForestId: string | null;
  hoveredAreaName: string | null;
  selectForestPopup: (selectedForestPopupState: SelectedForestPopupState) => void;
}) => {
  const isHoveredForest = hoveredForestId === forest.id;
  const isAreaHighlighted = hoveredAreaName !== null && forestBelongsToArea(forest, hoveredAreaName);
  const markerPaneName = isAreaHighlighted
    ? "area-highlighted-forests"
    : isHoveredForest
      ? "hovered-forest"
      : matchesFilters
        ? "matched-forests"
        : "unmatched-forests";
  const { markerRadius, markerPathOptions } = getForestMarkerVisualOptions({
    matchesFilters,
    isHoveredForest,
    isAreaHighlighted
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
          bubblingMouseEvents={false}
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
      bubblingMouseEvents={false}
      eventHandlers={{
        click: selectForest
      }}
    />
  );
});

const VisibleForestMarkers = ({
  matchedForests,
  unmatchedForests,
  availableFacilities,
  avoidTolls,
  hoveredForestId,
  hoveredAreaName,
  onHoveredAreaNameChange
}: {
  matchedForests: ForestWithCoordinates[];
  unmatchedForests: ForestWithCoordinates[];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  hoveredForestId: string | null;
  hoveredAreaName: string | null;
  onHoveredAreaNameChange?: (hoveredAreaName: string | null) => void;
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
        {renderedUnmatchedForests
          .filter((forest) => hoveredAreaName === null || !forestBelongsToArea(forest, hoveredAreaName))
          .map((forest) => (
            <ForestMarker
              key={forest.id}
              forest={forest}
              matchesFilters={false}
              hoveredForestId={hoveredForestId}
              hoveredAreaName={hoveredAreaName}
              selectForestPopup={setSelectedForestPopupState}
            />
          ))}
      </Pane>

      <Pane name="matched-forests" style={{ zIndex: 660 }}>
        {visibleMatchedForests
          .filter((forest) => hoveredAreaName === null || !forestBelongsToArea(forest, hoveredAreaName))
          .map((forest) => (
            <ForestMarker
              key={forest.id}
              forest={forest}
              matchesFilters={true}
              hoveredForestId={hoveredForestId}
              hoveredAreaName={hoveredAreaName}
              selectForestPopup={setSelectedForestPopupState}
            />
          ))}
      </Pane>

      {hoveredAreaName !== null ? (
        <Pane name="area-highlighted-forests" style={{ zIndex: 700 }}>
          {renderedUnmatchedForests
            .filter((forest) => forestBelongsToArea(forest, hoveredAreaName))
            .map((forest) => (
              <ForestMarker
                key={forest.id}
                forest={forest}
                matchesFilters={false}
                hoveredForestId={hoveredForestId}
                hoveredAreaName={hoveredAreaName}
                selectForestPopup={setSelectedForestPopupState}
              />
            ))}
          {visibleMatchedForests
            .filter((forest) => forestBelongsToArea(forest, hoveredAreaName))
            .map((forest) => (
              <ForestMarker
                key={forest.id}
                forest={forest}
                matchesFilters={true}
                hoveredForestId={hoveredForestId}
                hoveredAreaName={hoveredAreaName}
                selectForestPopup={setSelectedForestPopupState}
              />
            ))}
        </Pane>
      ) : null}

      <Pane name="hovered-forest" style={{ zIndex: 750 }} />

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
            onHoveredAreaNameChange={onHoveredAreaNameChange}
          />
        </Popup>
      ) : null}
    </>
  );
};

ForestMarker.displayName = "ForestMarker";

export const MapView = memo(({
  forests,
  matchedForestIds,
  userLocation,
  locationSource,
  availableFacilities,
  avoidTolls,
  hoveredForestId,
  hoveredAreaName,
  onHoveredAreaNameChange,
  onMapPinLocation
}: {
  forests: ForestPoint[];
  matchedForestIds: Set<string>;
  userLocation: { latitude: number; longitude: number } | null;
  locationSource: LocationSource;
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  hoveredForestId: string | null;
  hoveredAreaName: string | null;
  onHoveredAreaNameChange?: (hoveredAreaName: string | null) => void;
  onMapPinLocation: (latitude: number, longitude: number) => void;
}) => {
  const { mappedForests, matchedForests, unmatchedForests } = useMemo(() => {
    const nextMappedForests: ForestWithCoordinates[] = [];
    const nextMatchedForests: ForestWithCoordinates[] = [];
    const nextUnmatchedForests: ForestWithCoordinates[] = [];

    for (const forest of forests) {
      if (forest.latitude === null || forest.longitude === null) {
        continue;
      }

      const forestWithCoordinates: ForestWithCoordinates = {
        ...forest,
        latitude: forest.latitude,
        longitude: forest.longitude
      };

      nextMappedForests.push(forestWithCoordinates);

      if (matchedForestIds.has(forest.id)) {
        nextMatchedForests.push(forestWithCoordinates);
      } else {
        nextUnmatchedForests.push(forestWithCoordinates);
      }
    }

    return {
      mappedForests: nextMappedForests,
      matchedForests: nextMatchedForests,
      unmatchedForests: nextUnmatchedForests
    };
  }, [forests, matchedForestIds]);

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={6}
      scrollWheelZoom
      className="map"
      data-testid="map-container"
      data-hovered-forest-id={hoveredForestId ?? ""}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapTestBridge />
      <MapPinHandler onPinLocation={onMapPinLocation} />

      {locationSource === "DEFAULT_SYDNEY" ? (
        <FitToForests forests={mappedForests} />
      ) : userLocation ? (
        <>
          <FitToUser latitude={userLocation.latitude} longitude={userLocation.longitude} locationSource={locationSource} />
          <DraggableUserPin
            latitude={userLocation.latitude}
            longitude={userLocation.longitude}
            locationSource={locationSource}
            onPinDragEnd={onMapPinLocation}
          />
        </>
      ) : <FitToForests forests={mappedForests} />}

      <VisibleForestMarkers
        matchedForests={matchedForests}
        unmatchedForests={unmatchedForests}
        availableFacilities={availableFacilities}
        avoidTolls={avoidTolls}
        hoveredForestId={hoveredForestId}
        hoveredAreaName={hoveredAreaName}
        onHoveredAreaNameChange={onHoveredAreaNameChange}
      />
    </MapContainer>
  );
});

MapView.displayName = "MapView";
