import type {
  ForestLoadProgressState,
  RefreshTaskState
} from "./contracts.js";

export interface RefreshTaskWebSocketMessage {
  type: "refresh-task";
  task: RefreshTaskState;
}

export interface ForestLoadProgressWebSocketMessage {
  type: "forest-load-progress";
  load: ForestLoadProgressState;
}

export type ApiWebSocketMessage =
  | RefreshTaskWebSocketMessage
  | ForestLoadProgressWebSocketMessage;
