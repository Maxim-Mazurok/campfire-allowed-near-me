import { defineConfig } from "@playwright/test";

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const webPort = parsePort(process.env.PW_WEB_PORT, 15_173);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "on-first-retry",
    permissions: ["geolocation"],
    geolocation: { latitude: -33.8688, longitude: 151.2093 }
  },
  webServer: {
    command: `WEB_PORT=${webPort} VITE_STRICT_PORT=1 npm run dev:web`,
    port: webPort,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
