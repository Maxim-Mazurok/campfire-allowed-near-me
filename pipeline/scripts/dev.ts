import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import "dotenv/config";

const DEFAULT_WEB_PORT = 5173;
const DEFAULT_ROUTES_PROXY_PORT = 8787;
const MAX_PORT = 65_535;
const NOMINATIM_CONTAINER_NAME = "campfire-nominatim";
const DEFAULT_NOMINATIM_IMAGE = "mediagis/nominatim:4.5";
const DEFAULT_NOMINATIM_PORT = "8080";
const DEFAULT_NOMINATIM_GUNICORN_WORKERS = "8";
const DEFAULT_NOMINATIM_DNS_SERVERS = "1.1.1.1,8.8.8.8";
const DEFAULT_NOMINATIM_PBF_URL =
  "https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf";

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

const runDockerCommand = async (argumentsList: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const dockerProcess = spawn("docker", argumentsList, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    dockerProcess.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    dockerProcess.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    dockerProcess.on("error", (error) => {
      reject(error);
    });

    dockerProcess.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `docker exited with code ${code}`));
        return;
      }

      resolve(stdout.trim());
    });
  });

const normalizeDnsServers = (dnsServers: string[]): string[] =>
  [...dnsServers]
    .map((dnsServer) => dnsServer.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

const getContainerDnsServers = async (containerName: string): Promise<string[]> => {
  try {
    const dnsJson = await runDockerCommand([
      "inspect",
      "--format",
      "{{json .HostConfig.Dns}}",
      containerName
    ]);

    const parsed = JSON.parse(dnsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeDnsServers(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return [];
  }
};

const getContainerEnvironmentVariables = async (
  containerName: string
): Promise<Record<string, string>> => {
  try {
    const environmentJson = await runDockerCommand([
      "inspect",
      "--format",
      "{{json .Config.Env}}",
      containerName
    ]);

    const parsed = JSON.parse(environmentJson) as unknown;
    if (!Array.isArray(parsed)) {
      return {};
    }

    const environmentVariables: Record<string, string> = {};

    for (const entry of parsed) {
      if (typeof entry !== "string") {
        continue;
      }

      const equalsIndex = entry.indexOf("=");
      if (equalsIndex === -1) {
        continue;
      }

      const key = entry.slice(0, equalsIndex);
      const value = entry.slice(equalsIndex + 1);
      environmentVariables[key] = value;
    }

    return environmentVariables;
  } catch {
    return {};
  }
};

const resolveNominatimPbfUrl = async (requestedPbfUrl: string): Promise<string> => {
  try {
    const response = await fetch(requestedPbfUrl, {
      method: "HEAD",
      redirect: "follow"
    });

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    const looksLikeHtml = contentType.includes("text/html");
    const looksLikeVerySmallFile = Number.isFinite(contentLength) && contentLength > 0 && contentLength < 100_000;

    if (response.ok && !looksLikeHtml && !looksLikeVerySmallFile) {
      return requestedPbfUrl;
    }

    if (requestedPbfUrl !== DEFAULT_NOMINATIM_PBF_URL) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dev] NOMINATIM_PBF_URL seems invalid (${requestedPbfUrl}). Falling back to ${DEFAULT_NOMINATIM_PBF_URL}.`
      );
      return DEFAULT_NOMINATIM_PBF_URL;
    }

    return requestedPbfUrl;
  } catch {
    if (requestedPbfUrl !== DEFAULT_NOMINATIM_PBF_URL) {
      // eslint-disable-next-line no-console
      console.warn(
        `[dev] NOMINATIM_PBF_URL is unreachable (${requestedPbfUrl}). Falling back to ${DEFAULT_NOMINATIM_PBF_URL}.`
      );
      return DEFAULT_NOMINATIM_PBF_URL;
    }

    return requestedPbfUrl;
  }
};

const isContainerRunning = async (containerName: string): Promise<boolean> => {
  try {
    const running = await runDockerCommand([
      "inspect",
      "--format",
      "{{.State.Running}}",
      containerName
    ]);

    return running.trim().toLowerCase() === "true";
  } catch {
    return false;
  }
};

const ensureNominatimContainerRunning = async (): Promise<void> => {
  if (process.env.NOMINATIM_AUTO_START === "0") {
    // eslint-disable-next-line no-console
    console.log("[dev] Nominatim auto-start disabled via NOMINATIM_AUTO_START=0.");
    return;
  }

  const nominatimPort = process.env.NOMINATIM_PORT ?? DEFAULT_NOMINATIM_PORT;
  const nominatimImage = process.env.NOMINATIM_IMAGE ?? DEFAULT_NOMINATIM_IMAGE;
  const nominatimGunicornWorkers =
    process.env.NOMINATIM_GUNICORN_WORKERS ?? DEFAULT_NOMINATIM_GUNICORN_WORKERS;
  const nominatimPbfUrl = await resolveNominatimPbfUrl(
    process.env.NOMINATIM_PBF_URL ?? DEFAULT_NOMINATIM_PBF_URL
  );
  const nominatimDnsServers = (
    process.env.NOMINATIM_DNS_SERVERS ?? DEFAULT_NOMINATIM_DNS_SERVERS
  )
    .split(",")
    .map((dnsServer) => dnsServer.trim())
    .filter(Boolean);
  const dnsArguments = nominatimDnsServers.flatMap((dnsServer) => ["--dns", dnsServer]);

  try {
    const originalExistingContainerId = await runDockerCommand([
      "ps",
      "-aq",
      "--filter",
      `name=^/${NOMINATIM_CONTAINER_NAME}$`
    ]);

    if (originalExistingContainerId) {
      const configuredDnsServers = await getContainerDnsServers(NOMINATIM_CONTAINER_NAME);
      const configuredEnvironmentVariables = await getContainerEnvironmentVariables(
        NOMINATIM_CONTAINER_NAME
      );
      const expectedDnsServers = normalizeDnsServers(nominatimDnsServers);
      const dnsConfigurationChanged =
        JSON.stringify(configuredDnsServers) !== JSON.stringify(expectedDnsServers);
      const gunicornWorkersChanged =
        configuredEnvironmentVariables.GUNICORN_WORKERS !== nominatimGunicornWorkers;

      if (dnsConfigurationChanged || gunicornWorkersChanged) {
        // eslint-disable-next-line no-console
        console.log(
          `[dev] Existing Nominatim container settings differ from requested values. Keeping container/data as-is to avoid reimport. Requested DNS: ${expectedDnsServers.join(", ")}, requested GUNICORN_WORKERS: ${nominatimGunicornWorkers}.`
        );
      }
    }

    const existingContainerId = await runDockerCommand([
      "ps",
      "-aq",
      "--filter",
      `name=^/${NOMINATIM_CONTAINER_NAME}$`
    ]);

    const runningContainerId = await runDockerCommand([
      "ps",
      "-q",
      "--filter",
      `name=^/${NOMINATIM_CONTAINER_NAME}$`
    ]);

    if (runningContainerId) {
      // eslint-disable-next-line no-console
      console.log(`[dev] Nominatim container is already running on :${nominatimPort}.`);
      return;
    }

    if (existingContainerId) {
      await runDockerCommand(["start", NOMINATIM_CONTAINER_NAME]);
      // eslint-disable-next-line no-console
      console.log("[dev] Started existing Nominatim container (data preserved).");
      return;
    }

    await runDockerCommand([
      "run",
      "-d",
      "--name",
      NOMINATIM_CONTAINER_NAME,
      "-p",
      `${nominatimPort}:8080`,
      ...dnsArguments,
      "-e",
      `PBF_URL=${nominatimPbfUrl}`,
      "-e",
      `GUNICORN_WORKERS=${nominatimGunicornWorkers}`,
      "-e",
      "REPLICATION_URL=https://download.geofabrik.de/australia-oceania/australia-updates/",
      nominatimImage
    ]);

    // eslint-disable-next-line no-console
    console.log(
      `[dev] Started new Nominatim container on :${nominatimPort} (first import can take time).`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[dev] Nominatim DNS servers: ${nominatimDnsServers.join(", ")} (configure via NOMINATIM_DNS_SERVERS).`
    );
    // eslint-disable-next-line no-console
    console.log(
      `[dev] Nominatim Gunicorn workers: ${nominatimGunicornWorkers} (configure via NOMINATIM_GUNICORN_WORKERS).`
    );

    const runningAfterCreate = await isContainerRunning(NOMINATIM_CONTAINER_NAME);
    if (!runningAfterCreate) {
      let recentLogs = "";
      try {
        recentLogs = await runDockerCommand([
          "logs",
          "--tail",
          "20",
          NOMINATIM_CONTAINER_NAME
        ]);
      } catch {
        recentLogs = "";
      }

      // eslint-disable-next-line no-console
      console.warn(
        `[dev] Nominatim container was created but is not running; check network/DNS and review logs.${
          recentLogs ? ` Latest logs:\n${recentLogs}` : ""
        }`
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[dev] Unable to ensure Nominatim container is running: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

const main = async () => {
  await ensureNominatimContainerRunning();

  const webStartPort = parsePort(
    process.env.WEB_PORT_START ?? process.env.WEB_PORT,
    DEFAULT_WEB_PORT
  );
  const routesProxyPort = parsePort(
    process.env.ROUTES_PROXY_PORT,
    DEFAULT_ROUTES_PROXY_PORT
  );

  // eslint-disable-next-line no-console
  console.log(
    `[dev] Web start port: ${webStartPort} (Vite will move to the next free port if needed).`
  );

  const baseEnv = process.env;

  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  const routesProxyDirectory = resolve(
    process.cwd(),
    "workers",
    "routes-proxy"
  );

  if (googleMapsApiKey) {
    const devVarsPath = resolve(routesProxyDirectory, ".dev.vars");
    const snapshotUrl = `http://localhost:${webStartPort}/forests-snapshot.json`;
    const devVarsContent = [
      `GOOGLE_MAPS_API_KEY=${googleMapsApiKey}`,
      `SNAPSHOT_URL=${snapshotUrl}`
    ].join("\n");

    const existingDevVars = existsSync(devVarsPath)
      ? readFileSync(devVarsPath, "utf-8").trim()
      : "";
    if (existingDevVars !== devVarsContent.trim()) {
      writeFileSync(devVarsPath, `${devVarsContent}\n`, "utf-8");
      // eslint-disable-next-line no-console
      console.log("[dev] Wrote routes-proxy .dev.vars (GOOGLE_MAPS_API_KEY + SNAPSHOT_URL).");
    }

    // eslint-disable-next-line no-console
    console.log(`[dev] Starting routes-proxy worker on :${routesProxyPort}.`);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[dev] GOOGLE_MAPS_API_KEY not set — routes-proxy worker will NOT start. Driving distances will be unavailable."
    );
  }

  const webProcess = spawnProcess(["run", "dev:web"], {
    ...baseEnv,
    WEB_PORT: `${webStartPort}`
  });

  const children: ChildProcess[] = [webProcess];

  if (googleMapsApiKey) {
    const wranglerProcess = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["-y", "wrangler", "dev", "--port", `${routesProxyPort}`],
      {
        stdio: "inherit",
        cwd: routesProxyDirectory,
        env: baseEnv
      }
    );

    children.push(wranglerProcess);

    wranglerProcess.on("exit", (code, signal) => {
      if (shuttingDown) {
        return;
      }

      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      // eslint-disable-next-line no-console
      console.warn(`[dev] Routes-proxy worker exited with ${detail}. Driving distances will be unavailable.`);
    });
  }

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
