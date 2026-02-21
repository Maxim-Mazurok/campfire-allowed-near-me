import { useEffect, useMemo } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap
} from "react-leaflet";
import type { ForestPoint } from "../lib/api";

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

const markerColor = (status: ForestPoint["banStatus"]): string => {
  if (status === "NOT_BANNED") {
    return "#1f9d55";
  }

  if (status === "BANNED") {
    return "#d64545";
  }

  return "#718096";
};

export const MapView = ({
  forests,
  userLocation
}: {
  forests: ForestPoint[];
  userLocation: { latitude: number; longitude: number } | null;
}) => {
  const centeredForests = useMemo(
    () => forests.filter((forest) => forest.latitude !== null && forest.longitude !== null),
    [forests]
  );

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={6}
      scrollWheelZoom
      className="map"
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
      ) : <FitToForests forests={centeredForests} />}

      {centeredForests.map((forest) => (
        <CircleMarker
          key={forest.id}
          center={[forest.latitude!, forest.longitude!]}
          radius={6}
          pathOptions={{
            color: markerColor(forest.banStatus),
            fillColor: markerColor(forest.banStatus),
            fillOpacity: 0.75
          }}
        >
          <Popup>
            <strong>{forest.forestName}</strong>
            <br />
            Area: {forest.areaName}
            <br />
            Status: {forest.banStatusText}
            {forest.distanceKm !== null ? (
              <>
                <br />
                Distance: {forest.distanceKm.toFixed(1)} km
              </>
            ) : null}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
};
