import { useEffect, useState } from "react";
import type { UserLocation } from "../forests-query";

export type UseLocationResult = {
  locationError: string | null;
  requestLocation: (options?: { silent?: boolean }) => void;
};

export const useLocation = ({
  userLocation,
  setUserLocation
}: {
  userLocation: UserLocation | null;
  setUserLocation: (userLocation: UserLocation | null) => void;
}): UseLocationResult => {
  const [locationError, setLocationError] = useState<string | null>(null);

  const requestLocation = (options?: { silent?: boolean }) => {
    if (!navigator.geolocation) {
      if (!options?.silent) {
        setLocationError("Geolocation is not supported by this browser.");
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };

        setLocationError(null);
        setUserLocation(location);
      },
      (geolocationError) => {
        if (!options?.silent) {
          setLocationError(`Unable to read your location: ${geolocationError.message}`);
        }
      }
    );
  };

  useEffect(() => {
    const requestLocationIfPermissionGranted = async () => {
      if (!("permissions" in navigator)) {
        return;
      }

      try {
        const permissionStatus = await navigator.permissions.query({
          name: "geolocation"
        });

        if (permissionStatus.state === "granted") {
          requestLocation({ silent: true });
        }
      } catch {
        return;
      }
    };

    void requestLocationIfPermissionGranted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    locationError,
    requestLocation
  };
};
