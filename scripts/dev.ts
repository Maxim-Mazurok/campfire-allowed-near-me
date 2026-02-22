import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const DEFAULT_API_PORT = 8787;
const DEFAULT_WEB_PORT = 5173;
const MAX_PORT = 65_535;

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PORT) {
    throw new Error(
      `Invalid port "${value}". Expected an integer between 1 and ${MAX_PORT}.`
    );
  }

  return parsed;
};

const canListenOnPort = async (port: number): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.listen(port, () => {
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(true);
      });
    });
  });

const findAvailablePort = async (startPort: number, reserved: Set<number>) => {
  for (let port = startPort; port <= MAX_PORT; port += 1) {
    if (reserved.has(port)) {
      continue;
    }

    if (await canListenOnPort(port)) {
      return port;
    }
  }

  throw new Error(`No available port found between ${startPort} and ${MAX_PORT}.`);
};

const spawnProcess = (
  args: string[],
  env: NodeJS.ProcessEnv
): ChildProcess =>
  spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    stdio: "inherit",
    env
  });

const stopProcess = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
};

const main = async () => {
  const apiStartPort = parsePort(
    process.env.API_PORT_START ?? process.env.PORT,
    DEFAULT_API_PORT
  );
  const apiPort = await findAvailablePort(apiStartPort, new Set<number>());
  const webStartPort = parsePort(
    process.env.WEB_PORT_START ?? process.env.WEB_PORT,
    DEFAULT_WEB_PORT
  );

  const apiUrl = `http://localhost:${apiPort}`;
  // eslint-disable-next-line no-console
  console.log(`[dev] API target: ${apiUrl}`);
  // eslint-disable-next-line no-console
  console.log(
    `[dev] Web start port: ${webStartPort} (Vite will move to the next free port if needed).`
  );

  const baseEnv = process.env;
  const apiProcess = spawnProcess(["run", "dev:api"], {
    ...baseEnv,
    PORT: `${apiPort}`,
    STRICT_PORT: "1"
  });
  const webProcess = spawnProcess(["run", "dev:web"], {
    ...baseEnv,
    WEB_PORT: `${webStartPort}`,
    VITE_API_PROXY_TARGET: apiUrl
  });

  const children = [apiProcess, webProcess];
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const child of children) {
      stopProcess(child, signal);
    }
  };

  apiProcess.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    // eslint-disable-next-line no-console
    console.error(`[dev] API process exited with ${detail}.`);
    shutdown("SIGTERM");
    process.exit(code ?? 1);
  });

  webProcess.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    // eslint-disable-next-line no-console
    console.error(`[dev] Web process exited with ${detail}.`);
    shutdown("SIGTERM");
    process.exit(code ?? 1);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
};

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("[dev] Failed to start development servers.", error);
  process.exit(1);
});
