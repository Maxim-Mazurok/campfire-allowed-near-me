import {
  Button,
  Group,
  Stack,
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

const SnapshotFreshness = ({ fetchedAt }: { fetchedAt: string }) => {
  const timeSince = formatTimeSince(fetchedAt);
  return (
    <Text size="xs" c="dimmed" data-testid="snapshot-freshness">
      Data updated: {timeSince}
    </Text>
  );
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
    <header className="panel">
      <Title order={1} size="h3">Campfire Allowed Near Me</Title>
      <Text size="sm" c="dimmed" mt={6} mb={10}>
        NSW forestry checker combining Solid Fuel Fire Ban data (Forestry Corporation NSW)
        and Total Fire Ban data (NSW Rural Fire Service).
      </Text>

      <Group gap="sm" wrap="wrap">
        <Button
          variant="default"
          size="xs"
          leftSection={<IconSettings size={14} />}
          data-testid="settings-btn"
          onClick={onOpenSettings}
          ml="auto"
        >
          Settings
        </Button>
        <Button
          variant="outline"
          size="xs"
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

      <Stack gap={4} mt={8}>
        {snapshotFetchedAt ? (
          <SnapshotFreshness fetchedAt={snapshotFetchedAt} />
        ) : null}
      </Stack>
    </header>
  );
};
