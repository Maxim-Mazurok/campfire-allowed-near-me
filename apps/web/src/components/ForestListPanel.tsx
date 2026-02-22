import { useVirtualizer } from "@tanstack/react-virtual";
import Tippy from "@tippyjs/react";
import { memo, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { FacilityIcon } from "./FacilityIcon";
import type { ForestApiResponse, FacilityDefinition } from "../lib/api";
import {
  buildTextHighlightUrl,
  buildTotalFireBanDetailsUrl,
  formatDriveSummary,
  isHttpUrl,
  sortForestsByDistance
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

export type ForestListPanelProps = {
  matchingForests: ForestApiResponse["forests"];
  availableFacilities: FacilityDefinition[];
  payload: ForestApiResponse | null;
};

const FOREST_LIST_VIRTUALIZATION_THRESHOLD = 120;
const FOREST_LIST_ESTIMATED_ITEM_HEIGHT_PIXELS = 112;
const FOREST_LIST_GAP_PIXELS = 8;
const FOREST_LIST_OVERSCAN_ITEM_COUNT = 8;

const ForestListItem = memo(({
  forest,
  availableFacilities,
  listItemStyle,
  rowIndex,
  listItemReference
}: {
  forest: ForestApiResponse["forests"][number];
  availableFacilities: FacilityDefinition[];
  listItemStyle?: CSSProperties;
  rowIndex?: number;
  listItemReference?: (element: HTMLLIElement | null) => void;
}) => {
  const forestClosureStatus = getForestClosureStatus(forest);
  const impactSummary = getForestImpactSummary(forest);

  return (
    <li
      className="forest-row"
      data-testid="forest-row"
      data-index={rowIndex}
      style={listItemStyle}
      ref={listItemReference}
    >
      <div className="forest-main-row">
        <div className="forest-title-block">
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
    </li>
  );
});

ForestListItem.displayName = "ForestListItem";

const StandardForestList = memo(({
  sortedMatchingForests,
  availableFacilities
}: {
  sortedMatchingForests: ForestApiResponse["forests"];
  availableFacilities: FacilityDefinition[];
}) => {
  return (
    <ul className="forest-list" data-testid="forest-list">
      {sortedMatchingForests.map((forest) => (
        <ForestListItem
          key={forest.id}
          forest={forest}
          availableFacilities={availableFacilities}
        />
      ))}
    </ul>
  );
});

StandardForestList.displayName = "StandardForestList";

const VirtualizedForestList = memo(({
  sortedMatchingForests,
  availableFacilities
}: {
  sortedMatchingForests: ForestApiResponse["forests"];
  availableFacilities: FacilityDefinition[];
}) => {
  const forestListScrollContainerReference = useRef<HTMLDivElement | null>(null);

  const forestListVirtualizer = useVirtualizer({
    count: sortedMatchingForests.length,
    getScrollElement: () => forestListScrollContainerReference.current,
    estimateSize: () => FOREST_LIST_ESTIMATED_ITEM_HEIGHT_PIXELS + FOREST_LIST_GAP_PIXELS,
    overscan: FOREST_LIST_OVERSCAN_ITEM_COUNT,
    measureElement: (element) => {
      if (!element) {
        return FOREST_LIST_ESTIMATED_ITEM_HEIGHT_PIXELS + FOREST_LIST_GAP_PIXELS;
      }

      return (element as HTMLElement).offsetHeight + FOREST_LIST_GAP_PIXELS;
    }
  });

  const virtualForestRows = forestListVirtualizer.getVirtualItems();
  const totalVirtualForestListHeight = forestListVirtualizer.getTotalSize();

  return (
    <div
      ref={forestListScrollContainerReference}
      className="forest-list-scroll"
      data-testid="forest-list-scroll"
    >
      <ul
        className="forest-list forest-list-virtual"
        data-testid="forest-list"
        style={{ height: `${totalVirtualForestListHeight}px` }}
      >
        {virtualForestRows.map((virtualForestRow) => {
          const forest = sortedMatchingForests[virtualForestRow.index];
          if (!forest) {
            return null;
          }

          return (
            <ForestListItem
              key={virtualForestRow.key}
              forest={forest}
              availableFacilities={availableFacilities}
              rowIndex={virtualForestRow.index}
              listItemReference={forestListVirtualizer.measureElement}
              listItemStyle={{
                left: 0,
                position: "absolute",
                top: 0,
                transform: `translateY(${virtualForestRow.start}px)`,
                width: "100%"
              }}
            />
          );
        })}
      </ul>
    </div>
  );
});

VirtualizedForestList.displayName = "VirtualizedForestList";

export const ForestListPanel = memo(({
  matchingForests,
  availableFacilities,
  payload
}: ForestListPanelProps) => {
  const [forestSearchText, setForestSearchText] = useState("");
  const sortedMatchingForests = useMemo(() => {
    if (matchingForests.length <= 1) {
      return matchingForests;
    }

    return [...matchingForests].sort(sortForestsByDistance);
  }, [matchingForests]);

  const normalizedForestSearchText = forestSearchText.trim().toLowerCase();
  const filteredMatchingForests = useMemo(() => {
    if (!normalizedForestSearchText) {
      return sortedMatchingForests;
    }

    return sortedMatchingForests.filter((forest) =>
      forest.forestName.toLowerCase().includes(normalizedForestSearchText)
    );
  }, [normalizedForestSearchText, sortedMatchingForests]);

  const shouldUseVirtualizedForestList =
    filteredMatchingForests.length >= FOREST_LIST_VIRTUALIZATION_THRESHOLD;

  return (
    <aside className="panel list-panel">
      <h2>Forests ({filteredMatchingForests.length})</h2>
      <p className="meta">
        Last fetched: {payload ? new Date(payload.fetchedAt).toLocaleString() : "-"}
        {payload?.stale ? " (stale cache)" : ""}
      </p>

      <label className="forest-search-label" htmlFor="forest-search-input">
        Search forests
      </label>
      <input
        id="forest-search-input"
        data-testid="forest-search-input"
        type="search"
        className="forest-search-input"
        value={forestSearchText}
        onChange={(event) => {
          setForestSearchText(event.target.value);
        }}
        placeholder="Filter by forest name"
      />

      {shouldUseVirtualizedForestList ? (
        <VirtualizedForestList
          sortedMatchingForests={filteredMatchingForests}
          availableFacilities={availableFacilities}
        />
      ) : (
        <StandardForestList
          sortedMatchingForests={filteredMatchingForests}
          availableFacilities={availableFacilities}
        />
      )}
    </aside>
  );
});

ForestListPanel.displayName = "ForestListPanel";
