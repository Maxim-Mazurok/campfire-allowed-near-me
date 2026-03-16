import {
  Button,
  Group,
  Text,
  Title,
} from "@mantine/core";
import { IconSettings, IconAlertTriangle } from "@tabler/icons-react";
import { formatDistanceToNowStrict } from "date-fns";
import { InfoTooltip } from "./InfoTooltip";

export const SNAPSHOT_UPDATE_SCHEDULE_TOOLTIP =
  "Data updates twice daily, around 4\u20135 AM and 4\u20135 PM Sydney time";

export type AppHeaderProps = {
  warningCount: number;
  onOpenSettings: () => void;
  onOpenWarnings: () => void;
  snapshotFetchedAt: string | null;
};

export const AppHeader = ({
  warningCount,
  onOpenSettings,
  onOpenWarnings,
  snapshotFetchedAt
}: AppHeaderProps) => {
  return (
    <header className="panel app-header">
      <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
        <Group gap="xs" align="center" wrap="nowrap">
          <img
            src="/favicon.svg"
            alt=""
            width={24}
            height={24}
            style={{ flexShrink: 0 }}
          />
          <div>
            <Title order={1} size="h4" style={{ lineHeight: 1.2 }}>
              Campfire Allowed Near Me
            </Title>
            <Text size="xs" c="dimmed" mt={2}>
              Find NSW forests where campfires are currently allowed
            </Text>
          </div>
        </Group>
        <Group gap="xs" align="center" className="header-actions">
          {snapshotFetchedAt ? (
            <Group gap={4} align="center" wrap="nowrap">
              <Text size="xs" c="dimmed" data-testid="snapshot-freshness">
                Updated{" "}
                {formatDistanceToNowStrict(new Date(snapshotFetchedAt), {
                  addSuffix: true
                })}
              </Text>
              <InfoTooltip label={SNAPSHOT_UPDATE_SCHEDULE_TOOLTIP} iconSize={12} />
            </Group>
          ) : null}
          <Button
            variant="default"
            size="xs"
            leftSection={<IconSettings size={14} />}
            data-testid="settings-btn"
            onClick={onOpenSettings}
          >
            Settings
          </Button>
          <Button
            variant="outline"
            size="compact-xs"
            color="warning.8"
            data-testid="warnings-btn"
            aria-label={`Warnings (${warningCount})`}
            onClick={onOpenWarnings}
            disabled={warningCount === 0}
            leftSection={<IconAlertTriangle size={14} />}
          >
            {warningCount}
          </Button>
        </Group>
      </Group>
    </header>
  );
};
