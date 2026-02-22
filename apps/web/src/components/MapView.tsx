import { memo, useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Pane,
  Popup,
  TileLayer,
  useMap
} from "react-leaflet";
import { ForestCardContent } from "./ForestCardContent";
import type { FacilityDefinition, ForestPoint } from "../lib/api";
import {
  getUnmatchedMarkerLimitForZoom,
  selectClosestForestsToCenter
} from "../lib/map-marker-rendering";

const DEFAULT_CENTER: [number, number] = [-32.1633, 147.0166];
const MAP_BOUNDS_PADDING_FACTOR = 0.2;
const MATCHED_FOREST_MARKER_PATH_OPTIONS = {
  color: "#00e85a",
  fillColor: "#00e85a",
  fillOpacity: 0.95,
  opacity: 1
} as const;
const UNMATCHED_FOREST_MARKER_PATH_OPTIONS = {
  color: "#7f8690",
  fillColor: "#7f8690",
  fillOpacity: 0.32,
  opacity: 0.55
} as const;

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
  longitude
}: {
  latitude: number;
  longitude: number;
}) => {
  const map = useMap();
  useEffect(() => {
    map.setView([latitude, longitude], 8);
  }, [latitude, longitude, map]);

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
  selectForestPopup
}: {
  forest: ForestWithCoordinates;
  matchesFilters: boolean;
  selectForestPopup: (selectedForestPopupState: SelectedForestPopupState) => void;
}) => {
  const markerPaneName = matchesFilters ? "matched-forests" : "unmatched-forests";
  const markerRadius = matchesFilters ? 9 : 4;
  const markerPathOptions = matchesFilters
    ? MATCHED_FOREST_MARKER_PATH_OPTIONS
    : UNMATCHED_FOREST_MARKER_PATH_OPTIONS;

  return (
    <CircleMarker
      center={[forest.latitude, forest.longitude]}
      pane={markerPaneName}
      radius={markerRadius}
      pathOptions={markerPathOptions}
      eventHandlers={{
        click: () => {
          selectForestPopup({
            forest,
            matchesFilters
          });
        }
      }}
    />
  );
});

const VisibleForestMarkers = ({
  matchedForests,
  unmatchedForests,
  availableFacilities,
  avoidTolls
}: {
  matchedForests: ForestWithCoordinates[];
  unmatchedForests: ForestWithCoordinates[];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
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

    const forestsToCheck = selectedForestPopupState.matchesFilters
      ? visibleMatchedForests
      : renderedUnmatchedForests;
    const selectedForestStillVisible = forestsToCheck.some(
      (forest) => forest.id === selectedForestPopupState.forest.id
    );

    if (!selectedForestStillVisible) {
      setSelectedForestPopupState(null);
    }
  }, [renderedUnmatchedForests, selectedForestPopupState, visibleMatchedForests]);

  return (
    <>
      <Pane name="unmatched-forests" style={{ zIndex: 610 }}>
        {renderedUnmatchedForests.map((forest) => (
          <ForestMarker
            key={forest.id}
            forest={forest}
            matchesFilters={false}
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
            selectForestPopup={setSelectedForestPopupState}
          />
        ))}
      </Pane>

      <Pane name="selected-forest-popup" style={{ zIndex: 900 }} />

      {selectedForestPopupState ? (
        <Popup
          position={[
            selectedForestPopupState.forest.latitude,
            selectedForestPopupState.forest.longitude
          ]}
          className="forest-popup"
          minWidth={420}
          maxWidth={510}
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

ForestMarker.displayName = "ForestMarker";

export const MapView = memo(({
  forests,
  matchedForestIds,
  userLocation,
  availableFacilities,
  avoidTolls
}: {
  forests: ForestPoint[];
  matchedForestIds: Set<string>;
  userLocation: { latitude: number; longitude: number } | null;
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
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
      preferCanvas
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {userLocation ? (
        <>
          <FitToUser latitude={userLocation.latitude} longitude={userLocation.longitude} />
          <CircleMarker
            center={[userLocation.latitude, userLocation.longitude]}
            radius={8}
            pathOptions={{ color: "#2b6cb0", fillColor: "#2b6cb0", fillOpacity: 0.7 }}
          >
            <Popup>Your location</Popup>
          </CircleMarker>
        </>
      ) : <FitToForests forests={mappedForests} />}

      <VisibleForestMarkers
        matchedForests={matchedForests}
        unmatchedForests={unmatchedForests}
        availableFacilities={availableFacilities}
        avoidTolls={avoidTolls}
      />
    </MapContainer>
  );
});

MapView.displayName = "MapView";
