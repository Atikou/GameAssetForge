function registerHealthRoutes(app) {
  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      name: "GameAssetForge",
      version: "0.1.0",
    });
  });
}

module.exports = { registerHealthRoutes };
