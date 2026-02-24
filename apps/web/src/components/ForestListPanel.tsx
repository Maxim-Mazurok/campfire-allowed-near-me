import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { NativeSelect, Text, TextInput, Title } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { ForestCardContent } from "./ForestCardContent";
import type { ForestApiResponse, FacilityDefinition } from "../lib/api";
import {
  compareForestsByListSortOption
} from "../lib/app-domain-forest";
import type { ForestListSortOption } from "../lib/app-domain-types";

export type ForestListPanelProps = {
  matchingForests: ForestApiResponse["forests"];
  availableFacilities: FacilityDefinition[];
  payload: ForestApiResponse | null;
  avoidTolls: boolean;
  hoveredForestId: string | null;
  onHoveredForestIdChange: (hoveredForestId: string | null) => void;
  hoveredAreaName: string | null;
  onHoveredAreaNameChange: (hoveredAreaName: string | null) => void;
  forestListSortOption: ForestListSortOption;
  onForestListSortOptionChange: (option: ForestListSortOption) => void;
};

const FOREST_LIST_VIRTUALIZATION_THRESHOLD = 120;
const FOREST_LIST_ESTIMATED_ITEM_HEIGHT_PIXELS = 112;
const FOREST_LIST_GAP_PIXELS = 8;
const FOREST_LIST_OVERSCAN_ITEM_COUNT = 8;

const ForestListItem = memo(({
  forest,
  availableFacilities,
  avoidTolls,
  hoveredForestId,
  onHoveredForestIdChange,
  onHoveredAreaNameChange,
  listItemStyle,
  rowIndex,
  listItemReference
}: {
  forest: ForestApiResponse["forests"][number];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  hoveredForestId: string | null;
  onHoveredForestIdChange: (hoveredForestId: string | null) => void;
  onHoveredAreaNameChange: (hoveredAreaName: string | null) => void;
  listItemStyle?: CSSProperties;
  rowIndex?: number;
  listItemReference?: (element: HTMLLIElement | null) => void;
}) => {
  const isHoveredForest = forest.id === hoveredForestId;

  return (
    <li
      className="forest-row"
      data-testid="forest-row"
      data-hovered={isHoveredForest ? "true" : undefined}
      data-index={rowIndex}
      style={listItemStyle}
      ref={listItemReference}
      onMouseEnter={() => {
        onHoveredForestIdChange(forest.id);
      }}
      onMouseLeave={() => {
        onHoveredForestIdChange(null);
      }}
    >
      <ForestCardContent
        forest={forest}
        availableFacilities={availableFacilities}
        avoidTolls={avoidTolls}
        onHoveredAreaNameChange={onHoveredAreaNameChange}
      />
    </li>
  );
});

ForestListItem.displayName = "ForestListItem";

const StandardForestList = memo(({
  sortedMatchingForests,
  availableFacilities,
  avoidTolls,
  hoveredForestId,
  onHoveredForestIdChange,
  onHoveredAreaNameChange
}: {
  sortedMatchingForests: ForestApiResponse["forests"];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  hoveredForestId: string | null;
  onHoveredForestIdChange: (hoveredForestId: string | null) => void;
  onHoveredAreaNameChange: (hoveredAreaName: string | null) => void;
}) => {
  return (
    <ul className="forest-list" data-testid="forest-list">
      {sortedMatchingForests.map((forest) => (
        <ForestListItem
          key={forest.id}
          forest={forest}
          availableFacilities={availableFacilities}
          avoidTolls={avoidTolls}
          hoveredForestId={hoveredForestId}
          onHoveredForestIdChange={onHoveredForestIdChange}
          onHoveredAreaNameChange={onHoveredAreaNameChange}
        />
      ))}
    </ul>
  );
});

StandardForestList.displayName = "StandardForestList";

const VirtualizedForestList = memo(({
  sortedMatchingForests,
  availableFacilities,
  avoidTolls,
  hoveredForestId,
  onHoveredForestIdChange,
  onHoveredAreaNameChange
}: {
  sortedMatchingForests: ForestApiResponse["forests"];
  availableFacilities: FacilityDefinition[];
  avoidTolls: boolean;
  hoveredForestId: string | null;
  onHoveredForestIdChange: (hoveredForestId: string | null) => void;
  onHoveredAreaNameChange: (hoveredAreaName: string | null) => void;
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
              avoidTolls={avoidTolls}
              hoveredForestId={hoveredForestId}
              onHoveredForestIdChange={onHoveredForestIdChange}
              onHoveredAreaNameChange={onHoveredAreaNameChange}
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
  payload,
  avoidTolls,
  hoveredForestId,
  onHoveredForestIdChange,
  hoveredAreaName,
  onHoveredAreaNameChange,
  forestListSortOption,
  onForestListSortOptionChange
}: ForestListPanelProps) => {
  const [forestSearchText, setForestSearchText] = useState("");
  const sortedMatchingForests = useMemo(() => {
    if (matchingForests.length <= 1) {
      return matchingForests;
    }

    return [...matchingForests].sort((leftForest, rightForest) =>
      compareForestsByListSortOption(leftForest, rightForest, forestListSortOption)
    );
  }, [forestListSortOption, matchingForests]);

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

  useEffect(() => {
    if (!hoveredForestId) {
      return;
    }

    const hoveredForestStillVisible = filteredMatchingForests.some(
      (forest) => forest.id === hoveredForestId
    );

    if (!hoveredForestStillVisible) {
      onHoveredForestIdChange(null);
    }
  }, [filteredMatchingForests, hoveredForestId, onHoveredForestIdChange]);

  return (
    <aside className="panel list-panel">
      <Title order={2} size="h4">Forests ({filteredMatchingForests.length})</Title>
      <Text size="sm" c="dimmed" mt={4} mb={8}>
        Last fetched: {payload ? new Date(payload.fetchedAt).toLocaleString() : "-"}
        {payload?.stale ? " (stale cache)" : ""}
      </Text>

      <TextInput
        data-testid="forest-search-input"
        placeholder="Filter by forest name"
        aria-label="Filter by forest name"
        leftSection={<IconSearch size={16} />}
        size="sm"
        mb={8}
        value={forestSearchText}
        onChange={(event) => {
          setForestSearchText(event.currentTarget.value);
        }}
      />

      <NativeSelect
        data-testid="forest-sort-select"
        aria-label="Sort forests by"
        size="sm"
        mb={8}
        value={forestListSortOption}
        onChange={(event) => {
          onForestListSortOptionChange(event.currentTarget.value as ForestListSortOption);
        }}
        data={[
          { label: "Driving distance (low to high)", value: "DRIVING_DISTANCE_ASC" },
          { label: "Driving distance (high to low)", value: "DRIVING_DISTANCE_DESC" },
          { label: "Driving time (short to long)", value: "DRIVING_TIME_ASC" },
          { label: "Driving time (long to short)", value: "DRIVING_TIME_DESC" },
        ]}
      />

      {shouldUseVirtualizedForestList ? (
        <VirtualizedForestList
          sortedMatchingForests={filteredMatchingForests}
          availableFacilities={availableFacilities}
          avoidTolls={avoidTolls}
          hoveredForestId={hoveredForestId}
          onHoveredForestIdChange={onHoveredForestIdChange}
          onHoveredAreaNameChange={onHoveredAreaNameChange}
        />
      ) : (
        <StandardForestList
          sortedMatchingForests={filteredMatchingForests}
          availableFacilities={availableFacilities}
          avoidTolls={avoidTolls}
          hoveredForestId={hoveredForestId}
          onHoveredForestIdChange={onHoveredForestIdChange}
          onHoveredAreaNameChange={onHoveredAreaNameChange}
        />
      )}
    </aside>
  );
});

ForestListPanel.displayName = "ForestListPanel";
