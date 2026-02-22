import cors from "cors";
import express from "express";
import { createForestsRouter } from "./routes/forests.js";
import { ForestLoadProgressBroker } from "./services/forest-load-progress-broker.js";
import { LiveForestDataService } from "./services/live-forest-data-service.js";
import { RefreshTaskManager } from "./services/refresh-task-manager.js";
import type { ForestDataService } from "./types/domain.js";

export const createApp = (
  service?: ForestDataService,
  refreshTaskManager?: RefreshTaskManager,
  forestLoadProgressBroker?: ForestLoadProgressBroker
) => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const resolvedService = service ??
    new LiveForestDataService({
      scrapeTtlMs: Number(process.env.SCRAPE_TTL_MS ?? `${15 * 60 * 1000}`),
      snapshotPath: process.env.FORESTRY_SNAPSHOT_PATH ?? null
    });
  const resolvedRefreshManager = refreshTaskManager ?? new RefreshTaskManager(resolvedService);
  const resolvedForestLoadProgressBroker =
    forestLoadProgressBroker ?? new ForestLoadProgressBroker();

  app.get("/api/health", (_, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  app.get("/api/refresh/status", (_, res) => {
    res.json(resolvedRefreshManager.getState());
  });

  app.use(
    "/api/forests",
    createForestsRouter(
      resolvedService,
      resolvedRefreshManager,
      resolvedForestLoadProgressBroker
    )
  );

  return app;
};
