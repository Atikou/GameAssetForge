const { fetchAppRankings, getRankingProviders } = require("../tools/app-rankings");

function registerRankingRoutes(app) {
  app.get("/api/rankings/providers", (req, res) => {
    res.json({ providers: getRankingProviders() });
  });

  app.get("/api/rankings/apps", async (req, res, next) => {
    try {
      res.json(
        await fetchAppRankings({
          source: req.query.source,
          provider: req.query.provider,
          country: req.query.country,
          chart: req.query.chart,
          filter: req.query.filter,
          limit: req.query.limit,
          refresh: req.query.refresh === "1" || req.query.refresh === "true",
        }),
      );
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerRankingRoutes };
