import { IconCar, IconMapPinOff } from "@tabler/icons-react";
import { Badge, Tooltip } from "@mantine/core";
import { memo, useCallback, useMemo, useRef } from "react";
import { FacilityIcon } from "./FacilityIcon";
import type { FacilityDefinition, ForestApiResponse } from "../lib/api";
import {
  buildGoogleMapsDrivingNavigationUrl,
  buildSolidFuelBanDetailsUrl,
  buildTextHighlightUrl,
  buildTotalFireBanDetailsUrl,
  forestHasCoordinates,
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

function shortenForestName(fullName: string): string {
  return fullName.replace(/\s+state\s+forests?$/i, "").trim();
}

type ForestCardContentProps = {
  forest: ForestApiResponse["forests"][number];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  onHoveredAreaNameChange?: (hoveredAreaName: string | null) => void;
};

export const ForestCardContent = memo(({
  forest,
  availableFacilities,
  avoidTolls,
  onHoveredAreaNameChange
}: ForestCardContentProps) => {
  const areaCleanupReference = useRef<(() => void) | null>(null);

  /**
   * Callback ref: fires immediately when the element is committed to the DOM,
   * regardless of portal nesting depth or shadow DOM boundaries.
   * Unlike useEffect (which depends on render cycle ordering), this guarantees
   * listeners are attached the instant the element exists.
   */
  const areaHoverReference = useCallback((element: HTMLElement | null) => {
    // Clean up previous listeners if any
    if (areaCleanupReference.current) {
      areaCleanupReference.current();
      areaCleanupReference.current = null;
    }

    if (!element || !onHoveredAreaNameChange) {
      return;
    }

    const handleMouseEnter = () => onHoveredAreaNameChange(forest.areaName);
    const handleMouseLeave = () => onHoveredAreaNameChange(null);

    element.addEventListener("mouseenter", handleMouseEnter);
    element.addEventListener("mouseleave", handleMouseLeave);

    areaCleanupReference.current = () => {
      element.removeEventListener("mouseenter", handleMouseEnter);
      element.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [onHoveredAreaNameChange, forest.areaName]);

  const forestClosureStatus = getForestClosureStatus(forest);
  const impactSummary = getForestImpactSummary(forest);
  const hasCoordinates = forestHasCoordinates(forest);
  const googleMapsDrivingNavigationUrl = hasCoordinates
    ? buildGoogleMapsDrivingNavigationUrl(forest)
    : null;
  const closureNotices = forest.closureNotices ?? [];
  const cleanNoticeTitle = useMemo(
    () => {
      const colonPrefix = `${forest.forestName}: `;
      const spacePrefix = `${forest.forestName} `;
      return (title: string) => {
        let cleaned = title;
        if (cleaned.startsWith(colonPrefix)) cleaned = cleaned.slice(colonPrefix.length);
        else if (cleaned.startsWith(spacePrefix)) cleaned = cleaned.slice(spacePrefix.length);
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      };
    },
    [forest.forestName]
  );

  const closureBadgeLabel = (forestClosureStatus === "CLOSED" || forestClosureStatus === "PARTIAL")
    ? getClosureStatusLabel(forestClosureStatus)
    : null;

  const primaryClosureNotice = closureBadgeLabel
    ? closureNotices.find((notice) => notice.status === forestClosureStatus) ?? null
    : null;

  const closureBadgeUrl = primaryClosureNotice && isHttpUrl(primaryClosureNotice.detailUrl)
    ? primaryClosureNotice.detailUrl
    : null;

  const BADGE_REDUNDANT_LABELS = new Set(["closed", "partly closed", "partial closure"]);
  const visibleClosureNotices = closureNotices.filter((notice) => {
    const cleaned = cleanNoticeTitle(notice.title).toLowerCase();
    return !BADGE_REDUNDANT_LABELS.has(cleaned);
  });
  const locationNotFoundTooltipLabel = (
    <>
      Location not found — coordinates unavailable for this forest.
      <br /><br />
      Hover over the area name below the forest name to highlight other forests in the same area.
    </>
  );
  const driveMetricTooltipLabel = hasCoordinates
    ? `Google Maps estimate (Sat 10am, tolls: ${avoidTolls ? "avoid" : "allow"}) for realistic distance/time.`
    : locationNotFoundTooltipLabel;

  return (
    <>
      <div className="forest-main-row">
        <div className="forest-title-block">
          <div className="forest-title-row">
            {googleMapsDrivingNavigationUrl ? (
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
            ) : (
              <Tooltip label={locationNotFoundTooltipLabel} position="top" openDelay={0} closeDelay={0} multiline w={250}>
                <span
                  className="forest-navigation-link forest-navigation-link--disabled"
                  aria-label={`Location not found for ${forest.forestName}`}
                  data-testid="forest-navigation-link-disabled"
                >
                  <IconMapPinOff size={14} stroke={1.5} />
                </span>
              </Tooltip>
            )}
            <strong title={forest.forestName}>
              {isHttpUrl(forest.forestUrl) ? (
                <a
                  href={forest.forestUrl}
                  className="forest-name-link"
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortenForestName(forest.forestName)}
                </a>
              ) : (
                shortenForestName(forest.forestName)
              )}
            </strong>
          </div>
          {isHttpUrl(forest.areaUrl) ? (
            <a
              ref={areaHoverReference}
              href={buildTextHighlightUrl(forest.areaUrl, forest.forestName)}
              className="muted forest-region-link"
              target="_blank"
              rel="noreferrer"
              data-testid="forest-area-link"
              title={`Forest region (FCNSW management area): ${forest.areaName}`}
            >
              {forest.areaName}
            </a>
          ) : (
            <div
              ref={areaHoverReference}
              className="muted forest-region-link"
              data-testid="forest-area-link"
              title={`Forest region (FCNSW management area): ${forest.areaName}`}
            >
              {forest.areaName}
            </div>
          )}
        </div>
        <div className="status-block">
          <div className="status-pill-row">
            <Badge
              component="a"
              href={buildSolidFuelBanDetailsUrl(forest) ?? undefined}
              target="_blank"
              rel="noreferrer"
              color={forest.banStatus === "NOT_BANNED" ? "green" : forest.banStatus === "BANNED" ? "red" : "gray"}
              variant="light"
              size="sm"
              radius="xl"
              style={{ cursor: "pointer", textDecoration: "none" }}
            >
              {getSolidFuelStatusLabel(forest.banStatus)}
            </Badge>
            <Badge
              component="a"
              href={buildTotalFireBanDetailsUrl(forest)}
              target="_blank"
              rel="noreferrer"
              color={forest.totalFireBanStatus === "NOT_BANNED" ? "green" : forest.totalFireBanStatus === "BANNED" ? "red" : "gray"}
              variant="light"
              size="sm"
              radius="xl"
              style={{ cursor: "pointer", textDecoration: "none" }}
            >
              {getTotalFireBanStatusLabel(forest.totalFireBanStatus)}
            </Badge>
            {closureBadgeLabel ? (
              closureBadgeUrl ? (
                <Badge
                  component="a"
                  href={closureBadgeUrl}
                  target="_blank"
                  rel="noreferrer"
                  color={forestClosureStatus === "CLOSED" ? "red" : "orange"}
                  variant="light"
                  size="sm"
                  radius="xl"
                  style={{ cursor: "pointer", textDecoration: "none" }}
                  data-testid="closure-badge"
                >
                  {closureBadgeLabel}
                </Badge>
              ) : (
                <Badge
                  color={forestClosureStatus === "CLOSED" ? "red" : "orange"}
                  variant="light"
                  size="sm"
                  radius="xl"
                  data-testid="closure-badge"
                >
                  {closureBadgeLabel}
                </Badge>
              )
            ) : null}
          </div>
          <Tooltip label={driveMetricTooltipLabel} position="top" openDelay={0} closeDelay={0} multiline w={250}>
            <small className={hasCoordinates ? "muted" : "muted forest-location-warning"} data-testid="distance-text">
              {hasCoordinates
                ? (forest.distanceKm !== null
                    ? formatDriveSummary(
                        forest.distanceKm,
                        forest.travelDurationMinutes
                      )
                    : "Drive distance unavailable")
                : "Location not found"}
            </small>
          </Tooltip>
        </div>
      </div>
      {visibleClosureNotices.length > 0 ? (
        <div className="forest-notice-list-wrap" data-testid="forest-notice-list">
          <div className="forest-notice-list-label">Notices:</div>
          <ul className="forest-notice-list">
            {visibleClosureNotices.map((closureNotice) => (
              <li key={closureNotice.id} className="forest-notice-item">
                {isHttpUrl(closureNotice.detailUrl) ? (
                  <a
                    href={closureNotice.detailUrl}
                    className="forest-notice-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {cleanNoticeTitle(closureNotice.title)}
                  </a>
                ) : (
                  <span>{cleanNoticeTitle(closureNotice.title)}</span>
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