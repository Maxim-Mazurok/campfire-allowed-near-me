import { IconCar, IconMapPinOff } from "@tabler/icons-react";
import { Badge, Tooltip } from "@mantine/core";
import { memo, useCallback, useMemo, useRef } from "react";
import { FacilityIcon } from "./FacilityIcon";
import { InfoTooltip } from "./InfoTooltip";
import type { FacilityDefinition, ForestApiResponse } from "../lib/api";
import { getForestBanStatus, getForestBanScope, getForestBanStatusText } from "../lib/api";
import {
  buildGoogleMapsDrivingNavigationUrl,
  buildSolidFuelBanDetailsUrl,
  buildTextHighlightUrl,
  buildTotalFireBanDetailsUrl,
  forestHasCoordinates,
  forestHasDrivingRoute,
  formatDirectDistanceSummary,
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
  const hasDrivingRoute = hasCoordinates && forestHasDrivingRoute(forest);
  const driveMetricTooltipLabel = hasCoordinates
    ? `Google Maps driving estimate (Sat 10am, tolls: ${avoidTolls ? "avoid" : "allow"}).`
    : locationNotFoundTooltipLabel;
  const straightLineTooltipLabel =
    "Straight-line distance — driving route not calculated for this forest. " +
    "Routes are only estimated for the closest forests to limit Google Maps API costs.";

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
              <>
                <span
                  className="forest-navigation-link forest-navigation-link--disabled"
                  aria-label={`Location not found for ${forest.forestName}`}
                  data-testid="forest-navigation-link-disabled"
                >
                  <IconMapPinOff size={14} stroke={1.5} />
                </span>
                <InfoTooltip label={locationNotFoundTooltipLabel} width={250} iconSize={12} />
              </>
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
            {forest.state && forest.state !== "NSW" && (
              <Badge
                size="xs"
                variant="outline"
                color="blue"
                radius="sm"
                style={{ marginLeft: 4, flexShrink: 0, verticalAlign: "middle" }}
                title={`State: ${forest.state}`}
              >
                {forest.state}
              </Badge>
            )}
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
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
            <InfoTooltip label={solidFuelBadgeTooltip} width={300} iconSize={12} />
          </span>
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
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
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
            <InfoTooltip label={totalFireBanTooltip} width={300} iconSize={12} />
          </span>
        </div>

        {closureBadgeLabel ? (
          <div className="forest-header-line forest-header-line--end">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
              {closureBadgeTooltip ? (
                <InfoTooltip label={closureBadgeTooltip} width={300} iconSize={12} />
              ) : null}
            </span>
          </div>
        ) : null}

        {hasDrivingRoute ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <small className="muted forest-distance-text" data-testid="distance-text">
              {formatDriveSummary(forest.distanceKm, forest.travelDurationMinutes)}
            </small>
            <InfoTooltip label={driveMetricTooltipLabel} width={250} iconSize={12} />
          </span>
        ) : hasCoordinates && forest.directDistanceKm !== null ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <small className="muted forest-distance-text" data-testid="distance-text">
              {formatDirectDistanceSummary(forest.directDistanceKm)}
            </small>
            <InfoTooltip label={straightLineTooltipLabel} width={300} iconSize={12} />
          </span>
        ) : !hasCoordinates ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <small className="muted forest-location-warning forest-distance-text" data-testid="distance-text">
              Location not found
            </small>
            <InfoTooltip label={locationNotFoundTooltipLabel} width={250} iconSize={12} />
          </span>
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
                events={{ hover: true, focus: true, touch: true }}
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