import { IconCar } from "@tabler/icons-react";
import { Badge, Tooltip } from "@mantine/core";
import { memo } from "react";
import { FacilityIcon } from "./FacilityIcon";
import type { FacilityDefinition, ForestApiResponse } from "../lib/api";
import {
  buildGoogleMapsDrivingNavigationUrl,
  buildTextHighlightUrl,
  buildTotalFireBanDetailsUrl,
  formatDriveSummary,
  isHttpUrl
} from "../lib/app-domain-forest";
import {
  getClosureStatusLabel,
  getForestClosureStatus,
  getForestImpactSummary,
  getSolidFuelStatusLabel,
  getTotalFireBanStatusLabel,
  inferFacilityImpactTarget,
  isImpactWarning
} from "../lib/app-domain-status";

type ForestCardContentProps = {
  forest: ForestApiResponse["forests"][number];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
};

export const ForestCardContent = memo(({
  forest,
  availableFacilities,
  avoidTolls
}: ForestCardContentProps) => {
  const forestClosureStatus = getForestClosureStatus(forest);
  const impactSummary = getForestImpactSummary(forest);
  const googleMapsDrivingNavigationUrl =
    buildGoogleMapsDrivingNavigationUrl(forest);
  const closureNotices = forest.closureNotices ?? [];
  const driveMetricTooltipText = `Google Maps estimate (Sat 10am, tolls: ${avoidTolls ? "avoid" : "allow"}) for realistic distance/time.`;

  return (
    <>
      <div className="forest-main-row">
        <div className="forest-title-block">
          <div className="forest-title-row">
            <a
              href={googleMapsDrivingNavigationUrl}
              className="forest-navigation-link"
              target="_blank"
              rel="noreferrer"
              aria-label={`Open driving navigation to ${forest.forestName} in Google Maps`}
              title="Open driving navigation in Google Maps"
              data-testid="forest-navigation-link"
            >
              <IconCar size={14} stroke={1.5} />
            </a>
            <strong>
              {isHttpUrl(forest.forestUrl) ? (
                <a
                  href={forest.forestUrl}
                  className="forest-name-link"
                  target="_blank"
                  rel="noreferrer"
                >
                  {forest.forestName}
                </a>
              ) : (
                forest.forestName
              )}
            </strong>
          </div>
          {isHttpUrl(forest.areaUrl) ? (
            <a
              href={buildTextHighlightUrl(forest.areaUrl, forest.forestName)}
              className="muted forest-region-link"
              target="_blank"
              rel="noreferrer"
            >
              {forest.areaName}
            </a>
          ) : (
            <div className="muted forest-region-link">{forest.areaName}</div>
          )}
        </div>
        <div className="status-block">
          <div className="status-pill-row">
            <Badge
              color={forest.banStatus === "NOT_BANNED" ? "green" : forest.banStatus === "BANNED" ? "red" : "gray"}
              variant="filled"
              size="sm"
              radius="xl"
            >
              {getSolidFuelStatusLabel(forest.banStatus)}
            </Badge>
            <Badge
              component="a"
              href={buildTotalFireBanDetailsUrl(forest)}
              target="_blank"
              rel="noreferrer"
              color={forest.totalFireBanStatus === "NOT_BANNED" ? "green" : forest.totalFireBanStatus === "BANNED" ? "red" : "gray"}
              variant="filled"
              size="sm"
              radius="xl"
              style={{ cursor: "pointer", textDecoration: "none" }}
            >
              {getTotalFireBanStatusLabel(forest.totalFireBanStatus)}
            </Badge>
            {forestClosureStatus === "CLOSED" || forestClosureStatus === "PARTIAL" ? (
              <Badge
                color={forestClosureStatus === "CLOSED" ? "red" : "orange"}
                variant="filled"
                size="sm"
                radius="xl"
              >
                {getClosureStatusLabel(forestClosureStatus)}
              </Badge>
            ) : null}
          </div>
          <Tooltip label={driveMetricTooltipText} position="top" openDelay={0} closeDelay={0}>
            <small className="muted" data-testid="distance-text">
              {forest.distanceKm !== null
                ? formatDriveSummary(
                    forest.distanceKm,
                    forest.travelDurationMinutes
                  )
                : "Drive distance unavailable"}
            </small>
          </Tooltip>
        </div>
      </div>
      {closureNotices.length > 0 ? (
        <div className="forest-notice-list-wrap" data-testid="forest-notice-list">
          <div className="forest-notice-list-label">Notices:</div>
          <ul className="forest-notice-list">
            {closureNotices.map((closureNotice) => (
              <li key={closureNotice.id} className="forest-notice-item">
                {isHttpUrl(closureNotice.detailUrl) ? (
                  <a
                    href={closureNotice.detailUrl}
                    className="forest-notice-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {closureNotice.title}
                  </a>
                ) : (
                  <span>{closureNotice.title}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {availableFacilities.length ? (
        <div className="facility-row" data-testid="facility-row">
          {availableFacilities.map((facility) => {
            const facilityImpactTarget = inferFacilityImpactTarget(facility);
            const hasWarning =
              facilityImpactTarget === "CAMPING"
                ? isImpactWarning(impactSummary.campingImpact)
                : facilityImpactTarget === "ACCESS_2WD"
                  ? isImpactWarning(impactSummary.access2wdImpact)
                  : facilityImpactTarget === "ACCESS_4WD"
                    ? isImpactWarning(impactSummary.access4wdImpact)
                    : false;
            const value = forest.facilities[facility.key];
            const stateClass =
              value === true ? "present" : value === false ? "absent" : "unknown";

            const statusText =
              value === true ? "Yes" : value === false ? "No" : "Unknown";

            return (
              <Tooltip
                key={`${forest.id}:${facility.key}`}
                label={`${facility.label}: ${statusText}`}
                openDelay={0}
                closeDelay={0}
                position="top"
              >
                <span
                  className={`facility-indicator ${stateClass}`}
                  data-facility-key={facility.key}
                  data-warning={hasWarning ? "true" : "false"}
                >
                  <FacilityIcon facility={facility} />
                </span>
              </Tooltip>
            );
          })}
        </div>
      ) : null}
    </>
  );
});

ForestCardContent.displayName = "ForestCardContent";