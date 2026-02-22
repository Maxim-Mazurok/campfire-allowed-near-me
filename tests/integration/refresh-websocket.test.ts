import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createApp } from "../../apps/api/src/app.js";
import { RefreshTaskManager } from "../../apps/api/src/services/refresh-task-manager.js";
import type {
  ForestApiResponse,
  ForestDataService,
  ForestDataServiceInput,
  RefreshTaskState
} from "../../apps/api/src/types/domain.js";

const baseResponse: ForestApiResponse = {
  fetchedAt: new Date().toISOString(),
  stale: false,
  sourceName: "Forestry Corporation NSW",
  availableFacilities: [],
  matchDiagnostics: {
    unmatchedFacilitiesForests: [],
    fuzzyMatches: []
  },
  forests: [],
  nearestLegalSpot: null,
  warnings: []
};

describe("refresh websocket progress", () => {
  let server: Server | null = null;
  let webSocketServer: WebSocketServer | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      webSocketServer?.close(() => resolve());
      if (!webSocketServer) {
        resolve();
      }
    });

    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
      if (!server) {
        resolve();
      }
    });

    webSocketServer = null;
    server = null;
  });

  it("streams RUNNING progress and COMPLETED state over websocket", async () => {
    const dataService: ForestDataService = {
      getForestData: async (input?: ForestDataServiceInput) => {
        if (input?.forceRefresh && input.progressCallback) {
          input.progressCallback({
            phase: "SCRAPE",
            message: "Scraping source data.",
            completed: 0,
            total: 1
          });

          await new Promise((resolve) => setTimeout(resolve, 30));

          input.progressCallback({
            phase: "GEOCODE_FORESTS",
            message: "Resolving forest coordinates.",
            completed: 2,
            total: 3
          });

          await new Promise((resolve) => setTimeout(resolve, 30));
        }

        return baseResponse;
      }
    };

    const refreshTaskManager = new RefreshTaskManager(dataService);
    const app = createApp(dataService, refreshTaskManager);
    server = createServer(app);

    webSocketServer = new WebSocketServer({
      server,
      path: "/api/refresh/ws"
    });

    webSocketServer.on("connection", (socket) => {
      const unsubscribe = refreshTaskManager.subscribe((state) => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }

        socket.send(
          JSON.stringify({
            type: "refresh-task",
            task: state
          })
        );
      });

      socket.on("close", () => {
        unsubscribe();
      });
    });

    await new Promise<void>((resolve) => {
      server?.listen(0, () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve test server address");
    }

    const baseUrl = `http://localhost:${address.port}`;
    const websocketUrl = `ws://localhost:${address.port}/api/refresh/ws`;

    const states: RefreshTaskState[] = [];

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(websocketUrl);
      const timeoutHandle = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out waiting for websocket refresh states"));
      }, 5000);

      socket.on("open", async () => {
        await fetch(`${baseUrl}/api/forests?refresh=1&lat=-33.8&lng=151.2`);
      });

      socket.on("message", (message) => {
        const payload = JSON.parse(message.toString()) as {
          type?: string;
          task?: RefreshTaskState;
        };

        if (payload.type !== "refresh-task" || !payload.task) {
          return;
        }

        states.push(payload.task);

        if (payload.task.status === "COMPLETED") {
          clearTimeout(timeoutHandle);
          socket.close();
          resolve();
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timeoutHandle);
        reject(error);
      });
    });

    expect(states.some((state) => state.status === "RUNNING")).toBe(true);
    expect(
      states.some(
        (state) =>
          state.status === "RUNNING" && state.progress?.phase === "GEOCODE_FORESTS"
      )
    ).toBe(true);
    expect(states.at(-1)?.status).toBe("COMPLETED");
  });
});
