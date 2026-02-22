import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { createApp } from "../../apps/api/src/app.js";
import { ForestLoadProgressBroker } from "../../apps/api/src/services/forest-load-progress-broker.js";
import type {
  ForestApiResponse,
  ForestDataService,
  ForestDataServiceInput
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

describe("forests load websocket progress", () => {
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

  it("streams RUNNING progress and COMPLETED state for normal forests loads", async () => {
    const dataService: ForestDataService = {
      getForestData: async (input?: ForestDataServiceInput) => {
        input?.progressCallback?.({
          phase: "SCRAPE",
          message: "Loading source pages.",
          completed: 0,
          total: 1
        });

        await new Promise((resolve) => setTimeout(resolve, 30));

        input?.progressCallback?.({
          phase: "GEOCODE_FORESTS",
          message: "Resolving forest coordinates.",
          completed: 2,
          total: 4
        });

        await new Promise((resolve) => setTimeout(resolve, 30));
        return baseResponse;
      }
    };

    const forestLoadProgressBroker = new ForestLoadProgressBroker();
    const app = createApp(dataService, undefined, forestLoadProgressBroker);
    server = createServer(app);

    webSocketServer = new WebSocketServer({
      server,
      path: "/api/forests/ws"
    });

    webSocketServer.on("connection", (socket) => {
      const unsubscribe = forestLoadProgressBroker.subscribe((state) => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }

        socket.send(
          JSON.stringify({
            type: "forest-load-progress",
            load: state
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
    const websocketUrl = `ws://localhost:${address.port}/api/forests/ws`;

    const states: Array<{ status: string; phase: string }> = [];

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(websocketUrl);
      const timeoutHandle = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out waiting for forests load websocket states"));
      }, 5000);

      socket.on("open", async () => {
        await fetch(`${baseUrl}/api/forests?tolls=avoid`);
      });

      socket.on("message", (message) => {
        const payload = JSON.parse(message.toString()) as {
          type?: string;
          load?: { status?: string; phase?: string };
        };

        if (payload.type !== "forest-load-progress" || !payload.load) {
          return;
        }

        states.push({
          status: payload.load.status ?? "",
          phase: payload.load.phase ?? ""
        });

        if (payload.load.status === "COMPLETED") {
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
        (state) => state.status === "RUNNING" && state.phase === "GEOCODE_FORESTS"
      )
    ).toBe(true);
    expect(states.at(-1)?.status).toBe("COMPLETED");
  });
});