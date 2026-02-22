import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createApp } from "../../apps/api/src/app.js";
import { ForestLoadProgressBroker } from "../../apps/api/src/services/forest-load-progress-broker.js";
import { RefreshTaskManager } from "../../apps/api/src/services/refresh-task-manager.js";
import { resolveWebSocketServerKey } from "../../apps/api/src/services/websocket-upgrade-router.js";
import type { ForestApiResponse, ForestDataService } from "../../apps/api/src/types/domain.js";

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

const rejectUpgradeRequest = (socket: Socket): void => {
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
};

describe("websocket upgrade routing", () => {
  let server: Server | null = null;
  let refreshWebSocketServer: WebSocketServer | null = null;
  let forestsWebSocketServer: WebSocketServer | null = null;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      refreshWebSocketServer?.close(() => resolve());
      if (!refreshWebSocketServer) {
        resolve();
      }
    });

    await new Promise<void>((resolve) => {
      forestsWebSocketServer?.close(() => resolve());
      if (!forestsWebSocketServer) {
        resolve();
      }
    });

    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
      if (!server) {
        resolve();
      }
    });

    refreshWebSocketServer = null;
    forestsWebSocketServer = null;
    server = null;
  });

  it("accepts websocket handshakes for both refresh and forests endpoints", async () => {
    const dataService: ForestDataService = {
      getForestData: async () => baseResponse
    };

    const forestLoadProgressBroker = new ForestLoadProgressBroker();
    const refreshTaskManager = new RefreshTaskManager(dataService);
    const app = createApp(dataService, refreshTaskManager, forestLoadProgressBroker);
    server = createServer(app);

    refreshWebSocketServer = new WebSocketServer({ noServer: true });
    forestsWebSocketServer = new WebSocketServer({ noServer: true });

    refreshWebSocketServer.on("connection", (socket) => {
      socket.send(JSON.stringify({ type: "refresh-task", task: refreshTaskManager.getState() }));
    });

    forestsWebSocketServer.on("connection", (socket) => {
      socket.send(
        JSON.stringify({
          type: "forest-load-progress",
          load: forestLoadProgressBroker.getState()
        })
      );
    });

    server.on("upgrade", (request, socket, head) => {
      const webSocketServerKey = resolveWebSocketServerKey(request.url);
      const targetWebSocketServer =
        webSocketServerKey === "refresh"
          ? refreshWebSocketServer
          : webSocketServerKey === "forests"
            ? forestsWebSocketServer
            : null;

      if (!targetWebSocketServer) {
        rejectUpgradeRequest(socket);
        return;
      }

      targetWebSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        targetWebSocketServer.emit("connection", webSocket, request);
      });
    });

    await new Promise<void>((resolve) => {
      server?.listen(0, () => resolve());
    });

    const serverAddress = server.address();
    if (!serverAddress || typeof serverAddress === "string") {
      throw new Error("Unable to resolve server address");
    }

    const port = serverAddress.port;
    const refreshWebSocketClient = new WebSocket(`ws://localhost:${port}/api/refresh/ws`);
    const forestsWebSocketClient = new WebSocket(`ws://localhost:${port}/api/forests/ws`);

    const refreshMessage = await new Promise<string>((resolve, reject) => {
      refreshWebSocketClient.once("message", (message) => {
        resolve(String(message));
      });
      refreshWebSocketClient.once("error", (error) => {
        reject(error);
      });
    });

    const forestsMessage = await new Promise<string>((resolve, reject) => {
      forestsWebSocketClient.once("message", (message) => {
        resolve(String(message));
      });
      forestsWebSocketClient.once("error", (error) => {
        reject(error);
      });
    });

    refreshWebSocketClient.close();
    forestsWebSocketClient.close();

    expect(refreshMessage).toContain("refresh-task");
    expect(forestsMessage).toContain("forest-load-progress");
  });
});