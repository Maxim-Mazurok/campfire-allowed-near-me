import cors from "cors";
import express from "express";
import { createForestsRouter } from "./routes/forests.js";
import { LiveForestDataService } from "./services/live-forest-data-service.js";
import type { ForestDataService } from "./types/domain.js";

export const createApp = (service?: ForestDataService) => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const resolvedService = service ??
    new LiveForestDataService({
      scrapeTtlMs: Number(process.env.SCRAPE_TTL_MS ?? `${15 * 60 * 1000}`)
    });

  app.get("/api/health", (_, res) => {
    res.json({ ok: true, now: new Date().toISOString() });
  });

  app.use("/api/forests", createForestsRouter(resolvedService));

  return app;
};
