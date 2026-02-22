import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ForestCardContent } from "./ForestCardContent";
import type { ForestApiResponse, FacilityDefinition } from "../lib/api";
import {
  sortForestsByDistance
} from "../lib/app-domain-forest";

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
  return (
    <li
      className="forest-row"
      data-testid="forest-row"
      data-index={rowIndex}
      style={listItemStyle}
      ref={listItemReference}
    >
      <ForestCardContent forest={forest} availableFacilities={availableFacilities} />
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
