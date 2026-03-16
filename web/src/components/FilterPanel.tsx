import type { Dispatch, SetStateAction } from "react";
import { Anchor, Chip, Divider, Group, ScrollArea, SegmentedControl, Stack, Text, Title, Tooltip } from "@mantine/core";
import { InfoTooltip } from "./InfoTooltip";
import { FacilityIcon } from "./FacilityIcon";
import { TriStateToggle } from "./TriStateToggle";
import type { ClosureTagDefinition, FacilityDefinition } from "../lib/api";
import {
  type BanFilterMode,
  type BanScopeFilterMode,
  type ClosureStatusFilterMode,
  type TriStateMode
} from "../lib/app-domain-types";
import {
  CLOSURES_SOURCE_URL,
  FACILITIES_SOURCE_URL,
  SOLID_FUEL_FIRE_BAN_SOURCE_URL,
  TOTAL_FIRE_BAN_RULES_URL,
  TOTAL_FIRE_BAN_SOURCE_URL
} from "../lib/app-domain-constants";
import type { AustralianState } from "../../../shared/contracts.js";

export const ALL_STATES: AustralianState[] = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];

export type FilterPreset = "LEGAL_CAMPFIRE" | "LEGAL_CAMPFIRE_CAMPING";

export type FilterPanelProps = {
  stateFilter: AustralianState[];
  setStateFilter: Dispatch<SetStateAction<AustralianState[]>>;
  solidFuelBanFilterMode: BanFilterMode;
  setSolidFuelBanFilterMode: Dispatch<SetStateAction<BanFilterMode>>;
  solidFuelBanScopeFilterMode: BanScopeFilterMode;
  setSolidFuelBanScopeFilterMode: Dispatch<SetStateAction<BanScopeFilterMode>>;
  totalFireBanFilterMode: BanFilterMode;
  setTotalFireBanFilterMode: Dispatch<SetStateAction<BanFilterMode>>;
  closureStatusFilterMode: ClosureStatusFilterMode;
  setClosureStatusFilterMode: Dispatch<SetStateAction<ClosureStatusFilterMode>>;
  hasNoticesFilterMode: TriStateMode;
  setHasNoticesFilterMode: Dispatch<SetStateAction<TriStateMode>>;
  availableClosureTags: ClosureTagDefinition[];
  closureTagFilterModes: Record<string, TriStateMode>;
  clearClosureTagModes: () => void;
  toggleClosureTagMode: (key: string, mode: Exclude<TriStateMode, "ANY">) => void;
  setSingleClosureTagMode: (key: string, mode: TriStateMode) => void;
  impactCampingFilterMode: TriStateMode;
  setImpactCampingFilterMode: Dispatch<SetStateAction<TriStateMode>>;
  impactAccess2wdFilterMode: TriStateMode;
  setImpactAccess2wdFilterMode: Dispatch<SetStateAction<TriStateMode>>;
  impactAccess4wdFilterMode: TriStateMode;
  setImpactAccess4wdFilterMode: Dispatch<SetStateAction<TriStateMode>>;
  availableFacilities: FacilityDefinition[];
  facilityFilterModes: Record<string, TriStateMode>;
  clearFacilityModes: () => void;
  toggleFacilityMode: (key: string, mode: Exclude<TriStateMode, "ANY">) => void;
  setSingleFacilityMode: (key: string, mode: TriStateMode) => void;
};

export const FilterPanel = ({
  stateFilter,
  setStateFilter,
  solidFuelBanFilterMode,
  setSolidFuelBanFilterMode,
  solidFuelBanScopeFilterMode,
  setSolidFuelBanScopeFilterMode,
  totalFireBanFilterMode,
  setTotalFireBanFilterMode,
  closureStatusFilterMode,
  setClosureStatusFilterMode,
  hasNoticesFilterMode,
  setHasNoticesFilterMode,
  availableClosureTags,
  closureTagFilterModes,
  clearClosureTagModes,
  toggleClosureTagMode,
  setSingleClosureTagMode,
  impactCampingFilterMode,
  setImpactCampingFilterMode,
  impactAccess2wdFilterMode,
  setImpactAccess2wdFilterMode,
  impactAccess4wdFilterMode,
  setImpactAccess4wdFilterMode,
  availableFacilities,
  facilityFilterModes,
  clearFacilityModes,
  toggleFacilityMode,
  setSingleFacilityMode
}: FilterPanelProps) => {
  const showBanScopeSubFilter =
    solidFuelBanFilterMode === "NOT_BANNED" || solidFuelBanFilterMode === "BANNED";

  const showCampingOpenFilter = closureStatusFilterMode === "PARTIAL";



  const shortenFacilityLabel = (label: string): string =>
    label.replace(/^Designated\s+/i, "").replace(/\s+Available$/i, "");

  const capitalizeFacilityLabel = (label: string): string =>
    shortenFacilityLabel(label).replace(/\b\w/g, (character) => character.toUpperCase());

  const closureTagTooltips: Record<string, string> = {
    ROAD_ACCESS: "Forest has notices about road or trail access restrictions — may affect driving in.",
    CAMPING: "Forest has notices affecting camping areas — sites may be closed or restricted.",
    EVENT: "Forest is closed or restricted due to a planned event (e.g. forestry operations, organised event).",
    OPERATIONS: "Forest has operational or safety-related restrictions (e.g. hazard reduction, timber harvesting)."
  };

  return (
    <aside className="panel filter-panel">
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <Stack gap="md">
          <div>
            <Group gap={4} mb={8}>
              <Title order={3} size="sm">State / Territory</Title>
              <InfoTooltip label="Filter campgrounds by Australian state or territory. Deselecting all states shows nothing — keep at least one selected." position="right" />
            </Group>
            <Chip.Group
              multiple
              value={stateFilter}
              onChange={(values) => setStateFilter(values as AustralianState[])}
            >
              <Group gap={4} wrap="wrap">
                {ALL_STATES.map((s) => (
                  <Chip key={s} value={s} size="xs" variant="outline">
                    {s}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </div>
          <Divider />
          <div>
            <Group gap={4} mb={8}>
              <Title order={3} size="sm">
                <Anchor href={SOLID_FUEL_FIRE_BAN_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                  Solid Fuel Fire Ban
                </Anchor>
              </Title>
              <InfoTooltip label="Forestry Corp NSW seasonal ban on solid fuel fires (wood, charcoal) in state forests. 'Solid fuel' means any fire that burns wood, charcoal, or similar material — i.e. a campfire. Checked daily." position="right" />
            </Group>
            <SegmentedControl
              aria-label="Solid fuel fire ban filter"
              fullWidth
              size="xs"
              value={solidFuelBanFilterMode}
              onChange={(value) => setSolidFuelBanFilterMode(value as BanFilterMode)}
              data={[
                { label: "All", value: "ALL" },
                { label: "Not banned", value: "NOT_BANNED" },
                { label: "Banned", value: "BANNED" },
                { label: "Unknown", value: "UNKNOWN" },
              ]}
            />
            {showBanScopeSubFilter ? (
              <>
                <Group gap={4} mt={6} mb={4}>
                  <Text size="xs" c="dimmed">Where?</Text>
                  <InfoTooltip label="'Anywhere' = the ban/allow applies everywhere in the forest. 'Camps' = only within designated camping areas. 'Not camps' = outside camping areas only." position="right" />
                </Group>
                <SegmentedControl
                  aria-label="Solid fuel ban scope filter"
                  fullWidth
                  size="xs"
                  value={solidFuelBanScopeFilterMode}
                  onChange={(value) => setSolidFuelBanScopeFilterMode(value as BanScopeFilterMode)}
                  data={[
                    { label: "Anywhere", value: "ANYWHERE" },
                    { label: "Camps", value: "CAMPS" },
                    { label: "Not camps", value: "NOT_CAMPS" },
                  ]}
                />
              </>
            ) : null}
          </div>

          <Divider />
          <div>
            <Group gap={4} mb={4}>
              <Title order={3} size="sm">
                <Anchor href={TOTAL_FIRE_BAN_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                  Total Fire Ban
                </Anchor>
              </Title>
              <InfoTooltip label="NSW RFS Total Fire Ban — declared when weather conditions are extreme. Bans ALL outdoor fires including gas/electric BBQs in some cases. This is separate from the solid fuel ban." position="right" />
            </Group>
            <Text size="xs" c="dimmed" mb={8}>
              <Anchor href={TOTAL_FIRE_BAN_RULES_URL} target="_blank" rel="noreferrer" size="xs">
                Rules
              </Anchor>{" "}
              apply to all outdoor fire use during a declared Total Fire Ban.
            </Text>
            <SegmentedControl
              aria-label="Total fire ban filter"
              fullWidth
              size="xs"
              value={totalFireBanFilterMode}
              onChange={(value) => setTotalFireBanFilterMode(value as BanFilterMode)}
              data={[
                { label: "All", value: "ALL" },
                { label: "No ban", value: "NOT_BANNED" },
                { label: "Banned", value: "BANNED" },
                { label: "Unknown", value: "UNKNOWN" },
              ]}
            />
          </div>

          <Divider />
          <div>
            <Group gap={4} mb={8}>
              <Title order={3} size="sm">
                <Anchor href={CLOSURES_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                  Closures & Notices
                </Anchor>
              </Title>
              <InfoTooltip label="FCNSW forest closures and notices — road closures, event closures, camping restrictions, etc. A forest can be fully open, partly closed, or fully closed." position="right" />
            </Group>
            <SegmentedControl
              aria-label="Closure status filter"
              fullWidth
              size="xs"
              value={closureStatusFilterMode}
              onChange={(value) => setClosureStatusFilterMode(value as ClosureStatusFilterMode)}
              data={[
                { label: "All", value: "ALL" },
                { label: "Open", value: "OPEN" },
                { label: "Partly closed", value: "PARTIAL" },
                { label: "Closed", value: "CLOSED" },
              ]}
            />
            <Stack gap={7} mt={10}>
              <Group justify="space-between" gap="xs">
                <Group gap={4}>
                  <Text size="xs">Has notices</Text>
                  <InfoTooltip label="Filter forests that have active closure notices (road blocks, restrictions, events, etc.)." position="right" />
                </Group>
                <TriStateToggle
                  mode={hasNoticesFilterMode}
                  onToggle={(targetMode) =>
                    setHasNoticesFilterMode((current) =>
                      current === targetMode ? "ANY" : targetMode
                    )
                  }
                  onReset={() => setHasNoticesFilterMode("ANY")}
                  label="Has notices"
                  includeTestId="has-notices-filter-include"
                  excludeTestId="has-notices-filter-exclude"
                  anyTestId="has-notices-filter-any"
                />
              </Group>
              {showCampingOpenFilter ? (
                <Group justify="space-between" gap="xs">
                  <Group gap={4}>
                    <Text size="xs">Camping open</Text>
                    <InfoTooltip label="Filter partly-closed forests by whether their camping areas are still open. 'Yes' = show forests where camping is still available despite partial closures. 'No' = show forests where camping is affected." position="right" />
                  </Group>
                  <TriStateToggle
                    mode={impactCampingFilterMode}
                    onToggle={(targetMode) =>
                      setImpactCampingFilterMode((current) =>
                        current === targetMode ? "ANY" : targetMode
                      )
                    }
                    onReset={() => setImpactCampingFilterMode("ANY")}
                    label="Camping impact"
                    includeTestId="impact-filter-camping-include"
                    excludeTestId="impact-filter-camping-exclude"
                    anyTestId="impact-filter-camping-any"
                  />
                </Group>
              ) : null}
              <Group justify="space-between" gap="xs">
                <Group gap={4} mt={4}>
                  <Text size="xs">2WD access</Text>
                  <InfoTooltip label="Filter by 2WD vehicle access warnings from closure notices. 'No warning' hides forests where 2WD access may be restricted." position="right" />
                </Group>
              </Group>
              <SegmentedControl
                aria-label="2WD access impact filter"
                fullWidth
                size="xs"
                value={impactAccess2wdFilterMode === "ANY" ? "EXCLUDE" : impactAccess2wdFilterMode}
                onChange={(value) => setImpactAccess2wdFilterMode(value as TriStateMode)}
                data={[
                  { label: "No warning", value: "EXCLUDE" },
                  { label: "Warning", value: "INCLUDE" },
                ]}
              />
              <Group justify="space-between" gap="xs">
                <Group gap={4} mt={4}>
                  <Text size="xs">4WD access</Text>
                  <InfoTooltip label="Filter by 4WD vehicle access warnings from closure notices. 'No warning' hides forests where 4WD access may be restricted." position="right" />
                </Group>
              </Group>
              <SegmentedControl
                aria-label="4WD access impact filter"
                fullWidth
                size="xs"
                value={impactAccess4wdFilterMode === "ANY" ? "EXCLUDE" : impactAccess4wdFilterMode}
                onChange={(value) => setImpactAccess4wdFilterMode(value as TriStateMode)}
                data={[
                  { label: "No warning", value: "EXCLUDE" },
                  { label: "Warning", value: "INCLUDE" },
                ]}
              />
            </Stack>
          </div>

          {availableClosureTags.length ? (
            <>
              <Divider />
              <div>
                <Group justify="space-between" mb={8}>
                  <Group gap={4}>
                    <Title order={3} size="sm">Closure tags</Title>
                    <InfoTooltip label="Filter by type of closure notice — road access, camping impact, event closure, or operational. Each tag describes what kind of restriction is in place." position="right" />
                  </Group>
                  <Text
                    size="xs"
                    c="blue"
                    style={{ cursor: "pointer" }}
                    onClick={clearClosureTagModes}
                  >
                    Clear
                  </Text>
                </Group>
                <Stack gap={7}>
                  {availableClosureTags.map((closureTag) => {
                    const mode = closureTagFilterModes[closureTag.key] ?? "ANY";
                    const tagTooltip = closureTagTooltips[closureTag.key];
                    return (
                      <Group key={closureTag.key} justify="space-between" gap="xs">
                        <Group gap={4} style={{ minWidth: 0 }}>
                          <Text size="xs" style={{ minWidth: 0 }}>{closureTag.label}</Text>
                          {tagTooltip ? (
                            <InfoTooltip label={tagTooltip} position="right" />
                          ) : null}
                        </Group>
                        <TriStateToggle
                          mode={mode}
                          onToggle={(targetMode) => toggleClosureTagMode(closureTag.key, targetMode)}
                          onReset={() => setSingleClosureTagMode(closureTag.key, "ANY")}
                          label={closureTag.label}
                          includeTestId={`closure-tag-filter-${closureTag.key}-include`}
                          excludeTestId={`closure-tag-filter-${closureTag.key}-exclude`}
                          anyTestId={`closure-tag-filter-${closureTag.key}-any`}
                        />
                      </Group>
                    );
                  })}
                </Stack>
              </div>
            </>
          ) : null}

          <Divider />
          <div>
            <Group justify="space-between" mb={8}>
              <Group gap={4}>
                <Title order={3} size="sm">
                  <Anchor href={FACILITIES_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                    Facilities
                  </Anchor>
                </Title>
                <InfoTooltip label="Filter forests by available facilities like BBQs, toilets, walking tracks, camping areas, etc. Data from the Forestry Corp NSW facilities pages." position="right" />
              </Group>
              <Text
                size="xs"
                c="blue"
                style={{ cursor: "pointer" }}
                onClick={clearFacilityModes}
              >
                Clear
              </Text>
            </Group>
            {availableFacilities.length ? (
              <Stack gap={7} data-testid="facility-filter-list">
                {availableFacilities.map((facility) => {
                  const mode = facilityFilterModes[facility.key] ?? "ANY";
                  const shortened = capitalizeFacilityLabel(facility.label);
                  const isShortened = shortened !== facility.label;
                  return (
                    <Tooltip
                      key={facility.key}
                      label={`${facility.label}: Filter forests that have (or don't have) this facility.`}
                      position="top"
                      withArrow
                      openDelay={400}
                      multiline
                      w={240}
                      events={{ hover: true, focus: true, touch: true }}
                    >
                      <Group justify="space-between" gap="xs">
                        <Group gap={6} style={{ minWidth: 0 }} wrap="nowrap">
                          <FacilityIcon facility={facility} />
                          <Text size="xs" truncate>{isShortened ? shortened : shortened}</Text>
                        </Group>
                        <TriStateToggle
                          mode={mode}
                          onToggle={(targetMode) => toggleFacilityMode(facility.key, targetMode)}
                          onReset={() => setSingleFacilityMode(facility.key, "ANY")}
                          label={facility.label}
                          includeTestId={`facility-filter-${facility.key}-include`}
                          excludeTestId={`facility-filter-${facility.key}-exclude`}
                          anyTestId={`facility-filter-${facility.key}-any`}
                          includeAriaLabel={`Only show forests with ${facility.label.toLowerCase()}`}
                          excludeAriaLabel={`Only show forests without ${facility.label.toLowerCase()}`}
                          anyAriaLabel={`${facility.label} does not matter`}
                        />
                      </Group>
                    </Tooltip>
                  );
                })}
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">Facilities data is unavailable right now.</Text>
            )}
          </div>
        </Stack>
      </ScrollArea>
    </aside>
  );
};
