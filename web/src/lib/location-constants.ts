import type { UserLocation } from "./forests-query";

export const SYDNEY_DEFAULT_LOCATION: UserLocation = {
  latitude: -33.8688,
  longitude: 151.2093
};

export type LocationSource = "DEFAULT_SYDNEY" | "GEOLOCATION" | "MAP_PIN";
