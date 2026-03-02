import { IconCurrentLocation, IconCar } from "@tabler/icons-react";
import { Button, Group, Text, Tooltip } from "@mantine/core";
import type { ForestApiResponse, NearestForest } from "../lib/api";
import {
  buildGoogleMapsDrivingNavigationUrl,
  forestHasCoordinates,
  formatDriveSummary,
  isHttpUrl
} from "../lib/app-domain-forest";
import type { UserLocation } from "../lib/forests-query";
import type { LocationSource } from "../lib/location-constants";

export type LocationStatusPanelsProps = {
  loading: boolean;
  payload: ForestApiResponse | null;
  userLocation: UserLocation | null;
  locationSource: LocationSource;
  nearestLegalCampfire: NearestForest | null;
  nearestLegalCampfireWithCamping: NearestForest | null;
  onRequestLocation: () => void;
  allForests: ForestApiResponse["forests"];
  avoidTolls: boolean;
};

const NearestSpotCard = ({
  forest,
  label,
  allForests,
  avoidTolls
}: {
  forest: NearestForest;
  label: string;
  allForests: ForestApiResponse["forests"];
  avoidTolls: boolean;
}) => {
  const fullForest = allForests.find((candidate) => candidate.id === forest.id);
  const forestUrl = fullForest?.forestUrl;
  const hasCoordinates = fullForest ? forestHasCoordinates(fullForest) : false;
  const navigationUrl = fullForest && hasCoordinates
    ? buildGoogleMapsDrivingNavigationUrl(fullForest)
    : null;

  const hasDrivingDistance = forest.travelDurationMinutes !== null;
  const distanceTooltipLabel = hasDrivingDistance
    ? `Google Maps driving estimate (Sat 10am, tolls: ${avoidTolls ? "avoid" : "allow"}).`
    : "Straight-line distance — driving route was not available.";

  return (
    <Group gap={6} align="center" wrap="nowrap">
      <Text size="sm">
        {label}:{" "}
        {navigationUrl ? (
          <a
            href={navigationUrl}
            className="forest-navigation-link nearest-spot-nav-link"
            target="_blank"
            rel="noreferrer"
            aria-label={`Navigate to ${forest.forestName}`}
            title="Open driving navigation in Google Maps"
          >
            <IconCar size={14} stroke={1.5} />
          </a>
        ) : null}
        <strong>
          {forestUrl && isHttpUrl(forestUrl) ? (
            <a
              href={forestUrl}
              className="forest-name-link"
              target="_blank"
              rel="noreferrer"
            >
              {forest.forestName}
            </a>
          ) : (
            forest.forestName
          )}
        </strong>{" "}
        <Tooltip label={distanceTooltipLabel} position="top" openDelay={0} closeDelay={0} multiline w={250}>
          <span className="muted" style={{ cursor: "help" }}>
            ({formatDriveSummary(forest.distanceKm, forest.travelDurationMinutes)})
          </span>
        </Tooltip>
      </Text>
    </Group>
  );
};

export const LocationStatusPanels = ({
  loading,
  payload,
  userLocation,
  locationSource,
  nearestLegalCampfire,
  nearestLegalCampfireWithCamping,
  onRequestLocation,
  allForests,
  avoidTolls
}: LocationStatusPanelsProps) => {
  if (loading || !payload) {
    return null;
  }

  const isCampfireAndCampingSameForest =
    nearestLegalCampfire &&
    nearestLegalCampfireWithCamping &&
    nearestLegalCampfire.id === nearestLegalCampfireWithCamping.id;

  const locationLabel =
    locationSource === "GEOLOCATION"
      ? "Using your current location."
      : locationSource === "MAP_PIN"
        ? "Using location from map pin."
        : "Showing for Sydney. Click or long-tap on map to set location.";

  return (
    <section className="panel location-panel" data-testid="location-panel">
      <Group align="center" wrap="wrap" gap="xs" mb={nearestLegalCampfire ? 8 : 0}>
        <Button
          variant="filled"
          size="compact-sm"
          leftSection={<IconCurrentLocation size={16} />}
          onClick={onRequestLocation}
          data-testid="locate-btn"
        >
          Use my location
        </Button>
        <Text size="sm" c="dimmed">{locationLabel}</Text>
      </Group>

      {nearestLegalCampfire ? (
        <div data-testid="nearest-spot">
          <NearestSpotCard
            forest={nearestLegalCampfire}
            label="Closest legal campfire"
            allForests={allForests}
            avoidTolls={avoidTolls}
          />
          {isCampfireAndCampingSameForest ? (
            <Text size="xs" c="dimmed" ml={28}>
              This spot also has camping facilities.
            </Text>
          ) : nearestLegalCampfireWithCamping ? (
            <NearestSpotCard
              forest={nearestLegalCampfireWithCamping}
              label="Closest legal campfire + camping"
              allForests={allForests}
              avoidTolls={avoidTolls}
            />
          ) : null}
        </div>
      ) : (
        <Text size="sm" c="dimmed" mt={4} data-testid="nearest-empty">
          No legal campfire spot could be determined from currently mapped forests.
        </Text>
      )}
    </section>
  );
};
