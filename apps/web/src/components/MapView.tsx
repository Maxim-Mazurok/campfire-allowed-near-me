import { memo, useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap
} from "react-leaflet";
import type { FacilityDefinition, ForestPoint } from "../lib/api";
import {
  ForestWithCoordinates,
  MapTestBridge,
  VisibleForestMarkers
} from "./map-forest-markers";

const DEFAULT_CENTER: [number, number] = [-32.1633, 147.0166];

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

export const MapView = memo(({
  forests,
  matchedForestIds,
  userLocation,
  availableFacilities,
  avoidTolls,
  hoveredForestId
}: {
  forests: ForestPoint[];
  matchedForestIds: Set<string>;
  userLocation: { latitude: number; longitude: number } | null;
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  hoveredForestId: string | null;
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
        hoveredForestId={hoveredForestId}
      />
    </MapContainer>
  );
});

MapView.displayName = "MapView";
