import { useMemo } from "react";
import { Accordion, Badge, Button, Group, Text } from "@mantine/core";
import {
  IconMapPinOff,
  IconFlameOff,
  IconAlertTriangle,
  IconBuildingWarehouse,
  IconArrowsShuffle,
  IconFileAlert
} from "@tabler/icons-react";
import type { WarningSectionProps } from "./WarningsTypes";

interface SectionHeaderProperties {
  label: string;
  count: number;
}

const SectionHeader = ({ label, count }: SectionHeaderProperties) => (
  <Group gap="sm" wrap="nowrap">
    <Text fw={600} size="sm">{label}</Text>
    <Badge size="sm" variant="filled" color="warning" circle>{count}</Badge>
  </Group>
);

const ICON_SIZE = 20;
const ICON_STROKE = 1.5;

export const WarningsSections = ({
  hasUnmappedForestWarning,
  unmappedForests,
  getUnmappedForestLink,
  hasUnknownTotalFireBanWarning,
  forestsWithUnknownTotalFireBan,
  buildTotalFireBanDetailsUrl,
  generalWarnings,
  hasFacilitiesMismatchWarning,
  matchDiagnostics,
  facilitiesMismatchWarningSummary,
  renderFacilitiesMismatchWarningSummary,
  openFireBanForestTable,
  buildFacilitiesForestUrl,
  hasFuzzyMatchesWarning,
  fuzzyMatchesWarningText,
  getFireBanAreaUrl,
  closureDiagnostics
}: WarningSectionProps) => {
  const showFacilitiesMismatch =
    hasFacilitiesMismatchWarning || matchDiagnostics.unmatchedFacilitiesForests.length > 0;
  const showFuzzyMatches =
    hasFuzzyMatchesWarning || matchDiagnostics.fuzzyMatches.length > 0;
  const showUnmatchedClosures = closureDiagnostics.unmatchedNotices.length > 0;

  const facilitiesMismatchCount = matchDiagnostics.unmatchedFacilitiesForests.length || (hasFacilitiesMismatchWarning ? 1 : 0);
  const fuzzyMatchesCount = matchDiagnostics.fuzzyMatches.length || (hasFuzzyMatchesWarning ? 1 : 0);

  const defaultOpenValues = useMemo(() => {
    const values: string[] = [];
    if (hasUnmappedForestWarning) values.push("unmapped");
    if (hasUnknownTotalFireBanWarning) values.push("unknown-total-fire-ban");
    if (generalWarnings.length > 0) values.push("general");
    if (showFacilitiesMismatch) values.push("facilities-mismatch");
    if (showFuzzyMatches) values.push("fuzzy-matches");
    if (showUnmatchedClosures) values.push("unmatched-closures");
    return values;
  }, [hasUnmappedForestWarning, hasUnknownTotalFireBanWarning, generalWarnings.length, showFacilitiesMismatch, showFuzzyMatches, showUnmatchedClosures]);

  const hasSections = defaultOpenValues.length > 0;

  if (!hasSections) {
    return null;
  }

  return (
    <Accordion
      multiple
      defaultValue={defaultOpenValues}
      variant="separated"
      radius="md"
      data-testid="warnings-accordion"
    >
      {hasUnmappedForestWarning ? (
        <Accordion.Item value="unmapped" data-testid="warnings-unmapped-section">
          <Accordion.Control
            aria-label={`Unmapped Forests — ${unmappedForests.length}`}
            icon={<IconMapPinOff size={ICON_SIZE} stroke={ICON_STROKE} color="var(--mantine-color-warning-8)" />}
          >
            <SectionHeader
              label="Unmapped Forests (Distance Unavailable)"
              count={unmappedForests.length}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" c="dimmed" mb="xs">
              {unmappedForests.length} forest(s) could not be mapped to coordinates.
            </Text>
            <ul className="warning-list warning-list-detailed">
              {unmappedForests.map((forest) => {
                const debugEntries =
                  forest.geocodeDiagnostics?.debug?.length
                    ? forest.geocodeDiagnostics.debug
                    : ["No geocoding attempt diagnostics were captured in this snapshot."];
                const failureReason =
                  forest.geocodeDiagnostics?.reason ??
                  "Coordinates were unavailable after forest and area geocoding.";
                const linkTarget = getUnmappedForestLink(forest);

                return (
                  <li key={forest.id} className="warning-list-item-detailed">
                    <div>
                      <a href={linkTarget.href} target="_blank" rel="noopener noreferrer">
                        <mark className="warning-forest-highlight">{forest.forestName}</mark>
                      </a>{" "}
                      <span className="muted">({linkTarget.label})</span>
                    </div>
                    <div className="muted">Reason: {failureReason}</div>
                    <details className="warning-debug">
                      <summary>Debug info</summary>
                      <ul className="warning-debug-list">
                        {debugEntries.map((entry, index) => (
                          <li key={`${forest.id}:debug:${index}`}>{entry}</li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}

      {hasUnknownTotalFireBanWarning ? (
        <Accordion.Item value="unknown-total-fire-ban" data-testid="warnings-total-fire-ban-unknown-section">
          <Accordion.Control
            aria-label={`Total Fire Ban Status Unknown — ${forestsWithUnknownTotalFireBan.length}`}
            icon={<IconFlameOff size={ICON_SIZE} stroke={ICON_STROKE} color="var(--mantine-color-red-6)" />}
          >
            <SectionHeader
              label="Total Fire Ban Status Unknown"
              count={forestsWithUnknownTotalFireBan.length}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" c="dimmed" mb="xs">
              {forestsWithUnknownTotalFireBan.length} forest(s) have unknown Total Fire Ban status.
            </Text>
            <ul className="warning-list warning-list-detailed">
              {forestsWithUnknownTotalFireBan.map((forest) => {
                const debugEntries =
                  forest.totalFireBanDiagnostics?.debug?.length
                    ? forest.totalFireBanDiagnostics.debug
                    : ["No Total Fire Ban diagnostics were captured in this snapshot."];
                const failureReason =
                  forest.totalFireBanDiagnostics?.reason ??
                  "Total Fire Ban status could not be determined from available source data.";

                return (
                  <li key={`${forest.id}:total-fire-ban-unknown`} className="warning-list-item-detailed">
                    <div>
                      <a
                        href={buildTotalFireBanDetailsUrl(forest)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <mark className="warning-forest-highlight">{forest.forestName}</mark>
                      </a>{" "}
                      <span className="muted">(RFS Total Fire Ban details)</span>
                    </div>
                    <div className="muted">Reason: {failureReason}</div>
                    <details className="warning-debug">
                      <summary>Debug info</summary>
                      <ul className="warning-debug-list">
                        {debugEntries.map((entry, index) => (
                          <li key={`${forest.id}:total-fire-ban-debug:${index}`}>{entry}</li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}

      {generalWarnings.length > 0 ? (
        <Accordion.Item value="general">
          <Accordion.Control
            aria-label={`General Warnings — ${generalWarnings.length}`}
            icon={<IconAlertTriangle size={ICON_SIZE} stroke={ICON_STROKE} color="var(--mantine-color-warning-8)" />}
          >
            <SectionHeader label="General" count={generalWarnings.length} />
          </Accordion.Control>
          <Accordion.Panel>
            <ul className="warning-list">
              {generalWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}

      {showFacilitiesMismatch ? (
        <Accordion.Item value="facilities-mismatch">
          <Accordion.Control
            aria-label={`Facilities Missing — ${facilitiesMismatchCount}`}
            icon={<IconBuildingWarehouse size={ICON_SIZE} stroke={ICON_STROKE} color="var(--mantine-color-warning-8)" />}
          >
            <SectionHeader
              label="Facilities Missing From Fire Ban Pages"
              count={facilitiesMismatchCount}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" c="dimmed" mb="xs">
              {renderFacilitiesMismatchWarningSummary(facilitiesMismatchWarningSummary)}
              {" "}
              <Button
                variant="subtle"
                size="compact-xs"
                onClick={openFireBanForestTable}
                data-testid="open-fire-ban-forest-table-btn"
              >
                (see full list)
              </Button>
            </Text>
            {matchDiagnostics.unmatchedFacilitiesForests.length > 0 ? (
              <ul className="warning-list">
                {matchDiagnostics.unmatchedFacilitiesForests.map((forestName) => (
                  <li key={forestName}>
                    <a
                      href={buildFacilitiesForestUrl(forestName)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {forestName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}

      {showFuzzyMatches ? (
        <Accordion.Item value="fuzzy-matches">
          <Accordion.Control
            aria-label={`Fuzzy Facilities Matching — ${fuzzyMatchesCount}`}
            icon={<IconArrowsShuffle size={ICON_SIZE} stroke={ICON_STROKE} color="var(--mantine-color-blue-6)" />}
          >
            <SectionHeader label="Fuzzy Facilities Matching" count={fuzzyMatchesCount} />
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" c="dimmed" mb="xs">{fuzzyMatchesWarningText}</Text>
            {matchDiagnostics.fuzzyMatches.length > 0 ? (
              <ul className="warning-list">
                {matchDiagnostics.fuzzyMatches.map((match) => (
                  <li key={`${match.facilitiesForestName}:${match.fireBanForestName}`}>
                    Facilities:{" "}
                    <a
                      href={buildFacilitiesForestUrl(match.facilitiesForestName)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {match.facilitiesForestName}
                    </a>{" "}
                    {"->"} Fire ban:{" "}
                    <a
                      href={getFireBanAreaUrl(match.fireBanForestName)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {match.fireBanForestName}
                    </a>{" "}
                    ({match.score.toFixed(2)})
                  </li>
                ))}
              </ul>
            ) : null}
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}

      {showUnmatchedClosures ? (
        <Accordion.Item value="unmatched-closures">
          <Accordion.Control
            aria-label={`Unmatched Closure Notices — ${closureDiagnostics.unmatchedNotices.length}`}
            icon={<IconFileAlert size={ICON_SIZE} stroke={ICON_STROKE} color="var(--mantine-color-red-7)" />}
          >
            <SectionHeader
              label="Unmatched Closure Notices"
              count={closureDiagnostics.unmatchedNotices.length}
            />
          </Accordion.Control>
          <Accordion.Panel>
            <Text size="sm" c="dimmed" mb="xs">
              {closureDiagnostics.unmatchedNotices.length} closure notice(s) could not be matched to forests.
            </Text>
            <ul className="warning-list">
              {closureDiagnostics.unmatchedNotices.map((notice) => (
                <li key={`unmatched-closure:${notice.id}`}>
                  <a href={notice.detailUrl} target="_blank" rel="noopener noreferrer">
                    {notice.title}
                  </a>
                </li>
              ))}
            </ul>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}
    </Accordion>
  );
};
