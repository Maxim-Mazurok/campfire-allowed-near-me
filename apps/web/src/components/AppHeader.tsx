import type { ProgressViewModel } from "../lib/hooks/use-forest-progress";

const ProgressBar = ({
  dataTestId,
  progressViewModel
}: {
  dataTestId: string;
  progressViewModel: ProgressViewModel;
}) => {
  return (
    <div className="refresh-progress" data-testid={dataTestId}>
      <div className="refresh-progress-meta">
        <span>{progressViewModel.phase.replaceAll("_", " ")}</span>
        {typeof progressViewModel.percentage === "number" ? (
          <span>{progressViewModel.percentage}%</span>
        ) : (
          <span>In progress</span>
        )}
      </div>
      {typeof progressViewModel.percentage === "number" ? (
        <progress
          className="refresh-progress-bar"
          data-testid={`${dataTestId}-bar`}
          value={progressViewModel.completed}
          max={progressViewModel.total ?? 1}
        />
      ) : (
        <progress className="refresh-progress-bar" data-testid={`${dataTestId}-bar`} />
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
};

export const AppHeader = ({
  warningCount,
  onRefreshFromSource,
  onOpenSettings,
  onOpenWarnings,
  refreshTaskStatusText,
  refreshTaskProgress,
  forestLoadStatusText,
  forestLoadProgress
}: AppHeaderProps) => {
  return (
    <header className="panel header">
      <h1>Campfire Allowed Near Me</h1>
      <p>
        NSW forestry checker combining Solid Fuel Fire Ban data (Forestry Corporation NSW)
        and Total Fire Ban data (NSW Rural Fire Service).
      </p>

      <div className="controls">
        <button type="button" onClick={onRefreshFromSource}>
          Refresh from source
        </button>
        <button
          type="button"
          className="settings-btn"
          data-testid="settings-btn"
          onClick={onOpenSettings}
        >
          Settings
        </button>
        <button
          type="button"
          className="warnings-btn"
          data-testid="warnings-btn"
          aria-label={`Warnings (${warningCount})`}
          onClick={onOpenWarnings}
          disabled={warningCount === 0}
        >
          <span aria-hidden="true">⚠</span>
          <span className="warnings-btn-count">{warningCount}</span>
        </button>
      </div>

      {refreshTaskStatusText ? (
        <p className="muted refresh-task-status" data-testid="refresh-task-status">
          {refreshTaskStatusText}
        </p>
      ) : null}
      {refreshTaskProgress ? (
        <ProgressBar dataTestId="refresh-progress" progressViewModel={refreshTaskProgress} />
      ) : null}
      {forestLoadStatusText ? (
        <p className="muted refresh-task-status" data-testid="forest-load-status">
          {forestLoadStatusText}
        </p>
      ) : null}
      {forestLoadProgress ? (
        <ProgressBar dataTestId="forest-load-progress" progressViewModel={forestLoadProgress} />
      ) : null}
    </header>
  );
};
