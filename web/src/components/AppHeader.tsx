import {
  Button,
  Group,
  Text,
  Title
} from "@mantine/core";
import { IconSettings, IconAlertTriangle } from "@tabler/icons-react";

const formatTimeSince = (isoTimestamp: string): string => {
  const elapsedMs = Date.now() - new Date(isoTimestamp).getTime();
  const totalMinutes = Math.floor(elapsedMs / 60_000);

  if (totalMinutes < 1) return "just now";
  if (totalMinutes < 60) return `${totalMinutes}m ago`;

  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

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
            <Text size="xs" c="dimmed" data-testid="snapshot-freshness">
              Updated {formatTimeSince(snapshotFetchedAt)}
            </Text>
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
