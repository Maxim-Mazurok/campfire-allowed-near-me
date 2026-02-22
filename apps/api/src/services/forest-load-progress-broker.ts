import { EventEmitter } from "node:events";
import type { ForestLoadProgressState, RefreshTaskProgress } from "../types/domain.js";

interface ForestLoadRequestHandle {
  requestId: string;
  updateProgress: (progress: RefreshTaskProgress) => void;
  complete: () => void;
  fail: (error: unknown) => void;
}

const buildInitialState = (): ForestLoadProgressState => ({
  requestId: null,
  status: "IDLE",
  phase: "IDLE",
  message: "No forest load is currently running.",
  startedAt: null,
  updatedAt: new Date().toISOString(),
  completedAt: null,
  error: null,
  progress: null,
  activeRequestCount: 0
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

export class ForestLoadProgressBroker {
  private readonly eventEmitter = new EventEmitter();

  private state: ForestLoadProgressState = buildInitialState();

  private requestSequence = 0;

  private readonly runningRequestIds = new Set<string>();

  constructor() {
    this.eventEmitter.setMaxListeners(100);
  }

  getState(): ForestLoadProgressState {
    return {
      ...this.state,
      progress: this.state.progress ? { ...this.state.progress } : null
    };
  }

  subscribe(listener: (state: ForestLoadProgressState) => void): () => void {
    this.eventEmitter.on("state", listener);
    listener(this.getState());

    return () => {
      this.eventEmitter.off("state", listener);
    };
  }

  private setState(nextState: Omit<ForestLoadProgressState, "updatedAt">): void {
    this.state = {
      ...nextState,
      updatedAt: new Date().toISOString()
    };
    this.eventEmitter.emit("state", this.getState());
  }

  beginRequest(): ForestLoadRequestHandle {
    this.requestSequence += 1;
    const requestId = `forest-load-${Date.now()}-${this.requestSequence}`;
    const startedAt = new Date().toISOString();
    this.runningRequestIds.add(requestId);

    this.setState({
      requestId,
      status: "RUNNING",
      phase: "SCRAPE",
      message: "Loading forest data.",
      startedAt,
      completedAt: null,
      error: null,
      progress: {
        phase: "SCRAPE",
        message: "Loading forest data.",
        completed: 0,
        total: null
      },
      activeRequestCount: this.runningRequestIds.size
    });

    return {
      requestId,
      updateProgress: (progress) => {
        if (!this.runningRequestIds.has(requestId)) {
          return;
        }

        this.setState({
          ...this.state,
          requestId,
          status: "RUNNING",
          phase: progress.phase,
          message: progress.message,
          progress,
          activeRequestCount: this.runningRequestIds.size
        });
      },
      complete: () => {
        this.runningRequestIds.delete(requestId);
        this.setState({
          requestId,
          status: "COMPLETED",
          phase: "DONE",
          message: "Forest data load completed.",
          startedAt,
          completedAt: new Date().toISOString(),
          error: null,
          progress: {
            phase: "DONE",
            message: "Forest data load completed.",
            completed: 1,
            total: 1
          },
          activeRequestCount: this.runningRequestIds.size
        });
      },
      fail: (error) => {
        this.runningRequestIds.delete(requestId);
        this.setState({
          requestId,
          status: "FAILED",
          phase: "DONE",
          message: "Forest data load failed.",
          startedAt,
          completedAt: new Date().toISOString(),
          error: toErrorMessage(error),
          progress: {
            phase: "DONE",
            message: "Forest data load failed.",
            completed: 0,
            total: 1
          },
          activeRequestCount: this.runningRequestIds.size
        });
      }
    };
  }
}