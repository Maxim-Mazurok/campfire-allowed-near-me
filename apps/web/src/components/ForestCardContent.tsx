import { faCar } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Tippy from "@tippyjs/react";
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
  getStatusClassName,
  getTotalFireBanStatusLabel,
  inferFacilityImpactTarget,
  isImpactWarning
} from "../lib/app-domain-status";

type ForestCardContentProps = {
  forest: ForestApiResponse["forests"][number];
  availableFacilities: FacilityDefinition[];
};

export const ForestCardContent = memo(({
  forest,
  availableFacilities
}: ForestCardContentProps) => {
  const forestClosureStatus = getForestClosureStatus(forest);
  const impactSummary = getForestImpactSummary(forest);
  const googleMapsDrivingNavigationUrl =
    buildGoogleMapsDrivingNavigationUrl(forest);

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
              <FontAwesomeIcon icon={faCar} fixedWidth />
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
            <span className={`status-pill ${getStatusClassName(forest.banStatus)}`}>
              {getSolidFuelStatusLabel(forest.banStatus)}
            </span>
            <a
              href={buildTotalFireBanDetailsUrl(forest)}
              target="_blank"
              rel="noreferrer"
              className={`status-pill ${getStatusClassName(forest.totalFireBanStatus)}`}
            >
              {getTotalFireBanStatusLabel(forest.totalFireBanStatus)}
            </a>
            {forestClosureStatus !== "NONE" ? (
              <span
                className={`status-pill ${forestClosureStatus === "CLOSED" ? "banned" : "unknown"}`}
              >
                {getClosureStatusLabel(forestClosureStatus)}
              </span>
            ) : null}
          </div>
          <small className="muted" data-testid="distance-text">
            {forest.distanceKm !== null
              ? formatDriveSummary(
                  forest.distanceKm,
                  forest.travelDurationMinutes
                )
              : "Drive distance unavailable"}
          </small>
        </div>
      </div>
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
              <Tippy
                key={`${forest.id}:${facility.key}`}
                content={`${facility.label}: ${statusText}`}
                delay={[0, 0]}
                duration={[0, 0]}
                placement="top"
              >
                <span
                  className={`facility-indicator ${stateClass}`}
                  data-facility-key={facility.key}
                  data-warning={hasWarning ? "true" : "false"}
                >
                  <FacilityIcon facility={facility} />
                </span>
              </Tippy>
            );
          })}
        </div>
      ) : null}
    </>
  );
});

ForestCardContent.displayName = "ForestCardContent";