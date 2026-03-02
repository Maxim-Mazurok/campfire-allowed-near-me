import { IconCar, IconMapPinOff } from "@tabler/icons-react";
import { Badge, Tooltip } from "@mantine/core";
import { memo, useCallback, useMemo, useRef } from "react";
import { FacilityIcon } from "./FacilityIcon";
import type { FacilityDefinition, ForestApiResponse } from "../lib/api";
import { getForestBanStatus, getForestBanScope, getForestBanStatusText } from "../lib/api";
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
  const areaCleanupReferences = useRef<Map<string, () => void>>(new Map());

  const resolvedAreas = forest.areas;

  /**
   * Creates a callback ref for each area element. Fires immediately when the element
   * is committed to the DOM, regardless of portal nesting depth or shadow DOM boundaries.
   */
  const createAreaHoverReference = useCallback((areaName: string) => {
    return (element: HTMLElement | null) => {
      const existingCleanup = areaCleanupReferences.current.get(areaName);
      if (existingCleanup) {
        existingCleanup();
        areaCleanupReferences.current.delete(areaName);
      }

      if (!element || !onHoveredAreaNameChange) {
        return;
      }

      const handleMouseEnter = () => onHoveredAreaNameChange(areaName);
      const handleMouseLeave = () => onHoveredAreaNameChange(null);

      element.addEventListener("mouseenter", handleMouseEnter);
      element.addEventListener("mouseleave", handleMouseLeave);

      areaCleanupReferences.current.set(areaName, () => {
        element.removeEventListener("mouseenter", handleMouseEnter);
        element.removeEventListener("mouseleave", handleMouseLeave);
      });
    };
  }, [onHoveredAreaNameChange]);

  const forestClosureStatus = getForestClosureStatus(forest);
  const impactSummary = getForestImpactSummary(forest);
  const forestBanStatus = getForestBanStatus(forest.areas);
  const forestBanScope = getForestBanScope(forest.areas);
  const forestBanStatusText = getForestBanStatusText(forest.areas);
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

  const closureBadgeTooltip = primaryClosureNotice
    ? (primaryClosureNotice.detailText ?? primaryClosureNotice.title)
    : null;

  const BADGE_REDUNDANT_LABELS = new Set(["closed", "partly closed", "partially closed", "partial closure"]);
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

  const solidFuelBadgeTooltip = forestBanStatus === "NOT_BANNED"
    ? `No Solid Fuel Fire Ban from Forestry Corp NSW.${forestBanScope === "OUTSIDE_CAMPS" ? " (Outside camping areas only.)" : ""} Campfires are only legal when both this ban AND Total Fire Ban are absent.`
    : forestBanStatus === "BANNED"
      ? `Solid Fuel Fire Ban in effect from Forestry Corp NSW.${forestBanScope === "OUTSIDE_CAMPS" ? " Applies outside designated camping areas." : forestBanScope === "INCLUDING_CAMPS" ? " Applies including within designated camping areas." : ""} All campfires prohibited regardless of Total Fire Ban status.`
      : "No data available from Forestry Corp NSW for this forest.";

  const totalFireBanTooltip = forest.totalFireBanStatus === "NOT_BANNED"
    ? "No Total Fire Ban from NSW RFS for this area. Campfires are only legal when both this ban AND the Solid Fuel Fire Ban are absent."
    : forest.totalFireBanStatus === "BANNED"
      ? "Total Fire Ban declared by NSW RFS — all outdoor fires are banned, including gas BBQs. This applies regardless of Solid Fuel Fire Ban status."
      : "No data available from NSW RFS for this area.";

  return (
    <>
      <div className="forest-header-rows">
        <div className="forest-header-line">
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
          <Tooltip label={solidFuelBadgeTooltip} withArrow multiline w={300} position="top">
            <Badge
              component="a"
              href={buildSolidFuelBanDetailsUrl(forest) ?? undefined}
              target="_blank"
              rel="noreferrer"
              color={forestBanStatus === "NOT_BANNED" ? "green" : forestBanStatus === "BANNED" && forestBanScope === "OUTSIDE_CAMPS" ? "yellow" : forestBanStatus === "BANNED" ? "red" : "gray"}
              variant="light"
              size="sm"
              radius="xl"
              style={{ cursor: "pointer", textDecoration: "none", flexShrink: 0 }}
            >
              {getSolidFuelStatusLabel(forestBanStatus, forestBanScope)}
            </Badge>
          </Tooltip>
        </div>

        <div className="forest-header-line">
          <div className="forest-area-block">
            {resolvedAreas.map((area) => (
              isHttpUrl(area.areaUrl) ? (
                <a
                  key={area.areaName}
                  ref={createAreaHoverReference(area.areaName)}
                  href={buildTextHighlightUrl(area.areaUrl, forest.forestName)}
                  className="muted forest-region-link"
                  target="_blank"
                  rel="noreferrer"
                  data-testid="forest-area-link"
                  title={`Forest region (FCNSW management area): ${area.areaName}`}
                >
                  {area.areaName}
                </a>
              ) : (
                <div
                  key={area.areaName}
                  ref={createAreaHoverReference(area.areaName)}
                  className="muted forest-region-link"
                  data-testid="forest-area-link"
                  title={`Forest region (FCNSW management area): ${area.areaName}`}
                >
                  {area.areaName}
                </div>
              )
            ))}
          </div>
          <Tooltip label={totalFireBanTooltip} withArrow multiline w={300} position="top">
            <Badge
              component="a"
              href={buildTotalFireBanDetailsUrl(forest)}
              target="_blank"
              rel="noreferrer"
              color={forest.totalFireBanStatus === "NOT_BANNED" ? "green" : forest.totalFireBanStatus === "BANNED" ? "red" : "gray"}
              variant="light"
              size="sm"
              radius="xl"
              style={{ cursor: "pointer", textDecoration: "none", flexShrink: 0 }}
            >
              {getTotalFireBanStatusLabel(forest.totalFireBanStatus)}
            </Badge>
          </Tooltip>
        </div>

        {closureBadgeLabel ? (
          <div className="forest-header-line forest-header-line--end">
            <Tooltip
              label={closureBadgeTooltip}
              disabled={!closureBadgeTooltip}
              position="top"
              openDelay={0}
              closeDelay={0}
              multiline
              w={300}
              styles={{ tooltip: { whiteSpace: "pre-line" } }}
            >
              {closureBadgeUrl ? (
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
              )}
            </Tooltip>
          </div>
        ) : null}

        {hasCoordinates && forest.distanceKm !== null ? (
          <Tooltip label={driveMetricTooltipLabel} position="top" openDelay={0} closeDelay={0} multiline w={250}>
            <small className="muted forest-distance-text" data-testid="distance-text">
              {formatDriveSummary(forest.distanceKm, forest.travelDurationMinutes)}
            </small>
          </Tooltip>
        ) : !hasCoordinates ? (
          <Tooltip label={locationNotFoundTooltipLabel} position="top" openDelay={0} closeDelay={0} multiline w={250}>
            <small className="muted forest-location-warning forest-distance-text" data-testid="distance-text">
              Location not found
            </small>
          </Tooltip>
        ) : null}
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