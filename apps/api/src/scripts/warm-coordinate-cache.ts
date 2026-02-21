import { LiveForestDataService } from "../services/live-forest-data-service.js";

const run = async () => {
  const service = new LiveForestDataService({ scrapeTtlMs: 0 });
  const response = await service.getForestData({ forceRefresh: true });

  const mapped = response.forests.filter(
    (forest) => forest.latitude !== null && forest.longitude !== null
  ).length;

  const statusCounts = response.forests.reduce<Record<string, number>>(
    (acc, forest) => {
      acc[forest.banStatus] = (acc[forest.banStatus] ?? 0) + 1;
      return acc;
    },
    {}
  );

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        fetchedAt: response.fetchedAt,
        stale: response.stale,
        totalForests: response.forests.length,
        mappedForests: mapped,
        statusCounts,
        warningCount: response.warnings.length
      },
      null,
      2
    )
  );
};

run().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exit(1);
});
