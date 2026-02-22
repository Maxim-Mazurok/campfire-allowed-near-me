import { memo, useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Pane,
  Popup,
  TileLayer,
  useMap
} from "react-leaflet";
import type { ForestPoint } from "../lib/api";

const DEFAULT_CENTER: [number, number] = [-32.1633, 147.0166];

const formatDriveDuration = (durationMinutes: number | null): string => {
  if (durationMinutes === null || !Number.isFinite(durationMinutes)) {
    return "Drive time unavailable";
  }

  const rounded = Math.max(1, Math.round(durationMinutes));
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
};

const formatDriveSummary = (forest: ForestPoint): string => {
  if (forest.distanceKm === null) {
    return "Drive distance unavailable";
  }

  if (forest.travelDurationMinutes === null) {
    return `${forest.distanceKm.toFixed(1)} km`;
  }

  return `${forest.distanceKm.toFixed(1)} km, ${formatDriveDuration(forest.travelDurationMinutes)}`;
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

const FitToForests = ({ forests }: { forests: ForestPoint[] }) => {
  const map = useMap();

  useEffect(() => {
    const points = forests
      .filter((forest) => forest.latitude !== null && forest.longitude !== null)
      .map((forest) => [forest.latitude!, forest.longitude!] as [number, number]);

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
  userLocation
}: {
  forests: ForestPoint[];
  matchedForestIds: Set<string>;
  userLocation: { latitude: number; longitude: number } | null;
}) => {
  const mappedForests = useMemo(
    () => forests.filter((forest) => forest.latitude !== null && forest.longitude !== null),
    [forests]
  );
  const { matchedForests, unmatchedForests } = useMemo(() => {
    const nextMatchedForests: ForestPoint[] = [];
    const nextUnmatchedForests: ForestPoint[] = [];

    for (const forest of mappedForests) {
      if (matchedForestIds.has(forest.id)) {
        nextMatchedForests.push(forest);
      } else {
        nextUnmatchedForests.push(forest);
      }
    }

    return {
      matchedForests: nextMatchedForests,
      unmatchedForests: nextUnmatchedForests
    };
  }, [mappedForests, matchedForestIds]);

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

      <Pane name="unmatched-forests" style={{ zIndex: 610 }}>
        {unmatchedForests.map((forest) => (
          <CircleMarker
            key={forest.id}
            center={[forest.latitude!, forest.longitude!]}
            pane="unmatched-forests"
            radius={4}
            pathOptions={{
              color: "#7f8690",
              fillColor: "#7f8690",
              fillOpacity: 0.32,
              opacity: 0.55
            }}
          >
            <Popup>
              <strong>{forest.forestName}</strong>
              <br />
              Area: {forest.areaName}
              <br />
              Solid fuel: {forest.banStatusText}
              <br />
              Total Fire Ban: {forest.totalFireBanStatusText}
              <br />
              Matches filters: No
              <br />
              Drive: {formatDriveSummary(forest)}
            </Popup>
          </CircleMarker>
        ))}
      </Pane>

      <Pane name="matched-forests" style={{ zIndex: 660 }}>
        {matchedForests.map((forest) => (
          <CircleMarker
            key={forest.id}
            center={[forest.latitude!, forest.longitude!]}
            pane="matched-forests"
            radius={9}
            pathOptions={{
              color: "#00e85a",
              fillColor: "#00e85a",
              fillOpacity: 0.95,
              opacity: 1
            }}
          >
            <Popup>
              <strong>{forest.forestName}</strong>
              <br />
              Area: {forest.areaName}
              <br />
              Solid fuel: {forest.banStatusText}
              <br />
              Total Fire Ban: {forest.totalFireBanStatusText}
              <br />
              Matches filters: Yes
              <br />
              Drive: {formatDriveSummary(forest)}
            </Popup>
          </CircleMarker>
        ))}
      </Pane>
    </MapContainer>
  );
});

MapView.displayName = "MapView";
