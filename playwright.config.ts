import { defineConfig } from "@playwright/test";

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const apiPort = parsePort(process.env.PW_API_PORT, 18_787);
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
  webServer: [
    {
      command:
        `FORESTRY_USE_FIXTURE=fixtures/mock-forests.json FORESTRY_SKIP_SCRAPE=true PORT=${apiPort} STRICT_PORT=1 npm run dev:api`,
      port: apiPort,
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `WEB_PORT=${webPort} VITE_API_PROXY_TARGET=http://localhost:${apiPort} VITE_STRICT_PORT=1 npm run dev:web`,
      port: webPort,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
