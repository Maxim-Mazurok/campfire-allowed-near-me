import { IconCurrentLocation } from "@tabler/icons-react";
import type { ForestApiResponse } from "../lib/api";
import { formatDriveSummary } from "../lib/app-domain-forest";
import type { UserLocation } from "../lib/forests-query";

export type LocationStatusPanelsProps = {
  loading: boolean;
  payload: ForestApiResponse | null;
  userLocation: UserLocation | null;
  onRequestLocation: () => void;
};

export const LocationStatusPanels = ({
  loading,
  payload,
  userLocation,
  onRequestLocation
}: LocationStatusPanelsProps) => {
  const locationButtonLabel = userLocation
    ? "Refresh current location"
    : "Enable current location";

  const locationButton = (
    <button
      type="button"
      className="location-action-btn"
      onClick={onRequestLocation}
      data-testid="locate-btn"
      aria-label={locationButtonLabel}
      title={locationButtonLabel}
    >
      <IconCurrentLocation size={18} stroke={1.5} />
    </button>
  );

  return (
    <>
      {!loading && payload && !userLocation ? (
        <section className="panel warning" data-testid="location-required">
          <p className="location-inline-row">
            {locationButton}
            <span>Enable location to find the closest legal campfire spot near you.</span>
          </p>
        </section>
      ) : null}
      {payload?.nearestLegalSpot && userLocation ? (
        <section className="panel nearest" data-testid="nearest-spot">
          <p className="location-inline-row">
            {locationButton}
            <span>Using your current location. Click to refresh if you move.</span>
          </p>
          <p className="nearest-copy">
            Closest legal campfire spot: <strong>{payload.nearestLegalSpot.forestName}</strong> (
            {formatDriveSummary(
              payload.nearestLegalSpot.distanceKm,
              payload.nearestLegalSpot.travelDurationMinutes
            )}
            )
          </p>
        </section>
      ) : null}
      {!loading && userLocation && payload && !payload.nearestLegalSpot ? (
        <section className="panel warning" data-testid="nearest-empty">
          <p className="location-inline-row">
            {locationButton}
            <span>Using your current location. Click to refresh if you move.</span>
          </p>
          <p className="nearest-copy">
            No legal campfire spot could be determined from currently mapped forests.
          </p>
        </section>
      ) : null}
    </>
  );
};
