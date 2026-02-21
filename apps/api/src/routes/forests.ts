import { Router } from "express";
import { z } from "zod";
import type { ForestDataService } from "../types/domain.js";

const querySchema = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  refresh: z
    .union([z.literal("1"), z.literal("true")])
    .optional()
});

export const createForestsRouter = (service: ForestDataService): Router => {
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
      const { lat, lng, refresh } = parseResult.data;
      const result = await service.getForestData({
        forceRefresh: Boolean(refresh),
        userLocation:
          lat !== undefined && lng !== undefined
            ? { latitude: lat, longitude: lng }
            : undefined
      });

      return res.json(result);
    } catch (error) {
      return res.status(500).json({
        error: "Unable to load fire-ban forest data",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  return router;
};
