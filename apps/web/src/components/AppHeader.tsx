import { Button, Group, Progress, Stack, Text, Title } from "@mantine/core";
import { IconRefresh, IconSettings, IconAlertTriangle } from "@tabler/icons-react";
import type { ProgressViewModel } from "../lib/hooks/use-forest-progress";
import { isStaticMode } from "../lib/forests-query";

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

const ProgressBar = ({
  dataTestId,
  progressViewModel
}: {
  dataTestId: string;
  progressViewModel: ProgressViewModel;
}) => {
  const percentage = progressViewModel.percentage;

  return (
    <div data-testid={dataTestId}>
      <Group justify="space-between" mb={4}>
        <Text size="xs" c="dimmed">{progressViewModel.phase.replaceAll("_", " ")}</Text>
        <Text size="xs" c="dimmed">
          {typeof percentage === "number" ? `${percentage}%` : "In progress"}
        </Text>
      </Group>
      {typeof percentage === "number" ? (
        <Progress
          data-testid={`${dataTestId}-bar`}
          value={percentage}
          size="sm"
          radius="xl"
        />
      ) : (
        <Progress data-testid={`${dataTestId}-bar`} value={100} size="sm" radius="xl" animated />
      )}
    </div>
  );
};

export type AppHeaderProps = {
  warningCount: number;
  onRefreshFromSource: () => void;
  onOpenSettings: () => void;
  onOpenWarnings: () => void;
  refreshTaskStatusText: string | null;
  refreshTaskProgress: ProgressViewModel | null;
  forestLoadStatusText: string | null;
  forestLoadProgress: ProgressViewModel | null;
  snapshotFetchedAt: string | null;
};

export const AppHeader = ({
  warningCount,
  onRefreshFromSource,
  onOpenSettings,
  onOpenWarnings,
  refreshTaskStatusText,
  refreshTaskProgress,
  forestLoadStatusText,
  forestLoadProgress,
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
        {!isStaticMode ? (
          <Button
            variant="default"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            onClick={onRefreshFromSource}
          >
            Refresh from source
          </Button>
        ) : null}
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
        {isStaticMode && snapshotFetchedAt ? (
          <SnapshotFreshness fetchedAt={snapshotFetchedAt} />
        ) : null}
        {refreshTaskStatusText ? (
          <Text size="xs" c="dimmed" data-testid="refresh-task-status">
            {refreshTaskStatusText}
          </Text>
        ) : null}
        {refreshTaskProgress ? (
          <ProgressBar dataTestId="refresh-progress" progressViewModel={refreshTaskProgress} />
        ) : null}
        {forestLoadStatusText ? (
          <Text size="xs" c="dimmed" data-testid="forest-load-status">
            {forestLoadStatusText}
          </Text>
        ) : null}
        {forestLoadProgress ? (
          <ProgressBar dataTestId="forest-load-progress" progressViewModel={forestLoadProgress} />
        ) : null}
      </Stack>
    </header>
  );
};
