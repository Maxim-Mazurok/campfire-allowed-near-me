import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { ForestLoadProgressBroker } from "./services/forest-load-progress-broker.js";
import { LiveForestDataService } from "./services/live-forest-data-service.js";
import { RefreshTaskManager } from "./services/refresh-task-manager.js";
import { resolveWebSocketServerKey } from "./services/websocket-upgrade-router.js";
import { loadLocalEnv } from "./utils/load-local-env.js";

loadLocalEnv();

const MAX_PORT = 65_535;
let port = Number(process.env.PORT ?? "8787");
const strictPort = process.env.STRICT_PORT === "1";
const service = new LiveForestDataService({
  scrapeTtlMs: Number(process.env.SCRAPE_TTL_MS ?? `${15 * 60 * 1000}`),
  snapshotPath: process.env.FORESTRY_SNAPSHOT_PATH ?? null
});
const refreshTaskManager = new RefreshTaskManager(service);
const forestLoadProgressBroker = new ForestLoadProgressBroker();
const app = createApp(service, refreshTaskManager, forestLoadProgressBroker);
const server = createServer(app);
const refreshWebSocketServer = new WebSocketServer({
  noServer: true
});
const forestsWebSocketServer = new WebSocketServer({
  noServer: true
});

const rejectUpgradeRequest = (socket: Duplex): void => {
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
};

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

refreshWebSocketServer.on("connection", (socket) => {
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

forestsWebSocketServer.on("connection", (socket) => {
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

if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
  throw new Error(
    `PORT must be an integer between 1 and ${MAX_PORT}. Received "${process.env.PORT}".`
  );
}

server.listen(port);

server.on("listening", () => {
  // eslint-disable-next-line no-console
  console.log(`API server listening on http://localhost:${port}`);
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EADDRINUSE") {
    throw error;
  }

  if (strictPort) {
    throw new Error(`Port ${port} is in use and STRICT_PORT=1 is set.`);
  }

  if (port >= MAX_PORT) {
    throw new Error(`No available ports found after trying ${port}.`);
  }

  const nextPort = port + 1;
  // eslint-disable-next-line no-console
  console.warn(`Port ${port} is in use, retrying on ${nextPort}.`);
  port = nextPort;
  server.listen(port);
});
