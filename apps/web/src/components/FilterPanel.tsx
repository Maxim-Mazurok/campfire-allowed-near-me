import type { Dispatch, SetStateAction } from "react";
import { Anchor, Button, Divider, Group, ScrollArea, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import { FacilityIcon } from "./FacilityIcon";
import { TriStateToggle } from "./TriStateToggle";
import type { ClosureTagDefinition, FacilityDefinition } from "../lib/api";
import {
  type BanFilterMode,
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

export type FilterPanelProps = {
  matchingForestsCount: number;
  forestsCount: number;
  solidFuelBanFilterMode: BanFilterMode;
  setSolidFuelBanFilterMode: Dispatch<SetStateAction<BanFilterMode>>;
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
  matchingForestsCount,
  forestsCount,
  solidFuelBanFilterMode,
  setSolidFuelBanFilterMode,
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
  return (
    <aside className="panel filter-panel">
      <Title order={2} size="h4">Filters</Title>
      <Text size="sm" c="dimmed" mt={6} mb={12}>
        Matching {matchingForestsCount} of {forestsCount} forests.
      </Text>
      <ScrollArea style={{ flex: 1 }} offsetScrollbars>
        <Stack gap="md">
          <Divider />
          <div>
            <Title order={3} size="sm" mb={8}>
              <Anchor href={SOLID_FUEL_FIRE_BAN_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                Solid Fuel Fire Ban
              </Anchor>
            </Title>
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
          </div>

          <Divider />
          <div>
            <Title order={3} size="sm" mb={4}>
              <Anchor href={TOTAL_FIRE_BAN_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                Total Fire Ban
              </Anchor>
            </Title>
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
            <Title order={3} size="sm" mb={8}>
              <Anchor href={CLOSURES_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                Closures & Notices
              </Anchor>
            </Title>
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
                <Text size="xs">Has notices</Text>
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
              <Group justify="space-between" gap="xs">
                <Text size="xs">Camping open</Text>
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
              <Group justify="space-between" gap="xs">
                <Text size="xs">2WD access</Text>
                <TriStateToggle
                  mode={impactAccess2wdFilterMode}
                  onToggle={(targetMode) =>
                    setImpactAccess2wdFilterMode((current) =>
                      current === targetMode ? "ANY" : targetMode
                    )
                  }
                  onReset={() => setImpactAccess2wdFilterMode("ANY")}
                  label="2WD access impact"
                  includeTestId="impact-filter-access-2wd-include"
                  excludeTestId="impact-filter-access-2wd-exclude"
                  anyTestId="impact-filter-access-2wd-any"
                />
              </Group>
              <Group justify="space-between" gap="xs">
                <Text size="xs">4WD access</Text>
                <TriStateToggle
                  mode={impactAccess4wdFilterMode}
                  onToggle={(targetMode) =>
                    setImpactAccess4wdFilterMode((current) =>
                      current === targetMode ? "ANY" : targetMode
                    )
                  }
                  onReset={() => setImpactAccess4wdFilterMode("ANY")}
                  label="4WD access impact"
                  includeTestId="impact-filter-access-4wd-include"
                  excludeTestId="impact-filter-access-4wd-exclude"
                  anyTestId="impact-filter-access-4wd-any"
                />
              </Group>
            </Stack>
          </div>

          {availableClosureTags.length ? (
            <>
              <Divider />
              <div>
                <Group justify="space-between" mb={8}>
                  <Title order={3} size="sm">Closure tags</Title>
                  <Button variant="subtle" size="compact-xs" onClick={clearClosureTagModes}>
                    Clear
                  </Button>
                </Group>
                <Stack gap={7}>
                  {availableClosureTags.map((closureTag) => {
                    const mode = closureTagFilterModes[closureTag.key] ?? "ANY";
                    return (
                      <Group key={closureTag.key} justify="space-between" gap="xs">
                        <Text size="xs" style={{ minWidth: 0 }}>{closureTag.label}</Text>
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
              <Title order={3} size="sm">
                <Anchor href={FACILITIES_SOURCE_URL} target="_blank" rel="noreferrer" c="inherit" underline="always">
                  Facilities
                </Anchor>
              </Title>
              <Button variant="subtle" size="compact-xs" onClick={clearFacilityModes}>
                Clear
              </Button>
            </Group>
            {availableFacilities.length ? (
              <Stack gap={7} data-testid="facility-filter-list">
                {availableFacilities.map((facility) => {
                  const mode = facilityFilterModes[facility.key] ?? "ANY";
                  return (
                    <Group key={facility.key} justify="space-between" gap="xs">
                      <Group gap={6} style={{ minWidth: 0 }} wrap="nowrap">
                        <FacilityIcon facility={facility} />
                        <Text size="xs" truncate>{facility.label}</Text>
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
