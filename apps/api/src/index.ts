import { createApp } from "./app.js";

const MAX_PORT = 65_535;
let port = Number(process.env.PORT ?? "8787");
const strictPort = process.env.STRICT_PORT === "1";
const app = createApp();

if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
  throw new Error(
    `PORT must be an integer between 1 and ${MAX_PORT}. Received "${process.env.PORT}".`
  );
}

const server = app.listen(port);

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
