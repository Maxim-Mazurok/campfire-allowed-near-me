import { Router } from "express";
import { z } from "zod";
import type { ForestLoadProgressBroker } from "../services/forest-load-progress-broker.js";
import type { ForestDataService } from "../types/domain.js";
import type { RefreshTaskManager } from "../services/refresh-task-manager.js";

const querySchema = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  tolls: z.enum(["avoid", "allow"]).optional(),
  refresh: z
    .union([z.literal("1"), z.literal("true")])
    .optional()
});

export const createForestsRouter = (
  service: ForestDataService,
  refreshTaskManager?: RefreshTaskManager,
  forestLoadProgressBroker?: ForestLoadProgressBroker
): Router => {
  const router = Router();

  router.get("/", async (req, res) => {
    const parseResult = querySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Invalid query parameters",
        details: parseResult.error.flatten()
      });
    }

    try {
      const { lat, lng, refresh, tolls } = parseResult.data;
      const userLocation =
        lat !== undefined && lng !== undefined
          ? { latitude: lat, longitude: lng }
          : undefined;
      const avoidTolls = tolls !== "allow";

      if (refresh) {
        refreshTaskManager?.triggerRefresh({
          userLocation,
          avoidTolls
        });
      }

      const shouldTrackForegroundLoad = !refresh;
      const forestLoadRequest = shouldTrackForegroundLoad
        ? forestLoadProgressBroker?.beginRequest()
        : null;

      let result;

      try {
        result = await service.getForestData({
          forceRefresh: Boolean(refresh && !refreshTaskManager),
          preferCachedSnapshot: Boolean(refresh && refreshTaskManager),
          avoidTolls,
          userLocation,
          progressCallback: forestLoadRequest
            ? (progress) => {
                forestLoadRequest.updateProgress(progress);
              }
            : undefined
        });
      } catch (error) {
        forestLoadRequest?.fail(error);
        throw error;
      }

      forestLoadRequest?.complete();

      return res.json({
        ...result,
        refreshTask: refreshTaskManager?.getState() ?? null
      });
    } catch (error) {
      return res.status(500).json({
        error: "Unable to load fire-ban forest data",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
};
