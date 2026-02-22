import { useMemo } from "react";
import type {
  ForestLoadProgressState,
  RefreshTaskState
} from "../api";

export interface ProgressViewModel {
  phase: string;
  completed: number;
  total: number | null;
  percentage: number | null;
}

const toProgressViewModel = (
  phase: string,
  completed: number,
  total: number | null | undefined
): ProgressViewModel => {
  if (typeof total !== "number" || total <= 0) {
    return {
      phase,
      completed,
      total: null,
      percentage: null
    };
  }

  return {
    phase,
    completed,
    total,
    percentage: Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
  };
};

export const useRefreshTaskStatusText = (
  refreshTaskState: RefreshTaskState | null
): string | null =>
  useMemo(() => {
    if (!refreshTaskState || refreshTaskState.status === "IDLE") {
      return null;
    }

    if (refreshTaskState.status === "RUNNING") {
      const completed = refreshTaskState.progress?.completed;
      const total = refreshTaskState.progress?.total;
      const progressText =
        typeof completed === "number" && typeof total === "number"
          ? ` (${completed}/${total})`
          : "";
      return `Refresh in progress: ${refreshTaskState.message}${progressText}`;
    }

    if (refreshTaskState.status === "FAILED") {
      return `Refresh failed: ${refreshTaskState.error ?? "Unknown error"}`;
    }

    return "Refresh completed.";
  }, [refreshTaskState]);

export const useRefreshTaskProgress = (
  refreshTaskState: RefreshTaskState | null
): ProgressViewModel | null =>
  useMemo(() => {
    if (!refreshTaskState || refreshTaskState.status !== "RUNNING") {
      return null;
    }

    return toProgressViewModel(
      refreshTaskState.phase,
      refreshTaskState.progress?.completed ?? 0,
      refreshTaskState.progress?.total
    );
  }, [refreshTaskState]);

export const useForestLoadStatusText = (
  forestLoadProgressState: ForestLoadProgressState | null
): string | null =>
  useMemo(() => {
    if (!forestLoadProgressState || forestLoadProgressState.status === "IDLE") {
      return null;
    }

    if (forestLoadProgressState.status === "RUNNING") {
      const completed = forestLoadProgressState.progress?.completed;
      const total = forestLoadProgressState.progress?.total;
      const progressText =
        typeof completed === "number" && typeof total === "number"
          ? ` (${completed}/${total})`
          : "";
      return `Loading forests: ${forestLoadProgressState.message}${progressText}`;
    }

    if (forestLoadProgressState.status === "FAILED") {
      return `Forest load failed: ${forestLoadProgressState.error ?? "Unknown error"}`;
    }

    return "Forest load completed.";
  }, [forestLoadProgressState]);

export const useForestLoadProgress = (
  forestLoadProgressState: ForestLoadProgressState | null
): ProgressViewModel | null =>
  useMemo(() => {
    if (!forestLoadProgressState || forestLoadProgressState.status !== "RUNNING") {
      return null;
    }

    return toProgressViewModel(
      forestLoadProgressState.phase,
      forestLoadProgressState.progress?.completed ?? 0,
      forestLoadProgressState.progress?.total
    );
  }, [forestLoadProgressState]);
