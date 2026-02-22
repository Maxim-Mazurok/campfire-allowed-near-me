import { EventEmitter } from "node:events";
import type {
  ForestDataService,
  RefreshTaskProgress,
  RefreshTaskState,
  UserLocation
} from "../types/domain.js";

interface TriggerRefreshInput {
  userLocation?: UserLocation;
  avoidTolls: boolean;
}

const buildInitialState = (): RefreshTaskState => ({
  taskId: null,
  status: "IDLE",
  phase: "IDLE",
  message: "No refresh has been started.",
  startedAt: null,
  updatedAt: new Date().toISOString(),
  completedAt: null,
  error: null,
  progress: null
});

const toErrorMessage = (value: unknown): string => {
  if (value instanceof Error && value.message.trim()) {
    return value.message.trim();
  }

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "Unknown error";
};

export class RefreshTaskManager {
  private readonly emitter = new EventEmitter();

  private readonly dataService: ForestDataService;

  private state: RefreshTaskState = buildInitialState();

  private taskSeq = 0;

  constructor(dataService: ForestDataService) {
    this.dataService = dataService;
    this.emitter.setMaxListeners(100);
  }

  getState(): RefreshTaskState {
    return { ...this.state, progress: this.state.progress ? { ...this.state.progress } : null };
  }

  subscribe(listener: (state: RefreshTaskState) => void): () => void {
    this.emitter.on("state", listener);
    listener(this.getState());

    return () => {
      this.emitter.off("state", listener);
    };
  }

  private broadcast(state: RefreshTaskState): void {
    this.emitter.emit("state", state);
  }

  private setState(next: Omit<RefreshTaskState, "updatedAt">): void {
    this.state = {
      ...next,
      updatedAt: new Date().toISOString()
    };
    this.broadcast(this.getState());
  }

  private updateProgress(taskId: string, progress: RefreshTaskProgress): void {
    if (this.state.taskId !== taskId || this.state.status !== "RUNNING") {
      return;
    }

    this.setState({
      ...this.state,
      phase: progress.phase,
      message: progress.message,
      progress
    });
  }

  triggerRefresh(input: TriggerRefreshInput): RefreshTaskState {
    if (this.state.status === "RUNNING") {
      return this.getState();
    }

    this.taskSeq += 1;
    const taskId = `refresh-${Date.now()}-${this.taskSeq}`;
    const startedAt = new Date().toISOString();

    this.setState({
      taskId,
      status: "RUNNING",
      phase: "SCRAPE",
      message: "Refresh queued.",
      startedAt,
      completedAt: null,
      error: null,
      progress: {
        phase: "SCRAPE",
        message: "Refresh queued.",
        completed: 0,
        total: null
      }
    });

    void this.run(taskId, startedAt, input);

    return this.getState();
  }

  private async run(
    taskId: string,
    startedAt: string,
    input: TriggerRefreshInput
  ): Promise<void> {
    try {
      await this.dataService.getForestData({
        forceRefresh: true,
        userLocation: input.userLocation,
        avoidTolls: input.avoidTolls,
        progressCallback: (progress) => {
          this.updateProgress(taskId, progress);
        }
      });

      if (this.state.taskId !== taskId) {
        return;
      }

      const completedAt = new Date().toISOString();
      this.setState({
        taskId,
        status: "COMPLETED",
        phase: "DONE",
        message: "Refresh completed.",
        startedAt,
        completedAt,
        error: null,
        progress: {
          phase: "DONE",
          message: "Refresh completed.",
          completed: 1,
          total: 1
        }
      });
    } catch (error) {
      if (this.state.taskId !== taskId) {
        return;
      }

      const completedAt = new Date().toISOString();
      this.setState({
        taskId,
        status: "FAILED",
        phase: "DONE",
        message: "Refresh failed.",
        startedAt,
        completedAt,
        error: toErrorMessage(error),
        progress: {
          phase: "DONE",
          message: "Refresh failed.",
          completed: 0,
          total: 1
        }
      });
    }
  }
}
