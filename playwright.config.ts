import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    permissions: ["geolocation"],
    geolocation: { latitude: -33.8688, longitude: 151.2093 }
  },
  webServer: [
    {
      command:
        "FORESTRY_USE_FIXTURE=fixtures/mock-forests.json FORESTRY_SKIP_SCRAPE=true PORT=8787 npm run dev:api",
      port: 8787,
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: "npm run dev:web",
      port: 5173,
      reuseExistingServer: true,
      timeout: 120_000
    }
  ]
});
